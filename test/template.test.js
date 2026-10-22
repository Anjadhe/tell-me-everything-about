import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, fill, describe, highlight, defaultLabel, autoValues, MAX_BLANKS } from '../public/template.js';

const autos = { today: '21 October 2026', month: 'October 2026', year: '2026', language: 'English' };

test('{} is the one blank, as before', () => {
  assert.equal(fill('Tell me everything about {}', { something: 'tardigrades' }, autos), 'Tell me everything about tardigrades');
  assert.deepEqual(parse('Explain {} simply').blanks, [{ id: 'something', name: 'something' }]);
});

test('no blank means the topic goes at the end', () => {
  const p = parse('Tell me about');
  assert.equal(p.appended, true);
  assert.equal(fill('Tell me about', { something: 'Lisbon' }, autos), 'Tell me about Lisbon');
});

test('named blanks are separate boxes, in order', () => {
  const t = 'Compare {thing} with {other thing}';
  assert.deepEqual(parse(t).blanks.map(b => b.name), ['thing', 'other thing']);
  assert.equal(fill(t, { thing: 'Rust', 'other thing': 'Go' }, autos), 'Compare Rust with Go');
});

test('the same name twice is one blank used twice, whatever the case', () => {
  const t = 'Is {city} safe? What should I know about {City}?';
  assert.equal(parse(t).blanks.length, 1);
  assert.equal(fill(t, { city: 'Lisbon' }, autos), 'Is Lisbon safe? What should I know about Lisbon?');
});

test('automatic values fill themselves in and are not blanks', () => {
  const t = "What's the latest on {topic} as of {today}, in {LANGUAGE}?";
  assert.deepEqual(parse(t).blanks.map(b => b.id), ['topic']);
  assert.equal(fill(t, { topic: 'fusion' }, autos), "What's the latest on fusion as of 21 October 2026, in English?");
});

test('a prompt of only automatic values still gets a box at the end', () => {
  assert.equal(fill('News from {today}', { something: 'Mars' }, autos), 'News from 21 October 2026 Mars');
});

test('blanks past the limit stay as written', () => {
  const t = '{a} {b} {c} {d} {e}';
  const p = parse(t);
  assert.equal(p.blanks.length, MAX_BLANKS);
  assert.equal(p.extra, 1);
  assert.match(describe(t).problems[0], /first 4/);
  assert.equal(fill(t, { a: '1', b: '2', c: '3', d: '4' }, autos), '1 2 3 4 {e}');
});

test('stray braces are pointed out', () => {
  assert.equal(describe('Tell me about {topic').problems.length, 1);
  assert.equal(describe('Tell me about {topic}').problems.length, 0);
});

test('highlight lines up with the text and marks each kind', () => {
  const t = 'Plan {days} days in {city} from {today} {a}{b}{c}';
  const runs = highlight(t);
  assert.equal(runs.map(r => r.text).join(''), t);
  assert.deepEqual(runs.filter(r => r.kind !== 'text').map(r => r.kind), ['blank', 'blank', 'auto', 'blank', 'blank', 'extra']);
});

test('default tab names come from the words before the first placeholder', () => {
  assert.equal(defaultLabel('Compare {thing} with {other}'), 'Compare');
  assert.equal(defaultLabel('{topic} explained'), 'Untitled');
});

test('automatic values are real', () => {
  const v = autoValues(new Date('2026-10-21T12:00:00Z'), 'en-GB');
  assert.equal(v.year, '2026');
  assert.match(v.today, /21 October 2026/);
  assert.equal(v.language, 'English');
});
