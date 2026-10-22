// Which Explore cards a visitor sees, and in what order. Runs only in the
// browser: the list from the server is the same for everyone, and this picks
// from it using the visitor's own choices, which sync like prompts but never
// reach the Worker's list or Claude. Pure; pinned by test/interests.test.js.
//
// Choices (in settings):
//   topics       { categories: [id], tags: [id] }   the topics switched on,
//                and the sub-topics ticked under them; DEFAULT_TOPICS until
//                the visitor changes anything
//   collections  [key]   collections from the card manager switched on
//
// A card shows when its topic is on and, if it has sub-topics, at least one
// of them is ticked.

import { CATEGORIES, CATEGORY_IDS, TAG_IDS } from './categories.js?v=5e11922ad2';

// Six topics to start with, every sub-topic ticked; Society and Sport are
// there to switch on.
const DEFAULT_CATEGORIES = ['science', 'technology', 'nature', 'history', 'culture', 'ideas'];
export const DEFAULT_TOPICS = {
  categories: DEFAULT_CATEGORIES,
  tags: CATEGORIES.filter(c => DEFAULT_CATEGORIES.includes(c.id)).flatMap(c => c.tags.map(t => t.id)),
};

export function prefsFrom(setting) {
  const raw = setting('topics', null);
  const t = raw && typeof raw === 'object' && Array.isArray(raw.categories) ? raw : DEFAULT_TOPICS;
  return {
    categories: new Set(t.categories.filter(id => CATEGORY_IDS.includes(id))),
    tags: new Set((t.tags || []).filter(id => TAG_IDS.includes(id))),
    collections: (setting('collections', []) || []).filter(k => typeof k === 'string'),
  };
}

// The settings value for a set of choices, in a stable order.
export function topicsValue(prefs) {
  return {
    categories: CATEGORY_IDS.filter(id => prefs.categories.has(id)),
    tags: TAG_IDS.filter(id => prefs.tags.has(id)),
  };
}

export function visible(card, prefs) {
  if (!prefs.categories.has(card.category)) return false;
  const tags = card.tags || [];
  return !tags.length || tags.some(t => prefs.tags.has(t));
}

// A topic switched on gets all its sub-topics ticked; switched off, none.
export function setCategory(prefs, id, on) {
  const cat = CATEGORIES.find(c => c.id === id);
  const categories = new Set(prefs.categories);
  const tags = new Set(prefs.tags);
  if (on) { categories.add(id); for (const t of cat?.tags || []) tags.add(t.id); }
  else { categories.delete(id); for (const t of cat?.tags || []) tags.delete(t.id); }
  return { ...prefs, categories, tags };
}

// Ticking or unticking a sub-topic; a topic left with none ticked goes off.
export function setTag(prefs, id, on) {
  const tags = new Set(prefs.tags);
  on ? tags.add(id) : tags.delete(id);
  const categories = new Set(prefs.categories);
  for (const c of CATEGORIES) {
    if (!c.tags.some(t => t.id === id)) continue;
    if (on) categories.add(c.id);
    else if (!c.tags.some(t => tags.has(t.id))) categories.delete(c.id);
  }
  return { ...prefs, categories, tags };
}

// The cards to show, best first: the editor's order, today's before carried
// ones, spread so no topic takes more than two places in a row. dismissed:
// ids set aside here; seenBefore: ids this browser showed on an earlier day
// (carried cards it has already had are dropped); category: one topic's pill.
export function rank(cards, prefs, { dismissed = new Set(), seenBefore = new Set(), category = null } = {}) {
  const pool = cards.filter(c =>
    !dismissed.has(c.id) &&
    !(c.carried && seenBefore.has(c.id)) &&
    visible(c, prefs) &&
    (!category || c.category === category));
  const scored = pool.map((c, i) => ({ c, s: 1 - i / Math.max(1, pool.length) - (c.carried ? 0.4 : 0) + (c.pack ? 1 : 0) }));
  scored.sort((a, b) => b.s - a.s);
  return category ? scored.map(x => x.c) : paceCollections(spread(scored.map(x => x.c)));
}

// Keep the best first, but don't let one topic take more than two places in
// a row while others are waiting.
export function spread(list) {
  const rest = [...list];
  const out = [];
  while (rest.length) {
    const a = out[out.length - 1]?.category, b = out[out.length - 2]?.category;
    let i = a && a === b ? rest.findIndex(c => c.category !== a) : 0;
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

// Cards from collections the visitor switched on lead often but never take
// over: at most one in every PACK_EVERY places in the mixed list. Their own
// pill shows them all.
export const PACK_EVERY = 4;

export function paceCollections(list) {
  const at = new Map(list.map((c, i) => [c, i]));
  const own = list.filter(c => c.pack);
  const rest = list.filter(c => !c.pack);
  const out = [];
  let since = PACK_EVERY;                 // other cards since the last collection card
  while (own.length || rest.length) {
    const p = own[0], r = rest[0];
    const takeOwn = p && (!r || (since >= PACK_EVERY - 1 && at.get(p) < at.get(r)));
    if (takeOwn) { out.push(own.shift()); since = 0; }
    else { out.push(rest.shift()); since++; }
  }
  return out;
}

// Sponsored cards come from the server as their own list, the same for
// everyone. This browser decides which, if any, to show: never one outside
// the visitor's topics, never the lead card, only at the slots in
// SPONSOR_SLOTS (one in about eight cards), in the order given. Nothing about
// the choice leaves the browser.
export const SPONSOR_SLOTS = [3, 11, 19];

export function placeSponsored(list, sponsored, prefs, { dismissed = new Set(), category = null } = {}) {
  if (!sponsored?.length || !list.length) return list;
  const fit = sponsored
    .filter(s => s && s.id && !dismissed.has(s.id) && visible(s, prefs) && (!category || s.category === category))
    .map(s => ({ ...s, sponsored: true }));
  const out = [...list];
  SPONSOR_SLOTS.forEach((slot, i) => {
    if (fit[i] && out.length >= slot) out.splice(slot, 0, fit[i]);
  });
  return out;
}
