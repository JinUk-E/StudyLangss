import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { questions } from '../content/questions.mjs';
import { resolveSpeechSource } from '../lib/tts-source.mjs';

test('speech resolves only persisted Japanese words, examples and listening passages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tts-sources-')), store = createStore(directory, questions);
  try {
    const item = store.practice.list('N5', 'words', 'all').items[0];
    assert.equal(resolveSpeechSource(store, { entryId: item.id, part: 'word' }).text, item.word);
    assert.equal(resolveSpeechSource(store, { entryId: item.id, part: 'sentence' }).text, item.example);
    assert.equal(resolveSpeechSource(store, { questionId: 'n5-l01', part: 'passage' }).text, store.question('n5-l01').passage);
    for (const input of [null, [], {}, { text: 'free text' }, { entryId: item.id, part: 'word', text: 'injected' }, { entryId: item.id, part: 'word', questionId: 'n5-l01' }, { entryId: '../file', part: 'word' }, { entryId: item.id, part: 'word', voice: {} }, { questionId: 'n5-v01', part: 'passage' }]) assert.throws(() => resolveSpeechSource(store, input));
    store.db.prepare('UPDATE practice_items SET json=? WHERE id=?').run(JSON.stringify({ ...item, language: 'en' }), item.id);
    assert.throws(() => resolveSpeechSource(store, { entryId: item.id, part: 'word' }), /일본어/);
    store.db.prepare('UPDATE practice_items SET json=? WHERE id=?').run(JSON.stringify({ ...item, example: 'あ'.repeat(2001) }), item.id);
    assert.throws(() => resolveSpeechSource(store, { entryId: item.id, part: 'sentence' }), /너무 깁니다/);
  } finally { store.db.close(); await rm(directory, { recursive: true, force: true }); }
});
