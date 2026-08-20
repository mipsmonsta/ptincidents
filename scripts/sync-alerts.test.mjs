import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseLtaDate, mergeAndPrune, runSync } from "./sync-alerts.mjs";

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
  assert.deepEqual(alert1.affectedStations, ["NS1"]);
  assert.equal(alert1.startTime, "2023-11-14T22:13:20.000Z");

  const alert2 = alerts.find((a) => a.id === "2");
  assert.equal(alert2.firstSeenAt, now);
  assert.equal(alert2.lastSeenAt, now);
});

test("mergeAndPrune refreshes seen alerts and drops ones absent from the feed for >retention days", () => {
  const now = "2026-08-20T12:00:00.000Z";
  const fetched = [{ Id: "fresh", Message: "seen today" }];
  const existing = [
    {
      id: "old",
      message: "seen 20 days ago",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-07-31T00:00:00.000Z",
      raw: {},
    },
  ];
  const { alerts, pruned } = mergeAndPrune(existing, fetched, now, 14);
  assert.equal(pruned, 1);
  assert.deepEqual(alerts.map((a) => a.id), ["fresh"]);
});

test("mergeAndPrune handles LTA message-style payload with content-hash ids", () => {
  const now = "2026-08-20T12:00:00.000Z";
  const envelope = { Status: 1, AffectedSegments: [] };
  const fetched = [
    { Content: "23:30-DTL-Planned service adjustments.", CreatedDate: "2026-07-09 20:00:20" },
    { Content: "20/08/2026 08:33-Bus services diverted.", CreatedDate: "2026-08-20 08:33:44" },
  ];

  const first = mergeAndPrune([], fetched, now, 14, envelope);
  assert.equal(first.added, 2);
  assert.equal(first.alerts.length, 2);
  assert.ok(first.alerts.every((a) => a.current === true));
  const dtw = first.alerts.find((a) => a.message === "23:30-DTL-Planned service adjustments.");
  assert.equal(dtw.status, 1);
  assert.equal(dtw.createdDate, "2026-07-09T12:00:20.000Z");
  assert.match(dtw.id, /^[0-9a-f]{40}$/);

  const secondFetched = fetched.slice(0, 1);
  const second = mergeAndPrune(first.alerts, secondFetched, now, 14, envelope);
  assert.equal(second.updated, 1);
  assert.equal(second.alerts.length, 2);
  const present = second.alerts.find((a) => a.message === "23:30-DTL-Planned service adjustments.");
  const absent = second.alerts.find((a) => a.message.startsWith("20/08/2026"));
  assert.equal(present.current, true);
  assert.equal(absent.current, false);

  const stale = mergeAndPrune(second.alerts, [], "2026-09-10T12:00:00.000Z", 14, envelope);
  assert.equal(stale.pruned, 2);
  assert.equal(stale.alerts.length, 0);
});

test("runSync writes alerts and meta atomically and fails gracefully on bad response", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lta-sync-"));
  const alertsFile = path.join(dir, "alerts.json");
  const metaFile = path.join(dir, "meta.json");

  const fakeFetch = async () =>
    new Response(JSON.stringify({ value: [{ Id: "x", Message: "hello" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const result = await runSync({
    accountKey: "k",
    retentionDays: 14,
    alertsFile,
    metaFile,
    fetchImpl: fakeFetch,
    now: new Date("2026-08-20T12:00:00.000Z"),
  });
  assert.equal(result.total, 1);
  assert.deepEqual(JSON.parse(await readFile(alertsFile, "utf8")), [
    {
      id: "x",
      status: null,
      incidentType: null,
      message: "hello",
      affectedLines: [],
      affectedStations: [],
      startTime: null,
      endTime: null,
      createdDate: null,
      lastUpdatedDate: null,
      affectedSegments: [],
      source: null,
      raw: { Id: "x", Message: "hello" },
      current: true,
      firstSeenAt: "2026-08-20T12:00:00.000Z",
      lastSeenAt: "2026-08-20T12:00:00.000Z",
    },
  ]);
  assert.equal(JSON.parse(await readFile(metaFile, "utf8")).alertCount, 1);

  await assert.rejects(
    runSync({
      accountKey: "k",
      retentionDays: 14,
      alertsFile,
      metaFile,
      fetchImpl: async () => new Response("nope", { status: 401 }),
    }),
    /401/,
  );

  await rm(dir, { recursive: true, force: true });
});

test("runSync requires an account key", async () => {
  await assert.rejects(runSync({ accountKey: "", retentionDays: 14, alertsFile: "/tmp/x", metaFile: "/tmp/y" }), /LTA_ACCOUNT_KEY/);
});
