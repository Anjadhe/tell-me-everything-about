// The one merge. Runs in the browser (module script) and in the Worker.
//
// A state is { v, prompts: [...], tombstones: { id: iso }, settings: {...} }.
// Prompts merge per record by updatedAt (newest wins, deterministic tie-break
// on the serialized record). A tombstone beats any record it is newer than;
// an edit newer than the tombstone beats the delete. Settings are one record
// and merge whole by their own updatedAt. Nothing here is ever lossy on a
// concurrent edit from two browsers, which is the whole reason the server
// exists.

export const STATE_VERSION = 1;
export const MAX_PROMPTS = 6;
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function emptyState() {
  return { v: STATE_VERSION, prompts: [], tombstones: {}, settings: {} };
}

function ts(s) {
  const t = Date.parse(s || '');
  return Number.isFinite(t) ? t : 0;
}

function pickNewer(a, b) {
  const ta = ts(a.updatedAt), tb = ts(b.updatedAt);
  if (ta !== tb) return ta > tb ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function normalize(state) {
  const s = state && typeof state === 'object' ? state : {};
  const prompts = Array.isArray(s.prompts) ? s.prompts.filter(p => p && typeof p.id === 'string') : [];
  const tombstones = s.tombstones && typeof s.tombstones === 'object' ? { ...s.tombstones } : {};
  const settings = s.settings && typeof s.settings === 'object' ? { ...s.settings } : {};
  return { v: STATE_VERSION, prompts, tombstones, settings };
}

export function merge(a, b, now = Date.now()) {
  const A = normalize(a), B = normalize(b);
  const tombstones = {};
  for (const src of [A.tombstones, B.tombstones]) {
    for (const [id, at] of Object.entries(src)) {
      if (now - ts(at) > TOMBSTONE_TTL_MS) continue;
      if (!tombstones[id] || ts(at) > ts(tombstones[id])) tombstones[id] = at;
    }
  }
  const byId = new Map();
  for (const p of [...A.prompts, ...B.prompts]) {
    const cur = byId.get(p.id);
    byId.set(p.id, cur ? pickNewer(cur, p) : p);
  }
  const prompts = [];
  for (const [id, p] of byId) {
    const dead = tombstones[id];
    if (dead && ts(dead) >= ts(p.updatedAt)) continue;
    if (dead) delete tombstones[id];
    prompts.push(p);
  }
  prompts.sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || ts(x.updatedAt) - ts(y.updatedAt));
  const settings = ts(A.settings.updatedAt) >= ts(B.settings.updatedAt) ? A.settings : B.settings;
  return { v: STATE_VERSION, prompts, tombstones, settings };
}

export function sameState(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
