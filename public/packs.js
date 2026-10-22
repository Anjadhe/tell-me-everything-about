// Cards for the visitor's own interests ("Roman history"), written by
// Claude on the server and shared by everyone who types the same thing.
// The request carries the interest's words and nothing else: no cookie, no
// account. Packs are kept in this browser for a day, then asked for again
// (the server refreshes its own copy weekly). One request at a time.

import { keywordList, interestKeyOf } from './interests.js?v=3db8e47be6';

const CACHE_KEY = 'tmea:interest-packs';
const FRESH_MS = 24 * 60 * 60 * 1000;
export const MAX_INTERESTS = 8;

const state = {};          // key → { key, text, status, name, cards, error }
const queue = [];
let busy = false;
let notify = () => {};

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch { return {}; }
}
function writeCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* private mode */ }
}

// The interests, in the order typed, each with what is known so far.
// status: 'loading' | 'ready' | 'unsuitable' | 'error'.
export function packsFor(keywords) {
  const out = [];
  for (const text of keywordList(keywords).slice(0, MAX_INTERESTS)) {
    const key = interestKeyOf(text);
    if (key && state[key] && !out.some(p => p.key === key)) out.push(state[key]);
  }
  return out;
}

// Make sure every interest has a pack, fetching the ones missing or old.
// onChange runs whenever one arrives.
export function ensurePacks(keywords, onChange) {
  if (onChange) notify = onChange;
  const cache = readCache();
  const wanted = new Set();
  for (const text of keywordList(keywords).slice(0, MAX_INTERESTS)) {
    const key = interestKeyOf(text);
    if (!key || wanted.has(key)) continue;
    wanted.add(key);
    const c = cache[key];
    if (c && Date.now() - c.at < FRESH_MS) {
      state[key] = { key, text, status: c.suitable ? 'ready' : 'unsuitable', name: c.name || text, cards: c.cards || [] };
      continue;
    }
    if (state[key]?.status === 'loading') continue;
    // An older copy stays on show while a fresh one is fetched.
    state[key] = { key, text, status: c?.suitable ? 'ready' : 'loading', name: c?.name || text, cards: c?.cards || [] };
    queue.push(key);
  }
  for (const key of Object.keys(state)) if (!wanted.has(key)) delete state[key];
  pump();
}

export function retryPack(key) {
  const p = state[key];
  if (!p || p.status === 'loading') return;
  state[key] = { ...p, status: 'loading', error: '' };
  queue.push(key);
  notify(key);
  pump();
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const key = queue.shift();
    const p = state[key];
    if (!p) continue;
    try {
      const res = await fetch('/api/interest', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: p.text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
      const cache = readCache();
      cache[key] = { at: Date.now(), suitable: !!data.suitable, name: data.name || p.text, cards: data.suitable ? data.cards || [] : [] };
      writeCache(cache);
      if (state[key]) state[key] = { key, text: p.text, status: data.suitable ? 'ready' : 'unsuitable', name: cache[key].name, cards: cache[key].cards };
    } catch (err) {
      if (state[key]) state[key] = { ...state[key], status: state[key].cards.length ? 'ready' : 'error', error: err.message };
    }
    notify(key);
  }
  busy = false;
}
