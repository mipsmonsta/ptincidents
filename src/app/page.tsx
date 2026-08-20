"use client";

import { useEffect, useMemo, useState } from "react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "";
const SYNC_URL = GITHUB_REPO
  ? `https://github.com/${GITHUB_REPO}/actions/workflows/sync-alerts.yml`
  : null;

type TrainAlert = {
  id: string;
  status: number | null;
  incidentType: string | null;
  message: string | null;
  affectedLines: string[];
  affectedStations: string[];
  affectedSegments: unknown[];
  startTime: string | null;
  endTime: string | null;
  createdDate: string | null;
  lastUpdatedDate: string | null;
  source: string | null;
  current: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

type BusAlert = {
  id: string;
  mode: "bus";
  operator: string;
  message: string | null;
  postedAt: string | null;
  source: string | null;
  current: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

type Meta = {
  lastSyncedAt: string | null;
  trainCount: number;
  busCount: number;
  retentionDays: number;
};

const OPERATORS = ["SMRT", "SBST", "GAS", "TTS"] as const;
type Tab = "train" | "bus";

function formatTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function isCurrent(a: { current: boolean }) {
  return a.current;
}

export default function Home() {
  const [train, setTrain] = useState<TrainAlert[]>([]);
  const [bus, setBus] = useState<BusAlert[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("train");
  const [filter, setFilter] = useState<"all" | "current">("all");
  const [operator, setOperator] = useState<string>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`${BASE_PATH}/data/train-alerts.json`).then((r) => r.json()),
      fetch(`${BASE_PATH}/data/bus-alerts.json`).then((r) => r.json()),
      fetch(`${BASE_PATH}/data/meta.json`).then((r) => r.json()),
    ])
      .then(([trainData, busData, metaData]) => {
        setTrain(trainData);
        setBus(busData);
        setMeta(metaData);
      })
      .catch(() => setError("Could not load alert data."))
      .finally(() => setLoading(false));
  }, []);

  const filteredTrain = useMemo(() => {
    const q = query.trim().toLowerCase();
    return train.filter((a) => {
      if (filter === "current" && !isCurrent(a)) return false;
      if (q) {
        const hay = [
          a.message,
          a.incidentType,
          a.source,
          ...a.affectedLines,
          ...a.affectedStations,
          JSON.stringify(a.affectedSegments),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [train, filter, query]);

  const filteredBus = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bus.filter((a) => {
      if (filter === "current" && !isCurrent(a)) return false;
      if (operator !== "all" && a.operator !== operator) return false;
      if (q) {
        const hay = [a.message, a.operator, a.source].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bus, filter, operator, query]);

  const activeList = tab === "train" ? filteredTrain : filteredBus;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "train", label: "Train", count: meta?.trainCount ?? train.length },
    { key: "bus", label: "Bus", count: meta?.busCount ?? bus.length },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          Transport Service Alerts
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Train: LTA Datamall{" "}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-xs dark:bg-white/[.08]">
            TrainServiceAlerts
          </code>{" "}
          · Bus: operator X feeds (SMRT, SBS Transit, Go-Ahead, Tower Transit)
          {meta?.retentionDays ? ` · retaining the last ${meta.retentionDays} days` : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-500">
            Last synced: {meta?.lastSyncedAt ? formatTime(meta.lastSyncedAt) : "never"}
          </span>
          {SYNC_URL && (
            <a
              href={SYNC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              Run sync workflow
            </a>
          )}
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
              <span className="ml-1.5 opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          {(["all", "current"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {tab === "bus" && (
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="all">All operators</option>
            {OPERATORS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            tab === "train"
              ? "Search message, line, station…"
              : "Search message, operator…"
          }
          className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {loading && <p className="py-10 text-center text-zinc-500">Loading…</p>}

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {error}
          {SYNC_URL && (
            <>
              {" "}
              Data is synced by a scheduled GitHub Action —{" "}
              <a
                href={SYNC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
              >
                run it manually
              </a>{" "}
              to populate data.
            </>
          )}
        </div>
      )}

      {!loading && !error && activeList.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {tab === "train"
            ? train.length === 0
              ? "No train alerts yet. "
              : "No train alerts match your filters. "
            : bus.length === 0
              ? "No bus alerts yet. "
              : "No bus alerts match your filters. "}
          {SYNC_URL && (
            <>
              The GitHub Action{" "}
              <a
                href={SYNC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                Run sync workflow
              </a>{" "}
              fetches them on a schedule.
            </>
          )}
        </div>
      )}

      {tab === "train" ? (
        <ul className="space-y-4">
          {filteredTrain.map((a) => (
            <TrainCard key={a.id} a={a} />
          ))}
        </ul>
      ) : (
        <ul className="space-y-4">
          {filteredBus.map((a) => (
            <BusCard key={a.id} a={a} />
          ))}
        </ul>
      )}
    </main>
  );
}

function StatusDot({ current }: { current: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        current
          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${current ? "bg-red-500" : "bg-zinc-400"}`} />
      {current ? "Current" : "Historical"}
    </span>
  );
}

function TrainCard({ a }: { a: TrainAlert }) {
  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          Train
        </span>
        <StatusDot current={a.current} />
        {a.incidentType && (
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {a.incidentType}
          </span>
        )}
        {a.status != null && <span className="text-xs text-zinc-400">Status: {a.status}</span>}
        {a.id && <span className="ml-auto font-mono text-xs text-zinc-400">{a.id.slice(0, 8)}</span>}
      </div>

      {a.message && <p className="mt-3 text-sm leading-6">{a.message}</p>}

      {(a.affectedLines.length > 0 || a.affectedStations.length > 0) && (
        <p className="mt-2 text-xs text-zinc-500">
          {a.affectedLines.length > 0 && (
            <span>
              Lines: <span className="font-mono">{a.affectedLines.join(", ")}</span>
            </span>
          )}
          {a.affectedLines.length > 0 && a.affectedStations.length > 0 && " · "}
          {a.affectedStations.length > 0 && (
            <span>
              Stations: <span className="font-mono">{a.affectedStations.join(", ")}</span>
            </span>
          )}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-zinc-500 sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt>Created</dt>
          <dd>{formatTime(a.createdDate)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>End</dt>
          <dd>{formatTime(a.endTime)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Updated</dt>
          <dd>{formatTime(a.lastUpdatedDate)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>First seen</dt>
          <dd>{formatTime(a.firstSeenAt)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Last seen</dt>
          <dd>{formatTime(a.lastSeenAt)}</dd>
        </div>
        {a.source && (
          <div className="flex justify-between gap-2">
            <dt>Source</dt>
            <dd className="truncate">{a.source}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

function BusCard({ a }: { a: BusAlert }) {
  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Bus
        </span>
        {a.operator && (
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {a.operator}
          </span>
        )}
        <StatusDot current={a.current} />
        {a.source && <span className="ml-auto text-xs text-zinc-400">{a.source}</span>}
      </div>

      {a.message && <p className="mt-3 text-sm leading-6">{a.message}</p>}

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-zinc-500 sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt>Posted</dt>
          <dd>{formatTime(a.postedAt)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>First seen</dt>
          <dd>{formatTime(a.firstSeenAt)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Last seen</dt>
          <dd>{formatTime(a.lastSeenAt)}</dd>
        </div>
      </dl>
    </li>
  );
}
