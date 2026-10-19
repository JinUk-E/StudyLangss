import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../lib/store.mjs';
import { practiceItems } from '../content/japanese-practice.mjs';
import { validatePracticeItem } from '../lib/practice.mjs';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'japanese-practice-'));
  let store = createStore(directory, []);
  const reopen = () => { store.db.close(); store = createStore(directory, []); return store; };
  try { await run(store, reopen); } finally { store.db.close(); await rm(directory, { recursive: true, force: true }); }
}
const input = (entryId, kind = 'words', requestId = 'practice-request-001') => ({ entryId, kind, requestId, rating: 'good', durationMs: 1234, answer: '', listened: kind === 'listening' });
const grade = (store, value) => store.transaction(() => store.practice.grade(value));

test('original Japanese catalogue covers all levels with valid cloze targets', () => {
  assert.equal(practiceItems.length, 60); assert.equal(new Set(practiceItems.map(item => item.id)).size, 60);
  for (const level of ['N5', 'N4', 'N3', 'N2', 'N1']) assert.equal(practiceItems.filter(item => item.level === level).length, 12);
  for (const item of practiceItems) assert.deepEqual(validatePracticeItem(item), item);
});

test('recommendation puts overdue recall before new items and keeps skills independent after restart', () => fixture((store, reopen) => {
  const first = store.practice.list('N5', 'words', 'recommended').items[0];
  const result = grade(store, input(first.id));
  assert.equal(result.intervalDays, 1); assert.equal(result.match, null);
  assert.ok(!store.practice.list('N5', 'words', 'recommended').items.some(item => item.id === first.id));
  assert.equal(store.practice.list('N5', 'sentences', 'recommended').items[0].id, first.id);
  assert.equal(store.practice.list('N5', 'words', 'review').count, 0);
  store.db.prepare('UPDATE practice_cards SET dueAt=? WHERE entryId=?').run('2020-01-01T00:00:00.000Z', first.id);
  const recommended = store.practice.list('N5', 'words', 'recommended');
  assert.equal(recommended.items[0].id, first.id); assert.equal(recommended.items[0].priority, 0);
  assert.equal(store.practice.list('N5', 'words', 'review').count, 1);
  const next = grade(store, { ...input(first.id, 'words', 'practice-request-002'), rating: 'again' });
  assert.ok(next.intervalDays < 1); assert.equal(next.seen, 2);
  const restored = reopen();
  assert.equal(restored.practice.summary('N5').words.seen, 1);
  assert.equal(restored.practice.summary('N5').sentences.seen, 0);
  assert.equal(restored.practice.backup().events.length, 2);
}));

test('practice submissions are idempotent and compare optional Japanese answers without inflating quiz results', () => fixture(store => {
  const item = practiceItems[0], sentence = { ...input(item.id, 'sentences'), answer: ` ${item.reading}。` };
  assert.equal(grade(store, sentence).match, true);
  assert.equal(grade(store, sentence).duplicate, true);
  assert.throws(() => grade(store, { ...sentence, rating: 'hard' }), /요청 ID/);
  assert.throws(() => grade(store, { ...input(item.id, 'listening', 'practice-listen-001'), listened: false }), /끝까지/);
  assert.equal(grade(store, { ...input(item.id, 'listening', 'practice-listen-001'), answer: item.example.replace('。', '') }).match, true);
  assert.equal(grade(store, { ...input(item.id, 'sentences', 'practice-empty-001'), answer: '' }).match, null);
  assert.equal(store.practice.backup().events.length, 3); assert.equal(store.attempts().length, 0);
}));

test('v2 backups restore practice atomically and v1 backups preserve Japanese progress', () => fixture(store => {
  grade(store, input(practiceItems[0].id));
  const snapshot = store.backup(); assert.equal(snapshot.schemaVersion, 2);
  grade(store, input(practiceItems[1].id, 'words', 'practice-request-002'));
  assert.equal(store.practice.summary('N5').words.seen, 2);
  store.restore(snapshot); assert.deepEqual(store.practice.backup(), snapshot.practice);
  const old = structuredClone(snapshot); old.schemaVersion = 1; delete old.practice;
  store.restore(old); assert.deepEqual(store.practice.backup(), snapshot.practice);
  for (const mutate of [data => { data.practice.cards[0].entryId = 'missing'; }, data => { data.practice.events[0].match = ''; }, data => { data.practice.cards.push(null); }]) {
    const invalid = structuredClone(snapshot); mutate(invalid);
    assert.throws(() => store.restore(invalid)); assert.deepEqual(store.practice.backup(), snapshot.practice);
    assert.deepEqual(store.getSettings(), snapshot.settings);
  }
}));
