import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCards, clip, slug, sourcesFrom, userMessage, EVERGREEN, CARD_SCHEMA, MAX_CARDS, exploreModel, modelRequest, DEFAULT_MODEL } from '../src/explore.js';
import { CATEGORY_IDS, ORIGINS } from '../public/categories.js';
import { motif } from '../public/explore.js';

const card = (over = {}) => ({
  topic: 'The Voyager Golden Record', hook: 'A record for aliens.', category: 'science', origin: 'news',
  figure: '1977', figureLabel: 'launched', angle: 'Who chose the sounds?', ...over,
});

test('a good card comes through with an id from its topic', () => {
  const [c] = cleanCards([card()]);
  assert.equal(c.id, 'the-voyager-golden-record');
  assert.equal(c.topic, 'The Voyager Golden Record');
  assert.equal(c.origin, 'news');
});

test('cards with a missing topic, hook or unknown category are dropped', () => {
  const out = cleanCards([card({ topic: ' ' }), card({ hook: '' }), card({ category: 'gossip' }), null, 'x', card({ topic: 'Kept' })]);
  assert.deepEqual(out.map(c => c.topic), ['Kept']);
});

test('duplicates by topic are dropped, case and punctuation aside', () => {
  const out = cleanCards([card(), card({ topic: 'the voyager golden record.' })]);
  assert.equal(out.length, 1);
});

test('fields are trimmed, capped and stripped of control characters', () => {
  const [c] = cleanCards([card({ topic: '  Black\nholes?  ', hook: 'word '.repeat(60), figure: '123456789012345', origin: 'tabloid' })]);
  assert.equal(c.topic, 'Black holes');
  assert.ok(c.hook.length <= 140 && c.hook.endsWith('…'));
  assert.ok(c.figure.length <= 12);
  assert.equal(c.origin, 'timeless');
});

test('a figure label without a figure is cleared', () => {
  const [c] = cleanCards([card({ figure: '', figureLabel: 'orphan' })]);
  assert.equal(c.figureLabel, '');
});

test('no more than MAX_CARDS', () => {
  const many = Array.from({ length: MAX_CARDS + 10 }, (_, i) => card({ topic: `Topic ${i}` }));
  assert.equal(cleanCards(many).length, MAX_CARDS);
});

test('clip and slug', () => {
  assert.equal(clip('short', 10), 'short');
  assert.equal(clip('one two three four five', 16), 'one two three…');
  assert.equal(slug('Café Society: 1920s!'), 'cafe-society-1920s');
});

test('sources boil down and skip Wikipedia housekeeping pages', () => {
  const wiki = {
    tfa: { titles: { normalized: 'Hokusai' }, description: 'Japanese artist' },
    news: [{ story: '<b>A</b> thing &amp; another', links: [{ titles: { normalized: 'Thing' } }] }],
    mostread: { articles: [{ titles: { normalized: 'Main Page' } }, { titles: { normalized: 'Tardigrade' }, description: 'Micro-animal' }] },
    onthisday: [{ year: 1977, text: 'Voyager 1 is launched.', pages: [{ titles: { normalized: 'Voyager 1' } }] }],
  };
  const s = sourcesFrom(wiki, { hits: [{ title: 'Show HN: a thing' }] });
  assert.deepEqual(s.featured, ['Hokusai (Japanese artist)']);
  assert.deepEqual(s.news, ['A thing & another (Thing)']);
  assert.deepEqual(s.trending, ['Tardigrade (Micro-animal)']);
  assert.deepEqual(s.onthisday, ['1977: Voyager 1 is launched. (Voyager 1)']);
  assert.deepEqual(s.hn, ['Show HN: a thing']);
});

test('missing sources still make a usable message', () => {
  const s = sourcesFrom(null, null);
  assert.match(userMessage('2026-10-21', s), /could not be reached/);
  assert.match(userMessage('2026-10-21', { ...s, hn: ['X'] }), /## Hacker News front page \(origin: hn\)\n- X/);
});

test('the schema allows exactly the shared categories and origins', () => {
  const item = CARD_SCHEMA.properties.cards.items;
  assert.deepEqual(item.properties.category.enum, CATEGORY_IDS);
  assert.deepEqual(item.properties.origin.enum, Object.keys(ORIGINS));
  assert.equal(item.additionalProperties, false);
});

test('the evergreen list survives its own cleaning and covers every category', () => {
  assert.ok(EVERGREEN.length >= 16);
  for (const id of CATEGORY_IDS) assert.ok(EVERGREEN.some(c => c.category === id), id);
});

test('covers are the same for the same topic and differ between topics', () => {
  assert.equal(motif('science', 'A'), motif('science', 'A'));
  assert.notEqual(motif('science', 'A'), motif('science', 'B'));
  for (const id of CATEGORY_IDS) assert.match(motif(id, 'x'), /^<svg class="motif"[^>]*>.+<\/svg>$/);
  assert.doesNotMatch(motif('nature', 'x'), /NaN|undefined/);
});

test('the model comes from EXPLORE_MODEL, with a default', () => {
  assert.equal(exploreModel({}), DEFAULT_MODEL);
  assert.equal(exploreModel({ EXPLORE_MODEL: '  ' }), DEFAULT_MODEL);
  assert.equal(exploreModel({ EXPLORE_MODEL: 'claude-haiku-5-5' }), 'claude-haiku-5-5');
});

test('refusal fallback is only requested from models that accept it', () => {
  assert.deepEqual(modelRequest('claude-opus-5-5'), { model: 'claude-opus-5-5', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  assert.deepEqual(modelRequest('claude-haiku-5-5'), { model: 'claude-haiku-5-5' });
});
