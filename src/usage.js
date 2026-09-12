// Turning edge traffic into "people": pure functions, pinned by tests.
//
// Cloudflare counts every request. A new domain draws certificate-log
// scanners, uptime probes, link unfurlers and our own test runs, so the raw
// numbers say nothing about people. These filters are the rules I applied by
// hand the first time; they live here so the dashboard applies the same ones
// every day and says what it dropped.

export const ENGINE_IDS = ['google-ai', 'google', 'perplexity', 'chatgpt', 'claude', 'grok', 'duckduckgo'];

const BOT_RX = /bot|crawl|spider|slurp|fetch|curl\/|wget|python|go-http|okhttp|java\/|libwww|httpclient|headless|lighthouse|pingdom|uptime|monitor|scan|check|preview|unfurl|facebookexternalhit|twitterbot|discordbot|telegrambot|whatsapp|slack|linkedin|embedly|quora|pinterest|nexus 5 build\/mra58n|phantom|selenium|playwright|puppeteer|node-fetch|axios|postman|insomnia|^$/i;

const BROWSER_RX = /(chrome|crios|firefox|fxios|safari|edg|opr|samsungbrowser|vivaldi|brave)\//i;

export function isHumanUA(ua) {
  const s = String(ua || '');
  if (BOT_RX.test(s)) return false;
  return BROWSER_RX.test(s);
}

export const PAGE_PATHS = new Set(['/', '/about']);

// rows: [{ userAgent, clientRequestPath, clientCountryName, count }]
export function classifyDay(rows) {
  let human = 0, filtered = 0, droppedAssets = 0, droppedBots = 0;
  const byCountry = new Map();
  const uas = new Map();
  for (const r of rows || []) {
    const n = Number(r.count) || 0;
    // Not a person: scanners, probes, unfurlers, headless runs. Whatever they asked for.
    if (!isHumanUA(r.userAgent)) { filtered += n; droppedBots += n; continue; }
    // A person, but the stylesheet, a script, the favicon or a sync call, not a page.
    if (!PAGE_PATHS.has(r.clientRequestPath)) { filtered += n; droppedAssets += n; continue; }
    human += n;
    byCountry.set(r.clientCountryName || '?', (byCountry.get(r.clientCountryName || '?') || 0) + n);
    uas.set(r.userAgent, (uas.get(r.userAgent) || 0) + n);
  }
  return {
    human,
    filtered,
    droppedAssets,
    droppedBots,
    countries: [...byCountry].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    // Distinct human user agents is a rough floor on "how many different browsers".
    browsers: uas.size,
  };
}

export function lastDays(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
