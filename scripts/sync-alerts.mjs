import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import process from "node:process";

try {
  process.loadEnvFile();
} catch {}

const LTA_URL = "https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts";
const DAY_MS = 86400000;

export function parseLtaDate(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const m = value.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
    if (m) {
      return new Date(Number(m[1])).toISOString();
    }
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function listOf(value, key) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === "object") return String(item[key] ?? "");
      return String(item);
    })
    .filter(Boolean);
}

export function normalize(rec, envelope) {
  const isMessage = rec && (rec.Content !== undefined || rec.content !== undefined);
  if (isMessage) {
    const content = String(rec.Content ?? rec.content ?? "");
    return {
      id: createHash("sha1").update(content).digest("hex"),
      status: envelope?.Status ?? null,
      incidentType: null,
      message: content,
      affectedLines: [],
      affectedStations: [],
      startTime: null,
      endTime: null,
      createdDate: parseLtaDate(rec.CreatedDate ?? rec.createdDate),
      lastUpdatedDate: null,
      affectedSegments: Array.isArray(envelope?.AffectedSegments)
        ? envelope.AffectedSegments
        : [],
      source: "TrainServiceAlerts",
      raw: rec,
      current: true,
    };
  }

  return {
    id: String(rec.Id ?? rec.id ?? ""),
    status: rec.Status ?? null,
    incidentType: rec.IncidentType ?? rec.incidentType ?? null,
    message: rec.Message ?? rec.message ?? null,
    affectedLines: listOf(rec.AffectedServices ?? rec.affectedServices, "Line"),
    affectedStations: listOf(rec.AffectedStations ?? rec.affectedStations, "StationCode"),
    startTime: parseLtaDate(rec.StartTime ?? rec.startTime),
    endTime: parseLtaDate(rec.EndTime ?? rec.endTime),
    createdDate: parseLtaDate(rec.CreatedDate ?? rec.createdDate),
    lastUpdatedDate: parseLtaDate(rec.LastUpdatedDate ?? rec.lastUpdatedDate),
    affectedSegments: [],
    source: rec.Source ?? rec.source ?? null,
    raw: rec,
    current: true,
  };
}

export function mergeAndPrune(existing, fetched, now, retentionDays, envelope = null) {
  const byId = new Map(Array.isArray(existing) ? existing.map((a) => [a.id, a]) : []);
  const seen = new Set();
  let added = 0;
  let updated = 0;

  for (const rec of fetched) {
    const alert = normalize(rec, envelope);
    if (!alert.id) continue;
    seen.add(alert.id);
    const prev = byId.get(alert.id);
    if (prev) {
      alert.firstSeenAt = prev.firstSeenAt ?? now;
      updated++;
    } else {
      alert.firstSeenAt = now;
      added++;
    }
    alert.lastSeenAt = now;
    byId.set(alert.id, alert);
  }

  for (const [id, alert] of byId) {
    if (!seen.has(id)) alert.current = false;
  }

  const cutoff = Date.parse(now) - retentionDays * DAY_MS;
  let pruned = 0;
  for (const [id, alert] of byId) {
    const seenAt = Date.parse(alert.lastSeenAt);
    if (Number.isNaN(seenAt) || seenAt < cutoff) {
      byId.delete(id);
      pruned++;
    }
  }

  const alerts = [...byId.values()].sort(
    (a, b) =>
      String(b.createdDate ?? b.startTime ?? "").localeCompare(
        String(a.createdDate ?? a.startTime ?? ""),
      ),
  );

  return { alerts, added, updated, pruned };
}

async function loadJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

export async function runSync({
  accountKey,
  retentionDays,
  alertsFile,
  metaFile,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!accountKey) {
    throw new Error("LTA_ACCOUNT_KEY is not set");
  }

  const res = await fetchImpl(LTA_URL, {
    headers: { AccountKey: accountKey },
  });
  if (!res.ok) {
    throw new Error(`LTA API responded with ${res.status}; keeping existing data`);
  }

  const body = await res.json();
  const value = body.value;
  let envelope = null;
  let fetched = [];
  if (Array.isArray(value)) {
    fetched = value;
  } else if (value && Array.isArray(value.Message)) {
    envelope = value;
    fetched = value.Message;
  }

  const nowIso = now.toISOString();
  const existing = await loadJson(alertsFile);
  const { alerts, added, updated, pruned } = mergeAndPrune(existing, fetched, nowIso, retentionDays, envelope);

  await atomicWrite(alertsFile, alerts);
  await atomicWrite(metaFile, {
    lastSyncedAt: nowIso,
    alertCount: alerts.length,
    retentionDays,
  });

  return { fetched: fetched.length, added, updated, pruned, total: alerts.length, lastSyncedAt: nowIso };
}

async function main() {
  const result = await runSync({
    accountKey: process.env.LTA_ACCOUNT_KEY,
    retentionDays: Number(process.env.RETENTION_DAYS ?? 14),
    alertsFile: process.env.ALERTS_FILE ?? "public/data/alerts.json",
    metaFile: process.env.META_FILE ?? "public/data/meta.json",
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
