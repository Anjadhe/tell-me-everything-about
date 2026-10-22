// Which Explore cards a visitor sees, and in what order. Runs only in the
// browser: the list from the server is the same for everyone, and this picks
// from it using the visitor's own preferences, which sync like prompts but
// never reach the Worker's list or Claude. Pure; pinned by
// test/interests.test.js.
//
// Preferences (in settings):
//   catPrefs   { [category]: 'more' | 'normal' | 'hide' }
//   tagPrefs   { [tag]: -3..3 }   liked above 0, "less" below; set by the
//                                 picker, the chips, and More/Less like this
//   mutedTags  [tag]              never shown
//   keywords   'Formula 1, sourdough'  matched against a card's words
//   mix        { timely: 0..1, surprising: 0..1 }   0.5 is no preference
//   onboarded  true once the first-run picker is done or skipped

import { CATEGORY_IDS, TAG_IDS, tagById } from './categories.js?v=c0b11e0890';

const TAG_MIN = -3, TAG_MAX = 3;

export function prefsFrom(setting) {
  const catPrefs = {};
  const rawCats = setting('catPrefs', null);
  if (rawCats && typeof rawCats === 'object') {
    for (const id of CATEGORY_IDS) if (['more', 'hide'].includes(rawCats[id])) catPrefs[id] = rawCats[id];
  } else {
    // Before three-way choices there was a list of liked categories.
    for (const id of setting('interests', [])) if (CATEGORY_IDS.includes(id)) catPrefs[id] = 'more';
  }
  const tagPrefs = {};
  const rawTags = setting('tagPrefs', {}) || {};
  for (const id of TAG_IDS) {
    const v = Number(rawTags[id]);
    if (Number.isFinite(v) && v !== 0) tagPrefs[id] = Math.max(TAG_MIN, Math.min(TAG_MAX, Math.round(v)));
  }
  const mutedTags = (setting('mutedTags', []) || []).filter(t => TAG_IDS.includes(t));
  const mix = setting('mix', {}) || {};
  return {
    catPrefs,
    tagPrefs,
    mutedTags,
    keywords: String(setting('keywords', '') || '').slice(0, 300),
    mix: { timely: unit(mix.timely), surprising: unit(mix.surprising) },
    onboarded: !!setting('onboarded', false),
  };
}

function unit(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

export function keywordList(text) {
  return [...new Set(String(text || '').toLowerCase().split(/[,;\n]/).map(s => s.trim()).filter(s => s.length >= 2))].slice(0, 20);
}

// A keyword matches when it appears as whole words in the card's topic,
// hook, question or tag names.
export function matches(card, terms) {
  if (!terms.length) return false;
  const hay = ` ${[card.topic, card.hook, card.angle, ...(card.tags || []).map(t => tagById(t)?.name || '')].join(' ').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return terms.some(t => hay.includes(` ${t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `));
}

export function hidden(card, prefs) {
  return prefs.catPrefs[card.category] === 'hide' || (card.tags || []).some(t => prefs.mutedTags.includes(t));
}

export function score(card, index, total, prefs, terms) {
  let s = 1 - index / Math.max(1, total);                              // the editor's order
  if (prefs.catPrefs[card.category] === 'more') s += 1.2;
  for (const t of card.tags || []) s += (prefs.tagPrefs[t] || 0) * 0.5;
  if (matches(card, terms)) s += 1.5;
  const timely = card.origin && card.origin !== 'timeless';
  s += (timely ? 1 : -1) * (prefs.mix.timely - 0.5) * 2;
  s += (card.surprise === 'surprising' ? 1 : -1) * (prefs.mix.surprising - 0.5) * 2;
  if (card.carried) s -= 0.4;
  if (card.pack) s += 1;                                                // asked for by name
  return s;
}

// The cards to show, best first. dismissed: ids set aside here; seenBefore:
// ids this browser showed on an earlier day (carried cards it has already
// had are dropped); category: one category's pill.
export function rank(cards, prefs, { dismissed = new Set(), seenBefore = new Set(), category = null } = {}) {
  const terms = keywordList(prefs.keywords);
  const pool = cards.filter(c =>
    !dismissed.has(c.id) &&
    !(c.carried && seenBefore.has(c.id)) &&
    !hidden(c, prefs) &&
    (!category || c.category === category));
  const scored = pool.map((c, i) => ({ c, s: score(c, i, pool.length, prefs, terms) }));
  scored.sort((a, b) => b.s - a.s);
  return category ? scored.map(x => x.c) : paceInterests(spread(scored.map(x => x.c)));
}

// Cards from the visitor's own interests lead often but never take over:
// at most one in every PACK_EVERY places in the mixed list. Their own pill
// shows them all.
export const PACK_EVERY = 4;

export function paceInterests(list) {
  const at = new Map(list.map((c, i) => [c, i]));
  const own = list.filter(c => c.pack);
  const rest = list.filter(c => !c.pack);
  const out = [];
  let since = PACK_EVERY;                 // other cards since the last interest card
  while (own.length || rest.length) {
    const p = own[0], r = rest[0];
    const takeOwn = p && (!r || (since >= PACK_EVERY - 1 && at.get(p) < at.get(r)));
    if (takeOwn) { out.push(own.shift()); since = 0; }
    else { out.push(rest.shift()); since++; }
  }
  return out;
}

// Keep the best first, but don't let one category take more than two places
// in a row while others are waiting.
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

// "More like this" / "Less like this": nudge each of the card's tags.
export function feedback(prefs, card, dir) {
  const next = { ...prefs.tagPrefs };
  for (const t of card.tags || []) {
    const v = Math.max(TAG_MIN, Math.min(TAG_MAX, (next[t] || 0) + (dir === 'more' ? 1 : -1)));
    if (v) next[t] = v; else delete next[t];
  }
  return next;
}

export function tagState(prefs, id) {
  if (prefs.mutedTags.includes(id)) return 'hide';
  const v = prefs.tagPrefs[id] || 0;
  return v > 0 ? 'like' : v < 0 ? 'less' : 'neutral';
}

// A topic chip in settings: neutral → like → hide → neutral ("less", learned
// from feedback, goes back to neutral).
export function cycleTag(prefs, id) {
  const state = tagState(prefs, id);
  const tagPrefs = { ...prefs.tagPrefs };
  let mutedTags = prefs.mutedTags.filter(t => t !== id);
  delete tagPrefs[id];
  if (state === 'neutral') tagPrefs[id] = 2;
  else if (state === 'like') mutedTags = [...mutedTags, id];
  return { tagPrefs, mutedTags };
}

// Sponsored cards come from the server as their own list, the same for
// everyone. This browser decides which, if any, to show: never one the
// visitor's choices would hide, never the lead card, only at the slots in
// SPONSOR_SLOTS (one in about eight cards), the best match first. Nothing about the choice leaves the
// browser.
export const SPONSOR_SLOTS = [3, 11, 19];

export function placeSponsored(list, sponsored, prefs, { dismissed = new Set(), category = null } = {}) {
  if (!sponsored?.length || !list.length) return list;
  const terms = keywordList(prefs.keywords);
  const fit = sponsored
    .filter(s => s && s.id && !dismissed.has(s.id) && !hidden(s, prefs) && (!category || s.category === category))
    .map(s => ({ s: { ...s, sponsored: true }, score: score(s, 0, 1, prefs, terms) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
  const out = [...list];
  SPONSOR_SLOTS.forEach((slot, i) => {
    if (fit[i] && out.length >= slot) out.splice(slot, 0, fit[i]);
  });
  return out;
}

// The library key for an interest, the same as the Worker's interestKey
// (src/explore.js?v=c0b11e0890; a test keeps them equal).
export function interestKeyOf(text) {
  const s = String(text || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 60) return null;
  const key = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return key.length >= 2 ? key : null;
}
