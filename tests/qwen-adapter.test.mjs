import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQwenBackend, loadQwenConfig, createAppTts, qwenIdentity } from '../lib/qwen-tts.mjs';
import { createTts } from '../lib/tts.mjs';
import manifest from '../tts/manifest.json' with { type: 'json' };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'qwen-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'qwen.json');
  const config = { version: 1, port: 8877, token: 'a'.repeat(64), ...manifest };
  await writeFile(filename, JSON.stringify(config), { mode: 0o600 });
  return { directory, filename, config };
}
const ready = { ...manifest, ready: true, state: 'ready', languages: ['ko', 'ja'], speakers: { ko: 'Sohee', ja: 'Ono_Anna' } };
test('Qwen rejects malformed or incompatible local configurations', async t => {
  const { filename, config } = await fixture(t);
  assert.equal(loadQwenConfig(filename).port, 8877);
  for (const patch of [{ token: 'short' }, { port: 9000 }, { version: 2 }, { modelRevision: 'other' }, { styleVersion: 'other' }, { segmentationVersion: 'other' }]) {
    await writeFile(filename, JSON.stringify({ ...config, ...patch }));
    assert.throws(() => loadQwenConfig(filename));
  }
});
test('Qwen readiness rejects every manifest mismatch, loading and missing native voices', async t => {
  const { filename } = await fixture(t);
  let health = ready;
  const backend = createQwenBackend(filename, { request: async () => ({ status: 200, buffer: Buffer.from(JSON.stringify(health)) }) });
  assert.equal((await backend.voices()).available, true);
  for (const key of ['protocolVersion', 'modelId', 'modelRevision', 'styleVersion', 'segmentationVersion']) {
    health = { ...ready, [key]: 'other' };
    assert.equal((await backend.voices()).state, 'version-mismatch');
  }
  health = { ...ready, ready: false, state: 'loading' };
  assert.equal((await backend.voices()).state, 'loading');
  health = { ...ready, speakers: { ko: 'wrong', ja: 'Ono_Anna' } };
  assert.equal((await backend.voices()).available, false);
});
test('explicit Qwen without active configuration reports unavailable and never selects Mac say', async t => {
  const { directory } = await fixture(t);
  const tts = createAppTts({ root: directory, cacheDir: join(directory, 'cache'), env: { TTS_ENGINE: 'qwen' } });
  t.after(() => tts.close());
  const state = await tts.voices();
  assert.equal(state.provider, 'qwen3-tts');
  assert.equal(state.state, 'not-configured');
  await assert.rejects(tts.synthesize('안녕하세요', { language: 'ko' }), error => error.status === 503);
});

test('Qwen replaces pre-normalization cache entries and caches the louder audio once', async t => {
  const { directory, filename } = await fixture(t);
  const raw = Buffer.alloc(48);
  raw.write('RIFF'); raw.writeUInt32LE(40, 4); raw.write('WAVEfmt ', 8); raw.writeUInt32LE(16, 16);
  raw.writeUInt16LE(1, 20); raw.writeUInt16LE(1, 22); raw.writeUInt32LE(24000, 24); raw.writeUInt32LE(48000, 28);
  raw.writeUInt16LE(2, 32); raw.writeUInt16LE(16, 34); raw.write('data', 36); raw.writeUInt32LE(4, 40);
  raw.writeInt16LE(1000, 44); raw.writeInt16LE(-1000, 46);
  const legacyIdentity = JSON.stringify(['qwen-tts-pcm-v1', manifest.protocolVersion, manifest.modelId, manifest.modelRevision, manifest.styleVersion, manifest.segmentationVersion]);
  const legacyKey = createHash('sha256').update(JSON.stringify([legacyIdentity, 'study', 'owner', 'ja', 'stella-ja', 'こんにちは'])).digest('hex');
  await writeFile(join(directory, `${legacyKey}.wav`), raw);
  let generated = 0;
  const backend = createQwenBackend(filename, { request: async (_, path) => {
    if (path === '/health') return { status: 200, buffer: Buffer.from(JSON.stringify(ready)) };
    generated++; return { status: 200, type: 'audio/wav', buffer: raw };
  } });
  assert.notEqual(qwenIdentity, legacyIdentity);
  const tts = createTts({ cacheDir: directory, backend }); t.after(() => tts.close());
  const first = await tts.synthesize('こんにちは'), second = await tts.synthesize('こんにちは');
  assert.equal(first.cached, false); assert.notEqual(first.cacheKey, legacyKey);
  assert.equal(first.buffer.readInt16LE(44), 5193); assert.equal(first.buffer.readInt16LE(46), -5193);
  assert.equal(second.cached, true); assert.deepEqual(second.buffer, first.buffer); assert.equal(generated, 1);
  assert.deepEqual(await readFile(join(directory, `${legacyKey}.wav`)), raw);
});

test('English voice is advertised only when the worker confirms its native speaker', async t => {
  const { filename } = await fixture(t);
  let health = { ...ready, languages: ['ko','ja','en'], speakers: { ...ready.speakers, en: 'Ryan' } };
  const backend = createQwenBackend(filename, { request: async () => ({ status: 200, buffer: Buffer.from(JSON.stringify(health)) }) });
  assert.equal((await backend.voices()).voices.find(v=>v.language==='en-US').id,'stella-en');
  health = ready; assert.equal((await backend.voices()).voices.some(v=>v.language==='en-US'),false);
});
