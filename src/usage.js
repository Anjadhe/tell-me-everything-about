// Tagging edge traffic so the dashboard can filter it. Pure; pinned by tests.
//
// Nothing is dropped. Every request row Cloudflare reports comes back with
// tags (who: person or not; what: page, asset, api, other; browser family),
// and the page filters on those. The tags are the rules I first applied by
// hand: a new domain draws certificate-log scanners, uptime probes, link
// unfurlers and our own headless test runs, none of which are people.

export const ENGINE_IDS = ['google-ai', 'google', 'perplexity', 'chatgpt', 'claude', 'grok', 'duckduckgo'];

const BOT_RX = /bot|crawl|spider|slurp|fetch|curl\/|wget|python|go-http|okhttp|java\/|libwww|httpclient|headless|lighthouse|pingdom|uptime|monitor|scan|check|preview|unfurl|facebookexternalhit|twitterbot|discordbot|telegrambot|whatsapp|slack|linkedin|embedly|quora|pinterest|nexus 5 build\/mra58n|phantom|selenium|playwright|puppeteer|node-fetch|axios|postman|insomnia|^$/i;

const BROWSER_RX = /(chrome|crios|firefox|fxios|safari|edg|opr|samsungbrowser|vivaldi|brave)\//i;

export function isHumanUA(ua) {
  const s = String(ua || '');
  if (BOT_RX.test(s)) return false;
  return BROWSER_RX.test(s);
}

export function browserFamily(ua) {
  const s = String(ua || '');
  if (!isHumanUA(s)) return 'Not a browser';
  if (/edg(e|a|ios)?\//i.test(s)) return 'Edge';
  if (/opr\/|opera/i.test(s)) return 'Opera';
  if (/samsungbrowser/i.test(s)) return 'Samsung';
  if (/vivaldi/i.test(s)) return 'Vivaldi';
  if (/brave/i.test(s)) return 'Brave';
  if (/firefox|fxios/i.test(s)) return 'Firefox';
  if (/chrome|crios/i.test(s)) return 'Chrome';
  if (/safari/i.test(s)) return 'Safari';
  return 'Other browser';
}

export const PAGE_PATHS = new Set(['/', '/about', '/admin']);

export function requestKind(path) {
  const p = String(path || '');
  if (PAGE_PATHS.has(p)) return 'page';
  if (p.startsWith('/api/') || p.startsWith('/auth/')) return 'api';
  if (/\.(css|js|svg|png|ico|woff2?)$/i.test(p)) return 'asset';
  return 'other';
}

export function deviceKind(ua) {
  const s = String(ua || '');
  if (/iphone|android.*mobile|windows phone/i.test(s)) return 'Phone';
  if (/ipad|android(?!.*mobile)|tablet/i.test(s)) return 'Tablet';
  if (isHumanUA(s)) return 'Desktop';
  return 'None';
}

// rows: [{ userAgent, clientRequestPath, clientCountryName, count }]
// Returns the same rows with tags, user agents trimmed, nothing removed.
export function tagRows(rows) {
  return (rows || []).map(r => {
    const ua = String(r.userAgent || '');
    return {
      ua: ua.slice(0, 160),
      path: String(r.clientRequestPath || ''),
      country: String(r.clientCountryName || '?'),
      n: Number(r.count) || 0,
      who: isHumanUA(ua) ? 'person' : 'not-person',
      what: requestKind(r.clientRequestPath),
      browser: browserFamily(ua),
      device: deviceKind(ua),
    };
  });
}

export function lastDays(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
