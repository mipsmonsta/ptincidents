import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTweets, isBusIncident, fetchProfileAlerts, OPERATORS } from "./fetch-x.mjs";

const fixture = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sbst-x.html"),
  "utf8",
);

test("parseTweets extracts tweets with id, date and text from static HTML", () => {
  const tweets = parseTweets(fixture, "SBSTransit_Ltd");
  assert.equal(tweets.length, 4);
  const first = tweets[0];
  assert.equal(first.statusId, "2090348058039210049");
  assert.equal(first.postedAt, "2026-08-20T07:59:48.000Z");
  assert.equal(first.handle, "SBSTransit_Ltd");
  assert.match(first.text, /Services 161 and 168 are being delayed/);
  assert.ok(!/\n/.test(first.text));
});

test("parseTweets decodes HTML entities and skips malformed blocks", () => {
  const html = [
    '<meta content="2026-01-01T00:00:00.000Z" itemProp="datePublished"/>',
    '<meta content="https://x.com/SBSTransit_Ltd/status/111" itemProp="url"/>',
    '<meta content="He said &quot;hi&quot; &amp; left &#x27;early&#x27;." itemProp="text"/>',
    '<meta content="broken" itemProp="datePublished"/>',
  ].join("");
  const tweets = parseTweets(html, "SBSTransit_Ltd");
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].text, "He said \"hi\" & left 'early'.");
});

test("isBusIncident filters incident posts from promo noise", () => {
  assert.ok(isBusIncident("Pls note that Service 53 is being diverted from its regular route"));
  assert.ok(isBusIncident("Services 161 and 168 are being delayed along SLE"));
  assert.ok(isBusIncident("Several bus services will be affected by road closures for road resurfacing"));
  assert.ok(isBusIncident("Bus service 176 will skip some bus stops during the affected period"));
  assert.ok(isBusIncident("Service 170X is back to normal operation"));
  assert.ok(!isBusIncident("Join #SMRT and play a vital role in keeping Singapore moving"));
  assert.ok(!isBusIncident("We're hosting a recruitment fair this August with on-site interviews"));
  assert.ok(!isBusIncident("Happy Deepavali from all of us at the depot"));
});

test("fetchProfileAlerts returns only bus-incident tweets tagged with operator", () => {
  const alerts = fetchProfileAlerts("SBSTransit_Ltd", fixture);
  assert.ok(alerts.length >= 4);
  for (const a of alerts) {
    assert.equal(a.mode, "bus");
    assert.equal(a.operator, "SBST");
    assert.match(a.id, /^x:\d+$/);
    assert.ok(a.postedAt);
    assert.equal(a.source, "X/SBSTransit_Ltd");
    assert.equal(a.current, true);
  }
});

test("OPERATORS covers the four bus operators", () => {
  assert.deepEqual(
    OPERATORS.map((o) => o.name).sort(),
    ["GAS", "SBST", "SMRT", "TTS"],
  );
});
