// Tell me everything about — the account and sync half.
//
// The page works with no account at all; this Worker exists so the prompt
// list can follow the user to another browser. It knows an email address, a
// session and one small JSON blob per user, and nothing else: no topics are
// ever sent here (launching happens in the browser, straight to the engine).
// It also writes the day's Explore list once each morning and serves it to
// everyone alike (src/explore.js).

import { merge, normalize, sameState } from '../public/merge.js';
import { ENGINE_IDS, LAUNCH_FROM, tagRows, lastDays } from './usage.js';
import { generate, evergreenFeed, sponsoredCard } from './explore.js';

const SESSION_COOKIE = 'tmea_session';
const SESSION_DAYS = 90;
const LINK_MINUTES = 15;
const LINKS_PER_EMAIL_PER_HOUR = 5;
const LINKS_PER_IP_PER_HOUR = 20;
const MAX_STATE_BYTES = 192 * 1024; // prompts, settings, and up to 150 saved cards
const EXPLORE_KEEP_DAYS = 30;
const EXPLORE_EDGE_SECONDS = 900;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
        return await route(request, env, ctx, url);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', path: url.pathname, message: err?.message }));
      return json({ error: 'Something went wrong on our side. Try again in a moment.' }, 500);
    }
  },

  // Daily, from the cron in wrangler.jsonc.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refreshExplore(env).catch(() => {}));
  },
};

async function route(request, env, ctx, url) {
  const { pathname } = url;
  const method = request.method;

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request, url)) {
    return json({ error: 'Cross-site request refused.' }, 403);
  }

  if (pathname === '/api/auth/request' && method === 'POST') return authRequest(request, env, ctx, url);
  if (pathname === '/auth/verify' && method === 'GET') return authVerify(request, env, url);
  if (pathname === '/api/auth/logout' && method === 'POST') return logout(request, env);
  if (pathname === '/api/me' && method === 'GET') return me(request, env);
  if (pathname === '/api/state' && method === 'GET') return getState(request, env);
  if (pathname === '/api/state' && method === 'PUT') return putState(request, env);
  if (pathname === '/api/account' && method === 'DELETE') return deleteAccount(request, env);
  if (pathname === '/api/launch' && method === 'POST') return countLaunch(request, env, ctx);
  if (pathname === '/api/admin/usage' && method === 'GET') return adminUsage(request, env);
  if (pathname === '/api/explore' && method === 'GET') return getExplore(request, env, ctx);
  if (pathname === '/api/admin/explore' && method === 'POST') return adminExplore(request, env);
  if (pathname === '/api/sponsored' && method === 'POST') return countSponsored(request, env, ctx);
  return json({ error: 'Not found.' }, 404);
}

// ---------- auth ----------

async function authRequest(request, env, ctx, url) {
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || '';
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [byEmail, byIp] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM magic_links WHERE email = ? AND created_at > ?').bind(email, hourAgo),
    env.DB.prepare('SELECT COUNT(*) AS n FROM magic_links WHERE ip = ? AND created_at > ?').bind(ip, hourAgo),
  ]);
  if (byEmail.results[0].n >= LINKS_PER_EMAIL_PER_HOUR || byIp.results[0].n >= LINKS_PER_IP_PER_HOUR) {
    return json({ error: 'Too many sign-in links requested. Check your inbox, or try again in an hour.' }, 429);
  }

  const token = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + LINK_MINUTES * 60_000);
  await env.DB.prepare(
    'INSERT INTO magic_links (token_hash, email, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(await sha256(token), email, ip, now.toISOString(), expires.toISOString()).run();

  const link = `${url.origin}/auth/verify?token=${token}`;
  const dev = env.DEV_LINKS === '1';
  if (dev) {
    console.log(JSON.stringify({ level: 'info', event: 'magic_link_dev', email, link }));
    return json({ ok: true, devLink: link });
  }
  ctx.waitUntil(sendMagicLink(env, email, link));
  return json({ ok: true });
}

async function authVerify(request, env, url) {
  const token = url.searchParams.get('token') || '';
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return htmlMessage('This sign-in link is not valid.', 400);
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT email, expires_at, used_at FROM magic_links WHERE token_hash = ?').bind(hash).first();
  if (!row || row.used_at) return htmlMessage('This sign-in link was already used. Ask for a new one from the page.', 400);
  if (Date.parse(row.expires_at) < Date.now()) return htmlMessage('This sign-in link has expired. Ask for a new one from the page.', 400);

  const now = new Date().toISOString();
  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(row.email).first();
  if (!user) {
    user = { id: crypto.randomUUID() };
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(user.id, row.email, now).run();
  }
  const sessionId = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await env.DB.batch([
    env.DB.prepare('UPDATE magic_links SET used_at = ? WHERE token_hash = ?').bind(now, hash),
    env.DB.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(sessionId), user.id, now, expires.toISOString()),
    env.DB.prepare('DELETE FROM magic_links WHERE expires_at < ?').bind(new Date(Date.now() - 86400_000).toISOString()),
  ]);

  const headers = new Headers({ Location: '/?signed-in=1' });
  headers.append('Set-Cookie', sessionCookie(sessionId, expires, url));
  return new Response(null, { status: 303, headers });
}

async function logout(request, env) {
  const sid = readCookie(request, SESSION_COOKIE);
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(sid)).run();
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.append('Set-Cookie', sessionCookie('', new Date(0), new URL(request.url)));
  return new Response(JSON.stringify({ ok: true }), { headers });
}

async function currentUser(request, env) {
  const sid = readCookie(request, SESSION_COOKIE);
  if (!sid) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?'
  ).bind(await sha256(sid)).first();
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  return { id: row.id, email: row.email };
}

async function me(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ signedIn: false }, 401);
  return json({ signedIn: true, email: user.email });
}

async function deleteAccount(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'Not signed in.' }, 401);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM states WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM magic_links WHERE email = ?').bind(user.email),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.append('Set-Cookie', sessionCookie('', new Date(0), new URL(request.url)));
  return new Response(JSON.stringify({ ok: true }), { headers });
}

// ---------- state ----------

async function getState(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'Not signed in.' }, 401);
  const row = await env.DB.prepare('SELECT data, updated_at FROM states WHERE user_id = ?').bind(user.id).first();
  return json({ state: row ? JSON.parse(row.data) : null, updatedAt: row?.updated_at || null });
}

async function putState(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'Not signed in.' }, 401);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_STATE_BYTES) return json({ error: 'That is more than the page can hold.' }, 413);
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return json({ error: 'Send a state object.' }, 400);
  const incoming = normalize(body.state);
  if (JSON.stringify(incoming).length > MAX_STATE_BYTES) return json({ error: 'That is more than the page can hold.' }, 413);

  const row = await env.DB.prepare('SELECT data FROM states WHERE user_id = ?').bind(user.id).first();
  const stored = row ? JSON.parse(row.data) : null;
  const merged = merge(stored, incoming);
  const now = new Date().toISOString();
  if (!stored || !sameState(stored, merged)) {
    await env.DB.prepare(
      'INSERT INTO states (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    ).bind(user.id, JSON.stringify(merged), now).run();
  }
  return json({ state: merged, updatedAt: now });
}

// ---------- usage ----------

// One anonymous count per launch: the engine name and nothing else. No topic,
// no id, no cookie is read. The page fires it with keepalive right before it
// navigates away, so the write happens after the response is gone.
async function countLaunch(request, env, ctx) {
  const body = await readJson(request);
  const engine = ENGINE_IDS.includes(body?.engine) ? body.engine : 'other';
  const from = LAUNCH_FROM.includes(body?.from) ? body.from : 'typed';
  const day = new Date().toISOString().slice(0, 10);
  ctx.waitUntil(Promise.all([bump(env, day, 'launch', engine), bump(env, day, 'from', from)]));
  return new Response(null, { status: 204 });
}

function bump(env, day, kind, key) {
  return env.DB.prepare(
    'INSERT INTO counters (day, kind, key, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1'
  ).bind(day, kind, key).run();
}

async function adminUsage(request, env) {
  if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY is not set on the Worker.' }, 503);
  const given = request.headers.get('x-admin-key') || '';
  if (!(await timingSafeEqualString(given, env.ADMIN_KEY))) return json({ error: 'Wrong key.' }, 401);

  const days = lastDays(14);
  const since = days[0];
  const [accounts, signins, launches, froms, explore, sponsoredRows] = await env.DB.batch([
    env.DB.prepare('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM sessions WHERE expires_at > ?) AS sessions').bind(new Date().toISOString()),
    env.DB.prepare("SELECT substr(used_at, 1, 10) AS day, COUNT(*) AS n FROM magic_links WHERE used_at IS NOT NULL AND used_at >= ? GROUP BY day").bind(since),
    env.DB.prepare("SELECT day, key, n FROM counters WHERE kind = 'launch' AND day >= ?").bind(since),
    env.DB.prepare("SELECT key, SUM(n) AS n FROM counters WHERE kind = 'from' AND day >= ? GROUP BY key").bind(since),
    env.DB.prepare('SELECT day, created_at, data FROM explore ORDER BY day DESC LIMIT 1'),
    env.DB.prepare("SELECT kind, key, SUM(n) AS n FROM counters WHERE kind IN ('sponsored-view', 'sponsored-click') AND day >= ? GROUP BY kind, key").bind(since),
  ]);

  const launchByDay = Object.fromEntries(days.map(d => [d, 0]));
  const launchByEngine = {};
  for (const r of launches.results) {
    launchByDay[r.day] = (launchByDay[r.day] || 0) + r.n;
    launchByEngine[r.key] = (launchByEngine[r.key] || 0) + r.n;
  }
  const signinByDay = Object.fromEntries(days.map(d => [d, 0]));
  for (const r of signins.results) signinByDay[r.day] = r.n;

  const launchFrom = Object.fromEntries(froms.results.map(r => [r.key, r.n]));
  const sponsored = {};
  for (const r of sponsoredRows.results) {
    sponsored[r.key] ||= { views: 0, clicks: 0 };
    sponsored[r.key][r.kind === 'sponsored-view' ? 'views' : 'clicks'] += r.n;
  }
  const latest = explore.results[0];
  const exploreInfo = latest
    ? { day: latest.day, createdAt: latest.created_at, ...pick(JSON.parse(latest.data)) }
    : null;

  const traffic = await edgeTraffic(env, days);
  function pick(feed) {
    const fresh = feed.cards.filter(c => !c.carried);
    const byCategory = {};
    for (const c of fresh) byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    return { cards: fresh.length, carried: feed.cards.length - fresh.length, byCategory, model: feed.model || null };
  }

  return json({
    generatedAt: new Date().toISOString(),
    days,
    accounts: accounts.results[0],
    signinByDay,
    launchByDay,
    launchByEngine,
    launchFrom,
    sponsored,
    explore: exploreInfo,
    traffic,
  });
}

// Cloudflare's edge analytics, one day per query (the free plan caps a query
// at one day). Every row comes back, tagged by usage.js; the page filters.
// Needs CF_ANALYTICS_TOKEN (Analytics: Read on the zone) and CF_ZONE_TAG.
async function edgeTraffic(env, days) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_TAG) return { available: false, reason: 'CF_ANALYTICS_TOKEN or CF_ZONE_TAG is not set.' };
  const query = `query($zone:String!,$from:Time!,$to:Time!){ viewer { zones(filter:{zoneTag:$zone}) {
    rows: httpRequestsAdaptiveGroups(limit:2000, filter:{datetime_geq:$from, datetime_lt:$to}) {
      count dimensions { userAgent clientRequestPath clientCountryName } } } } }`;
  const out = {};
  const results = await Promise.all(days.map(async day => {
    const from = `${day}T00:00:00Z`;
    const to = new Date(Date.parse(from) + 86400_000).toISOString();
    try {
      const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { zone: env.CF_ZONE_TAG, from, to } }),
      });
      const data = await res.json();
      if (data.errors?.length) return [day, { error: data.errors[0].message }];
      const rows = (data.data?.viewer?.zones?.[0]?.rows || []).map(r => ({ ...r.dimensions, count: r.count }));
      return [day, { rows: tagRows(rows) }];
    } catch (err) {
      return [day, { error: err?.message || 'fetch failed' }];
    }
  }));
  for (const [day, v] of results) out[day] = v;
  return { available: true, byDay: out };
}

// ---------- explore ----------

// The newest stored list, or the evergreen one before the first run. Every
// visitor gets the same bytes, so it is cached at the edge for a few minutes
// and in the browser briefly; no cookie is read and none is needed.
async function getExplore(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL('/api/explore', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const day = today();
  const [latest, campaigns] = await env.DB.batch([
    env.DB.prepare('SELECT data FROM explore ORDER BY day DESC LIMIT 1'),
    env.DB.prepare('SELECT * FROM sponsored WHERE active = 1 AND (starts IS NULL OR starts <= ?) AND (ends IS NULL OR ends >= ?) ORDER BY id').bind(day, day),
  ]);
  const feed = latest.results[0] ? JSON.parse(latest.results[0].data) : evergreenFeed(day);
  feed.sponsored = campaigns.results.map(sponsoredCard).filter(Boolean);
  const body = JSON.stringify(feed);
  const res = new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${EXPLORE_EDGE_SECONDS}, stale-while-revalidate=86400`,
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// Writes today's list. With no ANTHROPIC_API_KEY there is nothing to write
// and the page keeps showing the evergreen list. On failure the previous day
// stays up; a stale list is better than an empty one.
async function refreshExplore(env) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set.' };
  const day = today();
  try {
    // The last two weeks, newest first: not repeated, and carried along.
    const rows = await env.DB.prepare('SELECT day, data FROM explore WHERE day < ? ORDER BY day DESC LIMIT 14').bind(day).all();
    const history = rows.results.map(r => {
      try { return { day: r.day, cards: JSON.parse(r.data).cards || [] }; } catch { return { day: r.day, cards: [] }; }
    });
    const feed = await generate(env, day, { history });
    const cutoff = new Date(Date.now() - EXPLORE_KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO explore (day, data, created_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, created_at = excluded.created_at')
        .bind(day, JSON.stringify(feed), new Date().toISOString()),
      env.DB.prepare('DELETE FROM explore WHERE day < ?').bind(cutoff),
    ]);
    const fresh = feed.cards.filter(c => !c.carried).length;
    console.log(JSON.stringify({ level: 'info', event: 'explore_written', day, model: feed.model, cards: fresh, carried: feed.cards.length - fresh }));
    return { ok: true, day, model: feed.model, cards: fresh, carried: feed.cards.length - fresh };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'explore_failed', day, message: err?.message }));
    throw err;
  }
}

// One anonymous count per sponsored view or click: the card and the event,
// nothing else. Views are sent once a day per browser (public/explore.js).
async function countSponsored(request, env, ctx) {
  const body = await readJson(request);
  const id = typeof body?.id === 'string' && /^sp-[a-z0-9-]{1,40}$/.test(body.id) ? body.id : null;
  const event = body?.event === 'view' || body?.event === 'click' ? body.event : null;
  if (!id || !event) return new Response(null, { status: 204 });
  ctx.waitUntil(bump(env, today(), `sponsored-${event}`, id));
  return new Response(null, { status: 204 });
}

// Run the daily job now, for the first deploy or after changing the prompt.
async function adminExplore(request, env) {
  if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY is not set on the Worker.' }, 503);
  const given = request.headers.get('x-admin-key') || '';
  if (!(await timingSafeEqualString(given, env.ADMIN_KEY))) return json({ error: 'Wrong key.' }, 401);
  try {
    const result = await refreshExplore(env);
    // The edge cache is per location; this clears the one serving the admin,
    // and the rest expire within EXPLORE_EDGE_SECONDS.
    if (result.ok) await caches.default.delete(new Request(new URL('/api/explore', request.url).toString()));
    return json(result, result.ok ? 200 : 503);
  } catch (err) {
    return json({ ok: false, reason: err?.message || 'failed' }, 502);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function timingSafeEqualString(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------- mail ----------

async function sendMagicLink(env, email, link) {
  const name = env.APP_NAME || 'Tell me everything about';
  const subject = `Your sign-in link for ${name}`;
  const text = `Open this link to sign in to ${name}:\n\n${link}\n\nIt works once and expires in ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.`;
  const html = `<p>Open this link to sign in to ${escapeHtml(name)}:</p><p><a href="${link}">${link}</a></p><p>It works once and expires in ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.</p>`;
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({ to: email, from: { email: env.MAIL_FROM, name }, subject, text, html });
      return;
    }
    if (env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `${name} <${env.MAIL_FROM}>`, to: [email], subject, text, html }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return;
    }
    throw new Error('no mail provider configured (set send_email binding, RESEND_API_KEY, or DEV_LINKS=1)');
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'magic_link_send_failed', message: err?.message }));
  }
}

// ---------- helpers ----------

function sameOrigin(request, url) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}

function normalizeEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function htmlMessage(message, status) {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#f5f5f3;display:grid;place-items:center;min-height:100vh;margin:0}p{max-width:36ch;padding:0 20px}a{color:inherit}</style><p>${escapeHtml(message)} <a href="/">Back to the page.</a></p>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function sessionCookie(value, expires, url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expires.toUTCString()}`;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
