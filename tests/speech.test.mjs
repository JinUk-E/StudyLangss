import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJapaneseSpeech, createSpeech } from '../public/speech.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const source = { entryId: 'ja-n5-1', part: 'sentence' };
function fixture({ fetcher, blocked = false, service = 'study', storage = new Map(), rejectStorage = false, webAudio = false } = {}) {
  const requests = [], players = [], revoked = [], timers = new Map(); let timerId = 0, blockNext = blocked;
  const host = {
    localStorage: { getItem(key) { if (rejectStorage) throw Error('denied'); return storage.get(key) ?? null; }, setItem(key, value) { if (rejectStorage) throw Error('denied'); storage.set(key, value); } },
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
  const contexts = [], gains = [], sources = [];
  if (webAudio) host.AudioContext = class {
    state = 'suspended'; currentTime = 0; destination = {};
    constructor() { contexts.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { const node = { gain: { value: 1, setTargetAtTime(value) { this.value = value; } }, connect() {}, disconnect() { this.disconnected = true; } }; gains.push(node); return node; }
    createMediaElementSource() { const node = { connect() {}, disconnect() { this.disconnected = true; } }; sources.push(node); return node; }
  };
  return { speech: service === 'study' ? createJapaneseSpeech(host) : createSpeech(host, { service }), host, storage, contexts, gains, sources, requests, players, revoked, timers, runTimer(duration) { const [id, timer] = [...timers].find(([, value]) => value.duration === duration) || []; assert.ok(timer, `Missing ${duration}ms timer`); timers.delete(id); timer.callback(); } };
}

test('volume changes live without another request and persists across study/chat visits', async () => {
  const storage = new Map(), f = fixture({ storage });
  assert.equal(f.speech.getVolume(), 1); f.speech.setVolume(.7);
  const pending = f.speech.play(source); await flush();
  assert.equal(f.players[0].volume, .7);
  f.speech.setVolume(.3); assert.equal(f.players[0].volume, .3); assert.equal(f.requests.length, 1);
  f.speech.setVolume(0); assert.equal(f.players[0].muted, true);
  const chat = fixture({ storage, service: 'chat' }); assert.equal(chat.speech.getVolume(), 0);
  f.speech.setVolume(1); assert.equal(f.players[0].muted, false);
  f.players[0].onended(); assert.equal(await pending, true);
});

test('pending synthesis, repeated playback and blocked storage use the current volume safely', async () => {
  for (const stored of ['NaN', '-1', '2', '', 'no']) assert.equal(fixture({ storage: new Map([['starlight.speech-volume', stored]]) }).speech.getVolume(), 1);
  const f = fixture({ rejectStorage: true });
  const pending = f.speech.play(source, { repeats: 2 }); f.speech.setVolume(.25); await flush();
  assert.equal(f.players[0].volume, .25);
  f.players[0].onended(); f.speech.setVolume(.6); f.runTimer(350); assert.equal(f.players[0].volume, .6);
  for (const value of [NaN, Infinity, -1, 2, '0.5']) assert.equal(f.speech.setVolume(value), false);
  assert.equal(f.speech.getVolume(), .6); f.players[0].onended(); assert.equal(await pending, true);
});

test('Web Audio gain controls live volume, shares one context and disconnects stopped players', async () => {
  const f = fixture({ webAudio: true });
  const pending = f.speech.play(source); assert.equal(f.contexts[0].state, 'running'); await flush();
  f.speech.setVolume(.4); assert.equal(f.gains[0].gain.value, .4);
  f.speech.setVolume(0); assert.equal(f.players[0].muted, true); assert.equal(f.gains[0].gain.value, 0);
  f.speech.cancel(); assert.equal(await pending, false); assert.ok(f.sources[0].disconnected); assert.ok(f.gains[0].disconnected);
  const second = createSpeech(f.host, { service: 'chat' }); second.setVolume(.8);
  const playing = second.play({ messageId: 'm1' }); await flush();
  assert.equal(f.contexts.length, 1); assert.equal(f.gains[1].gain.value, .8);
  assert.equal(f.gains[0].gain.value, 0); // Released players no longer subscribe.
  f.players[1].onended(); assert.equal(await playing, true);
});

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

test('playback watchdog allows a 180-second source at the selected slower study speed', async () => {
  const f = fixture(), pending = f.speech.play(source, { rate: .5 });
  await flush(); f.players[0].onplaying();
  assert.ok([...f.timers.values()].some(timer => timer.duration === 375000));
  f.players[0].onended(); assert.equal(await pending, true);
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
  loading.runTimer(150000); assert.equal(await pending, false); assert.ok(loading.requests[0].options.signal.aborted);
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

test('Korean meaning and explanation requests carry only stored source IDs', async () => {
  const f = fixture();
  for (const item of [{ entryId: 'ja-n5-1', part: 'meaning' }, { questionId: 'q1', part: 'explanation' }]) {
    const pending = f.speech.play(item); await flush(); f.players.at(-1).onended();
    assert.equal(await pending, true); assert.deepEqual(JSON.parse(f.requests.at(-1).options.body), item);
  }
  assert.equal(await f.speech.play({ ...source, text: 'arbitrary text' }), false);
  assert.equal(f.requests.length, 2);
});

test('chat speech isolates endpoint and includes language in the iOS prepared-audio key', async () => {
  const f = fixture({ service: 'chat', blocked: true }), messages = [];
  const item = { messageId: 'message-1', language: 'ko' };
  assert.equal(await f.speech.play(item, { status: text => messages.push(text) }), false);
  assert.equal(f.requests[0].url, '/api/chat/tts/audio'); assert.deepEqual(JSON.parse(f.requests[0].options.body), item);
  const pending = f.speech.play({ ...item, language: 'ja' }); await flush();
  assert.equal(f.requests.length, 2); assert.equal(f.revoked.length, 1); assert.match(messages.at(-1), /중지/);
  f.players[1].onended(); assert.equal(await pending, true);
  assert.equal(await f.speech.play({ messageId: 'message-1', language: 'en' }), false);
  assert.equal(await f.speech.play({ messageId: 'message-1', text: 'never send' }), false);
  assert.equal(await f.speech.play(source), false); assert.equal(f.requests.length, 2);
});

test('chat voice discovery preserves provider readiness and reports backend busy errors verbatim', async () => {
  const metadata = { available: false, provider: 'qwen3-tts', state: 'loading', voices: [], error: '모델을 준비 중입니다.' };
  const f = fixture({ service: 'chat', fetcher: async () => ({ ok: true, json: async () => metadata }) });
  assert.deepEqual(await f.speech.voices(), metadata); assert.equal(f.requests[0].url, '/api/chat/tts/voices');
  const statuses = [], busy = fixture({ service: 'chat', fetcher: async () => ({ ok: false, status: 503, json: async () => ({ error: '다른 음성을 생성 중입니다. 잠시 후 다시 시도해 주세요.' }) }) });
  assert.equal(await busy.speech.play({ messageId: 'm1' }, { status: text => statuses.push(text) }), false);
  assert.match(statuses.at(-1), /다른 음성을 생성 중/); assert.equal(busy.players.length, 0);
});
