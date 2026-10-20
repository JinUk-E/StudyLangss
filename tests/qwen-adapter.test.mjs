import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQwenBackend, loadQwenConfig, createAppTts } from '../lib/qwen-tts.mjs';
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
