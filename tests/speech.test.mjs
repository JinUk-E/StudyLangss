import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJapaneseSpeech } from '../public/speech.js';

function fixture() {
  const utterances = [], voice = { lang: 'ja-JP', voiceURI: 'local-ja', name: 'Japanese', localService: true };
  const synth = { getVoices: () => [voice], cancel() {}, speak(utterance) { utterances.push(utterance); utterance.onstart(); } };
  return { utterances, voice, synth, speech: createJapaneseSpeech({ speechSynthesis: synth, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } }) };
}

test('Japanese speech completes only after all repeats and applies selected voice and speed', async () => {
  const { speech, utterances, voice } = fixture(), statuses = [];
  const pending = speech.play('学校', { rate: .8, repeats: 2, status: (_, state) => statuses.push(state) });
  assert.equal(utterances[0].voice, voice); assert.equal(utterances[0].rate, .8); assert.equal(utterances[0].lang, 'ja-JP');
  utterances[0].onend();
  await new Promise(resolve => setTimeout(resolve, 380));
  assert.equal(utterances.length, 2); assert.ok(!statuses.includes('done'));
  utterances[1].onend(); assert.equal(await pending, true); assert.equal(statuses.at(-1), 'done');
});

test('route cancellation and synthesis errors cannot complete listening practice', async () => {
  const { speech, utterances } = fixture();
  const pending = speech.play('先生', { repeats: 3 }); utterances[0].onend(); speech.cancel();
  assert.equal(await pending, false);
  await new Promise(resolve => setTimeout(resolve, 380)); assert.equal(utterances.length, 1);
  const failed = speech.play('先生'); utterances[1].onerror(); assert.equal(await failed, false);
});

test('unsupported speech and missing Japanese voice report failure with no fallback to another language', async () => {
  const messages = [];
  assert.equal(await createJapaneseSpeech({}).play('学校', { status: text => messages.push(text) }), false);
  assert.match(messages[0], /지원하지/);
  const host = { speechSynthesis: { getVoices: () => [{ lang: 'en-US' }], cancel() {}, speak() { assert.fail('Must not speak English'); } }, SpeechSynthesisUtterance: class {} };
  assert.equal(await createJapaneseSpeech(host).play('学校', { status: text => messages.push(text) }), false);
  assert.match(messages.at(-1), /일본어 음성이 없습니다/);
});
