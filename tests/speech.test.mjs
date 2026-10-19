import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJapaneseSpeech } from '../public/speech.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const source = { entryId: 'ja-n5-1', part: 'sentence' };
function fixture({ fetcher, blocked = false } = {}) {
  const requests = [], players = [], revoked = [], timers = new Map(); let timerId = 0, blockNext = blocked;
  const host = {
    fetch: async (url, options) => { requests.push({ url, options }); return fetcher ? fetcher(url, options) : { ok: true, headers: new Headers({ 'content-type': 'audio/wav' }), blob: async () => new Blob(['wav']) }; },
    URL: { createObjectURL: () => `blob:test-${players.length}`, revokeObjectURL: url => revoked.push(url) },
    setTimeout: (callback, duration) => { const id = ++timerId; timers.set(id, { callback, duration }); return id; },
    clearTimeout: id => timers.delete(id),
    Audio: class {
      constructor(url) { this.url = url; this.calls = 0; players.push(this); }
      play() { this.calls++; if (blockNext) { blockNext = false; return Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' })); } return Promise.resolve(); }
      pause() { this.paused = true; }
      removeAttribute(name) { if (name === 'src') this.srcRemoved = true; }
      load() {}
    },
  };
  return { speech: createJapaneseSpeech(host), requests, players, revoked, timers, runTimer(duration) { const [id, timer] = [...timers].find(([, value]) => value.duration === duration) || []; assert.ok(timer, `Missing ${duration}ms timer`); timers.delete(id); timer.callback(); } };
}

test('Mac speech sends only source IDs with same-origin auth, applies rate and waits for every ended event', async () => {
  const f = fixture(), statuses = [];
  const pending = f.speech.play(source, { rate: .8, repeats: 2, voiceURI: 'Kyoko', status: (_, state) => statuses.push(state) });
  await flush(); const audio = f.players[0];
  assert.equal(f.requests[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { ...source, voice: 'Kyoko' });
  assert.equal(audio.playbackRate, .8); audio.onplaying(); audio.onended();
  assert.ok(!statuses.includes('done')); f.runTimer(350); assert.equal(audio.calls, 2);
  audio.onplaying(); audio.onended(); assert.equal(await pending, true);
  assert.equal(statuses.at(-1), 'done'); assert.equal(f.revoked.length, 1); assert.ok(audio.paused); assert.equal(f.timers.size, 0);
});

test('route cancellation aborts pending audio requests without stale playback', async () => {
  let complete;
  const f = fixture({ fetcher: () => new Promise(resolve => { complete = resolve; }) });
  const pending = f.speech.play(source); f.speech.cancel(); assert.equal(await pending, false);
  assert.ok(f.requests[0].options.signal.aborted);
  complete({ ok: true, headers: new Headers({ 'content-type': 'audio/wav' }), blob: async () => new Blob(['wav']) });
  await flush(); assert.equal(f.players.length, 0); assert.equal(f.timers.size, 0);
});

test('stopping between repeats releases the blob and cannot finish listening', async () => {
  const f = fixture(), pending = f.speech.play(source, { repeats: 3 }); await flush();
  const audio = f.players[0], staleEnded = audio.onended; audio.onended(); f.speech.cancel();
  assert.equal(await pending, false); staleEnded(); assert.equal(f.timers.size, 0); assert.equal(f.revoked.length, 1); assert.equal(audio.onended, null);
});

test('autoplay denial preserves prepared audio and a second click calls play synchronously', async () => {
  const f = fixture({ blocked: true }), statuses = [];
  assert.equal(await f.speech.play(source, { status: (_, state) => statuses.push(state) }), false);
  assert.equal(statuses.at(-1), 'ready'); assert.equal(f.revoked.length, 0);
  const resumed = f.speech.play(source);
  assert.equal(f.players[0].calls, 2); assert.equal(f.requests.length, 1);
  f.players[0].onended(); assert.equal(await resumed, true); assert.equal(f.revoked.length, 1);
});

test('server, authentication and invalid content failures return helpful errors without playback', async () => {
  const messages = [];
  const denied = fixture({ fetcher: async () => ({ ok: false, status: 401, json: async () => ({ error: '로그인이 필요합니다.' }) }) });
  assert.equal(await denied.speech.play(source, { status: text => messages.push(text) }), false); assert.match(messages.at(-1), /로그인/);
  const html = fixture({ fetcher: async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) }) });
  assert.equal(await html.speech.play(source, { status: text => messages.push(text) }), false); assert.match(messages.at(-1), /올바른 음성/); assert.equal(html.players.length, 0);
});

test('generation timeout aborts synthesis and stalled playback/error cannot count as completed', async () => {
  const loading = fixture({ fetcher: () => new Promise(() => {}) }), pending = loading.speech.play(source);
  loading.runTimer(40000); assert.equal(await pending, false); assert.ok(loading.requests[0].options.signal.aborted);
  const stalled = fixture(), waiting = stalled.speech.play(source); await flush();
  stalled.players[0].onplaying(); stalled.players[0].onstalled(); stalled.runTimer(15000);
  assert.equal(await waiting, false); assert.equal(stalled.revoked.length, 1);
  const failed = stalled.speech.play(source); await flush(); stalled.players[1].onerror(); assert.equal(await failed, false);
});

test('server voice discovery is asynchronous and reports unavailable Mac voices', async () => {
  const f = fixture({ fetcher: async () => ({ ok: true, json: async () => ({ available: false, voices: [], error: 'Mac 서버에 일본어 음성이 없습니다.' }) }) });
  assert.deepEqual(await f.speech.voices(), { available: false, voices: [], error: 'Mac 서버에 일본어 음성이 없습니다.' });
  assert.equal(f.requests[0].url, '/api/tts/voices'); assert.equal(f.requests[0].options.credentials, 'same-origin'); assert.equal(f.timers.size, 0);
});

test('free text and invalid playback options never produce server requests', async () => {
  const f = fixture();
  assert.equal(await f.speech.play('任意のテキスト'), false);
  assert.equal(await f.speech.play(source, { repeats: 4 }), false);
  assert.equal(await f.speech.play({ questionId: 'q1', part: 'word' }), false);
  assert.equal(f.requests.length, 0);
});
