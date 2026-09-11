// Tell me everything about — the account and sync half.
//
// The page works with no account at all; this Worker exists so the prompt
// list can follow the user to another browser. It knows an email address, a
// session and one small JSON blob per user, and nothing else: no topics are
// ever sent here (launching happens in the browser, straight to the engine).

import { merge, normalize, sameState } from '../public/merge.js';

const SESSION_COOKIE = 'tmea_session';
const SESSION_DAYS = 90;
const LINK_MINUTES = 15;
const LINKS_PER_EMAIL_PER_HOUR = 5;
const LINKS_PER_IP_PER_HOUR = 20;
const MAX_STATE_BYTES = 32 * 1024;

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
      if (!res.ok) throw new Error(`resend ${res.status}`);
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
