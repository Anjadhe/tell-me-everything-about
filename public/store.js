// The prompts, the settings and the account, shared by the home page and the
// prompts page.
//
// Local first: the whole state lives in localStorage and the page works with
// no account. Signing in adds a server copy, merged per prompt by the same
// merge the Worker runs, so two browsers can edit the list without one
// clobbering the other. Two tabs of this site stay in step through the
// storage event, and a page restored from the back-forward cache re-reads.

import { merge, emptyState, normalize, sameState, MAX_PROMPTS } from './merge.js?v=98030b1b32';

export { MAX_PROMPTS };

const STORE_KEY = 'tmea:state';
const THEME_KEY = 'tmea:theme';
const SELECTED_KEY = 'tmea:selected';
const SIGNED_IN_KEY = 'tmea:signed-in'; // hint only; the cookie is the truth
// Recent topics are the one thing the page keeps that a person typed. They
// live under their own keys, outside the synced state, so they can never
// reach the server; the switch for them is local too.
const RECENT_KEY = 'tmea:recent';
const RECENT_ON_KEY = 'tmea:recent-on';
const MAX_RECENT = 6;

// Starters carry FIXED ids and an old stamp: every fresh browser seeds the
// same three records, so merging two browsers never duplicates them, and any
// real edit or deletion made anywhere is newer and wins.
const STARTER_STAMP = '2026-01-01T00:00:00.000Z';
const STARTER_PROMPTS = [
  { id: 'starter-everything', label: 'Everything about', template: 'Tell me everything about {}' },
  { id: 'starter-explain', label: 'Explain simply', template: 'Explain {} simply, as if to a smart friend who knows nothing about it' },
  { id: 'starter-latest', label: 'Latest', template: "What's the latest on {}? Only recent developments, with dates" },
];

let state = null;
let user = null;          // { email } when signed in
let syncTimer = null;
const listeners = new Set();

// Pages subscribe to hear about changes they did not make themselves:
// 'state' (merged from the server, another tab, or the cache), 'user', and
// 'busy' / 'idle' while a sync is in flight.
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(what) {
  for (const fn of listeners) fn(what);
}

// ---------- state ----------

function readStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* fall through */ }
  return null;
}

function load() {
  const stored = readStored();
  if (stored) return stored;
  const s = emptyState();
  s.prompts = STARTER_PROMPTS.map((p, i) => ({ ...p, engine: 'google-ai', order: i, updatedAt: STARTER_STAMP }));
  s.settings = { defaultEngine: 'google-ai', newTab: false, theme: 'system', updatedAt: STARTER_STAMP };
  save(s, { sync: false });
  return s;
}

function save(next = state, { sync = true } = {}) {
  state = normalize(next);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  if (sync && user) scheduleSync();
}

export function reload() {
  const stored = readStored();
  if (stored && !sameState(stored, state)) {
    state = stored;
    applyTheme(setting('theme', 'system'));
    emit('state');
  }
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
}

export function prompts() {
  return [...state.prompts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function promptById(id) {
  return state.prompts.find(p => p.id === id) || null;
}

export function setting(key, fallback) {
  const v = state.settings?.[key];
  return v === undefined ? fallback : v;
}

export function updateSettings(patch) {
  save({ ...state, settings: { ...state.settings, ...patch, updatedAt: new Date().toISOString() } });
}

export function upsertPrompt(p) {
  const rest = state.prompts.filter(x => x.id !== p.id);
  save({ ...state, prompts: [...rest, { ...p, updatedAt: new Date().toISOString() }] });
}

export function deletePrompt(id) {
  save({
    ...state,
    prompts: state.prompts.filter(x => x.id !== id),
    tombstones: { ...state.tombstones, [id]: new Date().toISOString() },
  });
}

export function reorder(ids) {
  const now = new Date().toISOString();
  const byId = new Map(state.prompts.map(p => [p.id, p]));
  const next = ids.map((id, i) => ({ ...byId.get(id), order: i, updatedAt: now }));
  save({ ...state, prompts: next });
}

// The prompt the home page shows. The prompts page sets it to the one being
// edited, so going back lands on it.
export function selectedId() {
  try { return localStorage.getItem(SELECTED_KEY); } catch { return null; }
}
export function setSelectedId(id) {
  try { localStorage.setItem(SELECTED_KEY, id); } catch { /* ignore */ }
}

// ---------- recent topics (this browser only) ----------

export function recentOn() {
  try { return localStorage.getItem(RECENT_ON_KEY) === '1'; } catch { return false; }
}

export function recentTopics() {
  if (!recentOn()) return [];
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

export function remember(topic) {
  if (!recentOn()) return;
  const t = String(topic || '').trim().slice(0, 80);
  if (!t) return;
  const next = [t, ...recentTopics().filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

export function setRecentOn(on) {
  try {
    if (on) localStorage.setItem(RECENT_ON_KEY, '1');
    else { localStorage.removeItem(RECENT_ON_KEY); localStorage.removeItem(RECENT_KEY); }
  } catch { /* ignore */ }
}

// ---------- theme ----------

export function applyTheme(theme) {
  const t = theme === 'light' || theme === 'dark' ? theme : 'system';
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
}

// ---------- account + sync ----------

export function currentUser() {
  return user;
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function requestLink(email) {
  return api('POST', '/api/auth/request', { email });
}

// A signed-out visitor makes no account request at all: the page is its
// own cache. (Explore's list is the only other fetch, cookie-less and the
// same for everyone.) The hint flag is set by the sign-in redirect and
// cleared the first time the server says the session is gone.
async function whoAmI() {
  let hint = false;
  try { hint = localStorage.getItem(SIGNED_IN_KEY) === '1'; } catch { /* ignore */ }
  if (!hint) { setUser(null); return; }
  try {
    const me = await api('GET', '/api/me');
    setUser(me.signedIn ? { email: me.email } : null);
  } catch (err) {
    setUser(null);
    if (err.status === 401) setSignedInHint(false);
  }
}

function setUser(next) {
  user = next;
  emit('user');
}

function setSignedInHint(on) {
  try { on ? localStorage.setItem(SIGNED_IN_KEY, '1') : localStorage.removeItem(SIGNED_IN_KEY); } catch { /* ignore */ }
}

function signedOutByServer() {
  setSignedInHint(false);
  setUser(null);
}

async function pullAndMerge() {
  if (!user) return;
  emit('busy');
  try {
    const { state: remote } = await api('GET', '/api/state');
    const merged = merge(state, remote);
    const changedLocally = !sameState(merged, state);
    const changedRemotely = !remote || !sameState(merged, remote);
    if (changedLocally) {
      save(merged, { sync: false });
      applyTheme(setting('theme', 'system'));
      emit('state');
    }
    if (changedRemotely) await push();
  } catch (err) {
    if (err.status === 401) signedOutByServer();
  } finally {
    emit('idle');
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(push, 600);
}

async function push() {
  if (!user) return;
  emit('busy');
  try {
    const { state: merged } = await api('PUT', '/api/state', { state });
    if (!sameState(merged, state)) {
      save(merged, { sync: false });
      emit('state');
    }
  } catch (err) {
    if (err.status === 401) signedOutByServer();
  } finally {
    emit('idle');
  }
}

export async function signOut() {
  try { await api('POST', '/api/auth/logout'); } catch { /* cookie is gone either way */ }
  setSignedInHint(false);
  setUser(null);
}

export async function deleteAccount() {
  await api('DELETE', '/api/account');
  setSignedInHint(false);
  setUser(null);
}

// Call once per page, after subscribing.
export function start() {
  const params = new URLSearchParams(location.search);
  if (params.has('signed-in')) { setSignedInHint(true); history.replaceState(null, '', location.pathname + location.hash); }
  whoAmI().then(pullAndMerge);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullAndMerge(); });
  window.addEventListener('storage', e => { if (e.key === STORE_KEY) reload(); });
  window.addEventListener('pageshow', e => { if (e.persisted) { reload(); pullAndMerge(); } });
}

state = load();
applyTheme(setting('theme', 'system'));
