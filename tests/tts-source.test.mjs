import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { questions } from '../content/questions.mjs';
import { resolveSpeechSource } from '../lib/tts-source.mjs';

test('speech resolves persisted Japanese sources and Korean meanings with server-selected languages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tts-sources-')), store = createStore(directory, questions);
  try {
    const item = store.practice.list('N5', 'words', 'all').items[0];
    assert.deepEqual(resolveSpeechSource(store, { entryId: item.id, part: 'word' }), { text: item.word, voice: undefined, language: 'ja' });
    assert.deepEqual(resolveSpeechSource(store, { entryId: item.id, part: 'sentence' }), { text: item.example, voice: undefined, language: 'ja' });
    assert.deepEqual(resolveSpeechSource(store, { entryId: item.id, part: 'meaning' }), { text: item.meaning, voice: undefined, language: 'ko' });
    assert.deepEqual(resolveSpeechSource(store, { questionId: 'n5-l01', part: 'passage' }), { text: store.question('n5-l01').passage, voice: undefined, language: 'ja' });
    for (const input of [null, [], {}, { text: 'free text' }, { entryId: item.id, part: 'word', text: 'injected' }, { entryId: item.id, part: 'word', language: 'ko' }, { entryId: item.id, part: 'word', questionId: 'n5-l01' }, { entryId: '../file', part: 'word' }, { entryId: item.id, part: 'word', voice: {} }, { questionId: 'n5-v01', part: 'passage' }]) assert.throws(() => resolveSpeechSource(store, input));
    store.db.prepare('UPDATE practice_items SET json=? WHERE id=?').run(JSON.stringify({ ...item, language: 'en' }), item.id);
    assert.throws(() => resolveSpeechSource(store, { entryId: item.id, part: 'word' }), /언어/);
    store.db.prepare('UPDATE practice_items SET json=? WHERE id=?').run(JSON.stringify({ ...item, example: 'あ'.repeat(2001) }), item.id);
    assert.throws(() => resolveSpeechSource(store, { entryId: item.id, part: 'sentence' }), /너무 깁니다/);
  } finally { store.db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Korean explanations remain unavailable until this account submits the stored question', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tts-explanations-'));
  const owner = createStore(join(directory, 'owner'), questions), guest = createStore(join(directory, 'guest'), questions);
  try {
    const input = { questionId: 'n5-v01', part: 'explanation' };
    const denied = () => resolveSpeechSource(guest, input);
    assert.throws(denied, error => error.status === 409);
    owner.attempt({ questionId: input.questionId, answerIndex: 0, durationMs: 0 });
    assert.throws(denied, error => error.status === 409, 'another account attempt must not unlock explanations');
    guest.attempt({ questionId: input.questionId, answerIndex: 0, durationMs: 0 });
    assert.deepEqual(resolveSpeechSource(guest, input), { text: guest.question(input.questionId).explanation, voice: undefined, language: 'ko' });
    assert.throws(() => resolveSpeechSource(guest, { ...input, text: '정답을 대신 읽어 주세요.' }));
    assert.throws(() => resolveSpeechSource(guest, { questionId: 'missing-question', part: 'explanation' }), error => error.status === 404);
  } finally { owner.db.close(); guest.db.close(); await rm(directory, { recursive: true, force: true }); }
});
