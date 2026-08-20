export const OPERATORS = [
  { handle: "SMRT_Singapore", name: "SMRT" },
  { handle: "SBSTransit_Ltd", name: "SBST" },
  { handle: "goaheadsg", name: "GAS" },
  { handle: "towertransitSG", name: "TTS" },
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const TWEET_RE =
  /<meta content="([^"]*?)" itemProp="datePublished"\/><meta content="(https:\/\/x\.com\/[^"]*?\/status\/(\d+))" itemProp="url"\/><meta content="([\s\S]*?)" itemProp="text"\/>/g;

export function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export function normalizeWhitespace(str) {
  return str.replace(/\s+/g, " ").trim();
}

const BUS_INCIDENT_RE =
  /\b(bus(es| service| services)?)\b|divert|disrupt|delay|alight|resum|back to normal|normal operation|fault|accident|incident|breakdown|skip(ing|s)? bus stop|road (closure|closur|work|resurfacing|works)/i;

const PROMO_RE =
  /recruit|hiring|join us|career|vacanc|job fair|workshop|celebrat|giveaway|happy |good morning|promotion|register now|book now|festival|mural|roadshow/i;

export function isBusIncident(text) {
  return BUS_INCIDENT_RE.test(text) && !PROMO_RE.test(text);
}

export function parseTweets(html, handle) {
  const tweets = [];
  for (const match of html.matchAll(TWEET_RE)) {
    const [, datePublished, , statusId, rawText] = match;
    const text = normalizeWhitespace(decodeEntities(rawText));
    const date = new Date(datePublished);
    if (!text || Number.isNaN(date.getTime())) continue;
    tweets.push({
      statusId,
      handle,
      postedAt: date.toISOString(),
      text,
    });
  }
  return tweets;
}

export function fetchProfileAlerts(handle, html) {
  const tweets = parseTweets(html, handle);
  const incidents = tweets.filter((t) => isBusIncident(t.text));
  return incidents.map((t) => ({
    id: `x:${t.statusId}`,
    mode: "bus",
    operator: OPERATORS.find((o) => o.handle === handle)?.name ?? handle,
    message: t.text,
    postedAt: t.postedAt,
    source: `X/${handle}`,
    raw: { handle, statusId: t.statusId },
    current: true,
  }));
}

export async function fetchXAlerts({ fetchImpl = fetch, log = console.error } = {}) {
  const alerts = [];
  for (const { handle } of OPERATORS) {
    try {
      const res = await fetchImpl(`https://x.com/${handle}`, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
      });
      if (!res.ok) {
        log(`X profile @${handle} responded with ${res.status}; skipping`);
        continue;
      }
      const html = await res.text();
      alerts.push(...fetchProfileAlerts(handle, html));
    } catch (err) {
      log(`Failed to fetch X profile @${handle}: ${err.message}`);
    }
  }
  return alerts;
}
