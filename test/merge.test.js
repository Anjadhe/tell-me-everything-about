import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, emptyState, sameState } from '../public/merge.js';

const t0 = '2026-09-10T10:00:00.000Z';
const t1 = '2026-09-10T11:00:00.000Z';
const t2 = '2026-09-10T12:00:00.000Z';
const p = (id, label, updatedAt, order = 0) => ({ id, label, template: label + ' {}', engine: 'google-ai', order, updatedAt });

test('union keeps both sides\' records', () => {
  const m = merge({ prompts: [p('a', 'A', t0)] }, { prompts: [p('b', 'B', t0)] });
  assert.deepEqual(m.prompts.map(x => x.id), ['a', 'b']);
});

test('newest edit of the same record wins', () => {
  const m = merge({ prompts: [p('a', 'old', t0)] }, { prompts: [p('a', 'new', t1)] });
  assert.equal(m.prompts[0].label, 'new');
  const r = merge({ prompts: [p('a', 'new', t1)] }, { prompts: [p('a', 'old', t0)] });
  assert.equal(r.prompts[0].label, 'new');
});

test('a tombstone removes the record it is newer than', () => {
  const m = merge({ prompts: [p('a', 'A', t0)] }, { tombstones: { a: t1 } });
  assert.deepEqual(m.prompts, []);
  assert.equal(m.tombstones.a, t1);
});

test('an edit newer than the tombstone survives the delete', () => {
  const m = merge({ prompts: [p('a', 'A', t2)] }, { tombstones: { a: t1 } });
  assert.equal(m.prompts.length, 1);
  assert.equal(m.tombstones.a, undefined);
});

test('settings merge whole by updatedAt', () => {
  const m = merge({ settings: { theme: 'dark', updatedAt: t1 } }, { settings: { theme: 'light', newTab: true, updatedAt: t0 } });
  assert.deepEqual(m.settings, { theme: 'dark', updatedAt: t1 });
});

test('order is respected and stable', () => {
  const m = merge({ prompts: [p('a', 'A', t0, 2), p('b', 'B', t0, 0)] }, { prompts: [p('c', 'C', t0, 1)] });
  assert.deepEqual(m.prompts.map(x => x.id), ['b', 'c', 'a']);
});

test('garbage in is tolerated', () => {
  const m = merge(null, { prompts: [null, { nope: 1 }, p('a', 'A', t0)] });
  assert.equal(m.prompts.length, 1);
  assert.ok(sameState(merge(undefined, undefined), emptyState()));
});
