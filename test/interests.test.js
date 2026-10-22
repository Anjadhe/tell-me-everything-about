import test from 'node:test';
import assert from 'node:assert/strict';
import { prefsFrom, topicsValue, visible, setCategory, setTag, rank, spread, placeSponsored, SPONSOR_SLOTS, DEFAULT_TOPICS } from '../public/interests.js';
import { CATEGORIES } from '../public/categories.js';

const settings = (s = {}) => (k, fallback) => (s[k] === undefined ? fallback : s[k]);
const c = (id, category, over = {}) => ({ id, topic: id, hook: '', category, tags: [], ...over });
const all = { topics: { categories: CATEGORIES.map(x => x.id), tags: CATEGORIES.flatMap(x => x.tags.map(t => t.id)) } };

test('the starting topics: six on with every sub-topic, Society and Sport off', () => {
  const p = prefsFrom(settings());
  assert.deepEqual([...p.categories], DEFAULT_TOPICS.categories);
  assert.equal(p.categories.has('sport'), false);
  assert.equal(p.tags.has('space') && p.tags.has('food'), true);
  assert.equal(p.tags.has('football'), false);
});

test('stored choices are checked; unknown ids go', () => {
  const p = prefsFrom(settings({ topics: { categories: ['sport', 'nope'], tags: ['football', 'nope'] } }));
  assert.deepEqual([...p.categories], ['sport']);
  assert.deepEqual([...p.tags], ['football']);
  assert.deepEqual(topicsValue(p), { categories: ['sport'], tags: ['football'] });
});

test('a card shows when its topic is on and one of its sub-topics is ticked', () => {
  const p = prefsFrom(settings({ topics: { categories: ['science', 'history'], tags: ['space', 'ancient'] } }));
  assert.equal(visible(c('a', 'science', { tags: ['space'] }), p), true);
  assert.equal(visible(c('b', 'science', { tags: ['biology'] }), p), false);
  assert.equal(visible(c('c', 'science', { tags: ['biology', 'ancient'] }), p), true);   // any ticked tag will do
  assert.equal(visible(c('d', 'science'), p), true);                                       // no tags: the topic decides
  assert.equal(visible(c('e', 'sport'), p), false);
});

test('switching a topic on ticks all its sub-topics; off unticks them', () => {
  let p = prefsFrom(settings({ topics: { categories: [], tags: [] } }));
  p = setCategory(p, 'sport', true);
  assert.equal(p.categories.has('sport'), true);
  assert.deepEqual(CATEGORIES.find(x => x.id === 'sport').tags.every(t => p.tags.has(t.id)), true);
  p = setCategory(p, 'sport', false);
  assert.equal(p.categories.has('sport'), false);
  assert.equal(p.tags.has('football'), false);
});

test('unticking the last sub-topic switches the topic off; ticking one switches it on', () => {
  let p = prefsFrom(settings({ topics: { categories: ['sport'], tags: ['football'] } }));
  p = setTag(p, 'football', false);
  assert.equal(p.categories.has('sport'), false);
  p = setTag(p, 'chess-not-a-tag', true);
  p = setTag(p, 'games', true);
  assert.equal(p.categories.has('sport'), true);
});

test('ranking keeps the editor’s order, spread across topics, carried cards later', () => {
  const p = prefsFrom(settings(all));
  const cards = [c('a', 'science'), c('b', 'science'), c('c', 'science'), c('d', 'history'), c('e', 'nature', { carried: true }), c('f', 'ideas')];
  assert.deepEqual(rank(cards, p).map(x => x.id), ['a', 'b', 'd', 'c', 'f', 'e']);
});

test('set-aside, hidden and already-seen carried cards never show', () => {
  const p = prefsFrom(settings({ topics: { categories: ['ideas'], tags: ['philosophy'] } }));
  const cards = [c('a', 'sport'), c('b', 'ideas', { tags: ['future'] }), c('c', 'ideas'), c('d', 'ideas', { carried: true }), c('e', 'ideas', { carried: true }), c('f', 'ideas', { tags: ['philosophy'] })];
  const out = rank(cards, p, { dismissed: new Set(['c']), seenBefore: new Set(['d']) }).map(x => x.id);
  assert.deepEqual(out.sort(), ['e', 'f']);
});

test('a topic pill shows only that topic', () => {
  const cards = [c('a', 'science'), c('b', 'history'), c('c', 'history')];
  assert.deepEqual(rank(cards, prefsFrom(settings(all)), { category: 'history' }).map(x => x.id), ['b', 'c']);
});

test('spread lets no topic take more than two places in a row while others wait', () => {
  const list = ['s1', 's2', 's3', 's4', 'h1'].map(id => ({ id, category: id[0] }));
  assert.deepEqual(spread(list).map(x => x.id), ['s1', 's2', 'h1', 's3', 's4']);
});

test('sponsored cards go only in their slots, in order, never outside the visitor’s topics', () => {
  const list = Array.from({ length: 24 }, (_, i) => c(`c${i}`, 'ideas'));
  const sponsored = [c('sp-a', 'sport', { sponsor: 'A' }), c('sp-b', 'science', { sponsor: 'B', tags: ['space'] }), c('sp-c', 'history', { sponsor: 'C' })];
  const p = prefsFrom(settings({ topics: { categories: ['ideas', 'science', 'history'], tags: ['space'] } }));
  const out = placeSponsored(list, sponsored, p);
  const at = out.map((x, i) => (x.sponsored ? [i, x.id] : null)).filter(Boolean);
  assert.deepEqual(at, [[SPONSOR_SLOTS[0], 'sp-b'], [SPONSOR_SLOTS[1], 'sp-c']]);
  assert.equal(out[0].sponsored, undefined);
  assert.equal(placeSponsored(list.slice(0, 2), sponsored, p).length, 2);
  assert.equal(placeSponsored(list, sponsored, p, { dismissed: new Set(['sp-b', 'sp-c']) }).filter(x => x.sponsored).length, 0);
  assert.deepEqual(placeSponsored(list, sponsored, p, { category: 'science' }).filter(x => x.sponsored).map(x => x.id), ['sp-b']);
});

test('collection cards are chosen by topic like any other, with no head start', () => {
  const p = prefsFrom(settings({ topics: { categories: ['science'], tags: ['space'] } }));
  const cards = [c('d1', 'science', { tags: ['space'] }), c('in-x-a', 'science', { tags: ['space'], pack: 'x' }), c('in-x-b', 'history', { tags: ['ancient'], pack: 'x' }), c('in-x-c', 'science', { tags: ['biology'], pack: 'x' })];
  assert.deepEqual(rank(cards, p).map(x => x.id), ['d1', 'in-x-a']);
});

test('Health and Business are on from the start, with every sub-topic', () => {
  const p = prefsFrom(settings());
  assert.ok(p.categories.has('health') && p.categories.has('business'));
  assert.ok(p.tags.has('medicine') && p.tags.has('markets'));
});

test('someone who had a sub-topic that became a topic gets that topic', () => {
  const p = prefsFrom(settings({ topics: { categories: ['science'], tags: ['space', 'health'] } }));
  assert.ok(p.categories.has('health') && p.tags.has('medicine') && p.tags.has('body'));
  assert.equal(p.categories.has('business'), false);
});

test('current events can be left out as a whole', () => {
  const news = c('n', 'nature', { tags: ['climate'], origin: 'news', news: true });
  assert.equal(visible(news, prefsFrom(settings())), true);
  assert.equal(visible(news, prefsFrom(settings({ news: false }))), false);
  assert.equal(visible(c('d', 'nature', { tags: ['climate'] }), prefsFrom(settings({ news: false }))), true);
});
