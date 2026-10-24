import test from 'node:test';
import assert from 'node:assert/strict';
import { cardContext, withContext } from '../public/context.js';
import { ENGINES, engineById } from '../public/engines.js';

const card = over => ({
  topic: 'The Strait of Hormuz', hook: 'A tanker was seized this week in the strait that carries a fifth of the world’s oil.',
  kind: 'topic', origin: 'timeless', figure: '', figureLabel: '', ...over,
});

test('a news card says it is in the news, when, from where, and asks for the latest', () => {
  const ctx = cardContext(card({ origin: 'news', news: true, day: '2026-10-24', source: { from: 'BBC News: world', title: 'Tanker seized', url: 'https://www.bbc.co.uk/news/1' } }));
  assert.match(ctx, /^Why I'm asking: It is in the news \(24 October 2026\)\. A tanker was seized/);
  assert.match(ctx, /\nSource: BBC News: world, "Tanker seized" https:\/\/www\.bbc\.co\.uk\/news\/1/);
  assert.match(ctx, /Lead with the latest developments/);
});

test('a timeless or history card gives its hook and figure, and asks for nothing new', () => {
  const ctx = cardContext(card({ topic: 'The Rosetta Stone', hook: 'One decree written three ways.', figure: '196 BC', figureLabel: 'when the decree was issued' }));
  assert.equal(ctx, 'What caught my eye: One decree written three ways.\nKey figure: 196 BC, when the decree was issued.');
  const anniversary = cardContext(card({ origin: 'onthisday', day: '2026-10-24' }));
  assert.match(anniversary, /^Why I'm asking: It is an anniversary today\./);
  assert.doesNotMatch(anniversary, /latest|recent|2026/);
});

test('debates and myths say how to answer', () => {
  assert.match(cardContext(card({ kind: 'debate' })), /strongest case on each side/);
  assert.match(cardContext(card({ kind: 'myth', origin: 'trending' })), /what is true, what is not.*\bIf something recent explains the interest/);
});

test('only AI engines get the context; a card without a hook adds nothing', () => {
  const c = card({ origin: 'news' });
  assert.match(withContext('Tell me everything about X', c, engineById('chatgpt')), /^Tell me everything about X\n\nWhy I'm asking/);
  assert.equal(withContext('Tell me everything about X', c, engineById('google')), 'Tell me everything about X');
  assert.equal(withContext('Tell me everything about X', c, engineById('duckduckgo')), 'Tell me everything about X');
  assert.equal(withContext('X', { topic: 'X' }, engineById('claude')), 'X');
  assert.deepEqual(ENGINES.filter(e => e.ai).map(e => e.id), ['google-ai', 'perplexity', 'chatgpt', 'claude', 'grok']);
});
