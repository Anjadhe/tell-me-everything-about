import test from 'node:test';
import assert from 'node:assert/strict';
import { prefsFrom, rank, spread, feedback, tagState, cycleTag, keywordList, matches, placeSponsored, SPONSOR_SLOTS, paceInterests } from '../public/interests.js';

const settings = (s = {}) => (k, fallback) => (s[k] === undefined ? fallback : s[k]);
const c = (id, category, over = {}) => ({ id, topic: id, hook: '', angle: '', category, tags: [], origin: 'timeless', surprise: 'familiar', ...over });

test('defaults are no preference at all', () => {
  const p = prefsFrom(settings());
  assert.deepEqual(p.catPrefs, {});
  assert.deepEqual(p.tagPrefs, {});
  assert.deepEqual(p.mix, { timely: 0.5, surprising: 0.5 });
  assert.equal(p.onboarded, false);
});

test('the old list of liked categories becomes "more"', () => {
  assert.deepEqual(prefsFrom(settings({ interests: ['history', 'nope'] })).catPrefs, { history: 'more' });
});

test('stored values are checked: unknown ids go, weights are clamped', () => {
  const p = prefsFrom(settings({ catPrefs: { science: 'more', sport: 'normal', x: 'hide' }, tagPrefs: { space: 9, nope: 1, ai: 0 }, mutedTags: ['football', 'nope'], mix: { timely: 3, surprising: 'x' } }));
  assert.deepEqual(p.catPrefs, { science: 'more' });
  assert.deepEqual(p.tagPrefs, { space: 3 });
  assert.deepEqual(p.mutedTags, ['football']);
  assert.deepEqual(p.mix, { timely: 1, surprising: 0.5 });
});

test('with no preferences the editor’s order stands, spread across categories', () => {
  const cards = [c('a', 'science'), c('b', 'science'), c('c', 'science'), c('d', 'history')];
  assert.deepEqual(rank(cards, prefsFrom(settings())).map(x => x.id), ['a', 'b', 'd', 'c']);
});

test('hidden categories and muted tags never show; dismissed and old carried cards neither', () => {
  const cards = [c('a', 'sport'), c('b', 'science', { tags: ['football'] }), c('c', 'ideas'), c('d', 'ideas', { carried: true }), c('e', 'ideas', { carried: true }), c('f', 'ideas')];
  const p = prefsFrom(settings({ catPrefs: { sport: 'hide' }, mutedTags: ['football'] }));
  const out = rank(cards, p, { dismissed: new Set(['c']), seenBefore: new Set(['d']) }).map(x => x.id);
  assert.deepEqual(out.sort(), ['e', 'f']);
});

test('more of a category, liked tags and keywords lift a card', () => {
  const cards = [c('a', 'science'), c('b', 'history'), c('c', 'nature', { tags: ['animals'] }), c('d', 'culture', { hook: 'A Formula 1 story' })];
  assert.equal(rank(cards, prefsFrom(settings({ catPrefs: { history: 'more' } })))[0].id, 'b');
  assert.equal(rank(cards, prefsFrom(settings({ tagPrefs: { animals: 3 } })))[0].id, 'c');
  assert.equal(rank(cards, prefsFrom(settings({ keywords: 'formula 1, rust' })))[0].id, 'd');
});

test('the mix sliders move timely and surprising cards', () => {
  const cards = [c('old', 'science'), c('new', 'history', { origin: 'news' }), c('odd', 'nature', { surprise: 'surprising' })];
  assert.equal(rank(cards, prefsFrom(settings({ mix: { timely: 1 } })))[0].id, 'new');
  assert.equal(rank(cards, prefsFrom(settings({ mix: { surprising: 1 } })))[0].id, 'odd');
});

test('a category pill shows only that category, in score order', () => {
  const cards = [c('a', 'science'), c('b', 'history'), c('c', 'history')];
  assert.deepEqual(rank(cards, prefsFrom(settings()), { category: 'history' }).map(x => x.id), ['b', 'c']);
});

test('spread lets no category take more than two places in a row while others wait', () => {
  const list = ['s1', 's2', 's3', 's4', 'h1'].map(id => ({ id, category: id[0] }));
  assert.deepEqual(spread(list).map(x => x.id), ['s1', 's2', 'h1', 's3', 's4']);
});

test('keywords match whole words only', () => {
  const card = c('x', 'sport', { topic: 'Formula 1 aerodynamics', tags: ['motorsport'] });
  assert.deepEqual(keywordList(' Formula 1 ,f, rust\nRUST'), ['formula 1', 'rust']);
  assert.equal(matches(card, ['formula 1']), true);
  assert.equal(matches(card, ['motorsport']), true);
  assert.equal(matches(card, ['form']), false);
});

test('feedback nudges each tag, within bounds, and clears zeros', () => {
  const p = prefsFrom(settings({ tagPrefs: { space: 3, ai: 1 } }));
  assert.deepEqual(feedback(p, { tags: ['space', 'ai', 'maths'] }, 'more'), { space: 3, ai: 2, maths: 1 });
  assert.deepEqual(feedback(p, { tags: ['ai'] }, 'less'), { space: 3 });
});

test('a topic chip cycles: normal, more, hidden, normal; "less" resets', () => {
  let p = prefsFrom(settings());
  const step = () => { p = prefsFrom(settings(cycleTag(p, 'space'))); return tagState(p, 'space'); };
  assert.equal(step(), 'like');
  assert.equal(step(), 'hide');
  assert.equal(step(), 'neutral');
  p = prefsFrom(settings({ tagPrefs: { space: -2 } }));
  assert.equal(tagState(p, 'space'), 'less');
  assert.equal(step(), 'neutral');
});

test('sponsored cards go only in their slots, best match first, never against the visitor’s choices', () => {
  const list = Array.from({ length: 24 }, (_, i) => c(`c${i}`, 'ideas'));
  const sponsored = [
    c('sp-a', 'sport', { sponsor: 'A' }),
    c('sp-b', 'science', { sponsor: 'B', tags: ['space'] }),
    c('sp-c', 'history', { sponsor: 'C', tags: ['football'] }),
  ];
  const p = prefsFrom(settings({ tagPrefs: { space: 3 }, mutedTags: ['football'] }));
  const out = placeSponsored(list, sponsored, p);
  const at = out.map((x, i) => (x.sponsored ? [i, x.id] : null)).filter(Boolean);
  assert.deepEqual(at, [[SPONSOR_SLOTS[0], 'sp-b'], [SPONSOR_SLOTS[1], 'sp-a']]);
  assert.equal(out[0].sponsored, undefined);
  assert.equal(placeSponsored(list.slice(0, 2), sponsored, p).length, 2);
  assert.equal(placeSponsored(list, sponsored, p, { dismissed: new Set(['sp-b', 'sp-a']) }).filter(x => x.sponsored).length, 0);
  assert.deepEqual(placeSponsored(list, sponsored, p, { category: 'science' }).filter(x => x.sponsored).map(x => x.id), ['sp-b']);
});

test('cards from an interest the visitor named rank above ones they did not', () => {
  const cards = [c('a', 'science'), c('in-x-b', 'history', { pack: 'x' })];
  assert.equal(rank(cards, prefsFrom(settings()))[0].id, 'in-x-b');
});

test('interest cards come at most once in every four places in the mix', () => {
  const list = [...Array.from({ length: 6 }, (_, i) => c(`p${i}`, 'history', { pack: 'x' })), ...Array.from({ length: 12 }, (_, i) => c(`d${i}`, 'science'))];
  const out = paceInterests(list).map(x => x.id);
  assert.equal(out[0], 'p0');
  const lastOther = out.findLastIndex(id => id.startsWith('d'));
  const at = out.map((id, i) => (id.startsWith('p') && i < lastOther ? i : -1)).filter(i => i >= 0);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 4, out.join(','));
  assert.equal(out.length, list.length);
});
