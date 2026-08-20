import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLtaDate, mergeAndPrune, mergeRecords, runSync } from "./sync-alerts.mjs";

const fixture = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sbst-x.html"),
  "utf8",
);

function fakeFetch({ trainOk = true } = {}) {
  return async (url) => {
    if (String(url).includes("TrainServiceAlerts")) {
      if (!trainOk) return new Response("nope", { status: 401 });
      return new Response(
        JSON.stringify({ value: [{ Id: "x", Message: "hello" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (String(url).startsWith("https://x.com/")) {
      return new Response(fixture, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

test("parseLtaDate parses /Date(ms+tz)/ and ISO strings", () => {
  assert.equal(parseLtaDate("/Date(1700000000000+0800)/"), "2023-11-14T22:13:20.000Z");
  assert.equal(parseLtaDate("2023-11-14T22:13:20.000Z"), "2023-11-14T22:13:20.000Z");
  assert.equal(parseLtaDate("garbage"), null);
  assert.equal(parseLtaDate(null), null);
  assert.equal(parseLtaDate(undefined), null);
});

test("mergeAndPrune upserts by id and prunes stale alerts", () => {
  const now = "2026-08-20T12:00:00.000Z";
  const existing = [
    {
      id: "1",
      message: "old message",
      startTime: null,
      firstSeenAt: "2026-08-01T00:00:00.000Z",
      lastSeenAt: "2026-08-01T00:00:00.000Z",
      raw: {},
    },
    {
      id: "stale",
      message: "never seen recently",
      startTime: null,
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-08-01T00:00:00.000Z",
      raw: {},
    },
  ];
  const fetched = [
    {
      Id: "1",
      Status: 1,
      Message: "updated message",
      AffectedServices: [{ Line: "NS" }, { Line: "EW" }],
      AffectedStations: [{ StationCode: "NS1" }],
      StartTime: "/Date(1700000000000+0800)/",
      Source: "test",
    },
    { Id: "2", Message: "brand new" },
  ];

  const { alerts, added, updated, pruned } = mergeAndPrune(existing, fetched, now, 14);

  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.equal(pruned, 1);
  assert.equal(alerts.length, 2);

  const alert1 = alerts.find((a) => a.id === "1");
  assert.equal(alert1.message, "updated message");
  assert.equal(alert1.firstSeenAt, "2026-08-01T00:00:00.000Z");
  assert.equal(alert1.lastSeenAt, now);
  assert.deepEqual(alert1.affectedLines, ["NS", "EW"]);
  assert.equal(alert1.startTime, "2023-11-14T22:13:20.000Z");

  const alert2 = alerts.find((a) => a.id === "2");
  assert.equal(alert2.firstSeenAt, now);
});

test("mergeAndPrune handles LTA message-style payload with content-hash ids", () => {
  const now = "2026-08-20T12:00:00.000Z";
  const envelope = { Status: 1, AffectedSegments: [] };
  const fetched = [
    { Content: "23:30-DTL-Planned service adjustments.", CreatedDate: "2026-07-09 20:00:20" },
  ];
  const { alerts, added } = mergeAndPrune([], fetched, now, 14, envelope);
  assert.equal(added, 1);
  assert.equal(alerts[0].status, 1);
  assert.match(alerts[0].id, /^[0-9a-f]{40}$/);
});

test("mergeRecords flips current=false for items absent from the latest feed", () => {
  const now = "2026-08-20T12:00:00.000Z";
  const existing = [
    {
      id: "x:1",
      message: "old",
      current: true,
      firstSeenAt: "2026-08-19T00:00:00.000Z",
      lastSeenAt: "2026-08-19T00:00:00.000Z",
    },
  ];
  const r = mergeRecords(existing, [{ id: "x:2", message: "new", current: true }], now, 14);
  assert.equal(r.added, 1);
  assert.equal(r.alerts.length, 2);
  assert.equal(r.alerts.find((a) => a.id === "x:1").current, false);
  assert.equal(r.alerts.find((a) => a.id === "x:2").current, true);
});

test("runSync writes separate train and bus files plus meta", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lta-sync-"));
  const trainFile = path.join(dir, "train.json");
  const busFile = path.join(dir, "bus.json");
  const metaFile = path.join(dir, "meta.json");

  const stats = await runSync({
    accountKey: "k",
    retentionDays: 14,
    trainFile,
    busFile,
    metaFile,
    fetchImpl: fakeFetch(),
    now: new Date("2026-08-20T12:00:00.000Z"),
  });

  assert.equal(stats.train.total, 1);
  assert.ok(stats.bus.total >= 4);
  assert.deepEqual(JSON.parse(await readFile(trainFile, "utf8"))[0].id, "x");
  const bus = JSON.parse(await readFile(busFile, "utf8"));
  assert.ok(bus.every((a) => a.mode === "bus" && a.operator));
  const meta = JSON.parse(await readFile(metaFile, "utf8"));
  assert.equal(meta.trainCount, 1);
  assert.equal(meta.busCount, bus.length);
  assert.equal(meta.retentionDays, 14);

  await rm(dir, { recursive: true, force: true });
});

test("runSync keeps last good data and other source when one source fails", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lta-sync-"));
  const trainFile = path.join(dir, "train.json");
  const busFile = path.join(dir, "bus.json");
  const metaFile = path.join(dir, "meta.json");
  await writeFile(trainFile, JSON.stringify([{ id: "kept", message: "old" }]), "utf8");

  const stats = await runSync({
    accountKey: "bad",
    retentionDays: 14,
    trainFile,
    busFile,
    metaFile,
    fetchImpl: fakeFetch({ trainOk: false }),
    now: new Date("2026-08-20T12:00:00.000Z"),
  });

  assert.match(stats.train.error, /401/);
  assert.ok(stats.bus.total >= 4);
  assert.equal(JSON.parse(await readFile(trainFile, "utf8"))[0].id, "kept");
  const meta = JSON.parse(await readFile(metaFile, "utf8"));
  assert.equal(meta.trainCount, 1);
  assert.ok(meta.busCount >= 4);

  await rm(dir, { recursive: true, force: true });
});
