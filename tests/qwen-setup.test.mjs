import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { identity, ttsPaths, validateConfig, atomicPrivateJson, privateJson, servicePlist, serviceHealth } from '../lib/qwen-setup.mjs';
import { stopService } from '../scripts/setup-qwen-tts.mjs';
import { checkSamples } from '../scripts/check-qwen-tts.mjs';

const config = { version: 1, ...identity, port: 8877, token: 'a'.repeat(64) };
function wave() {
  const buffer = Buffer.alloc(48); buffer.write('RIFF'); buffer.writeUInt32LE(40, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(4, 40); return buffer;
}
const health = { ...identity, state: 'ready', ready: true, languages: ['ko', 'ja'], speakers: { ko: 'Sohee', ja: 'Ono_Anna' } };

test('Qwen paths are shared independent of DATA_DIR; custom config must be absolute', () => {
  const root = resolve('fixture'), paths = ttsPaths(root, { DATA_DIR: 'unrelated' }, resolve('home'));
  assert.equal(paths.active, join(root, 'data/tts/qwen.json'));
  assert.equal(ttsPaths(root, { TTS_CONFIG_FILE: resolve('custom.json') }).active, resolve('custom.json'));
  assert.throws(() => ttsPaths(root, { TTS_CONFIG_FILE: 'relative.json' }), /절대/);
  assert.match(paths.cache, /Library[\\/]Caches/);
});
test('configuration rejects wrong protocol/model/token/port', () => {
  assert.equal(validateConfig(config), config);
  for (const altered of [{ protocolVersion: 2 }, { modelRevision: 'main' }, { token: 'short' }, { port: 80 }]) assert.throws(() => validateConfig({ ...config, ...altered }));
  assert.throws(() => validateConfig(config, { service: true }));
});
test('atomic private activation preserves existing token and readable identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qwen-config-'));
  try {
    const filename = join(directory, 'nested/qwen.json');
    assert.equal(await privateJson(filename, { optional: true }), null);
    await atomicPrivateJson(filename, config);
    assert.deepEqual(await privateJson(filename), config);
    if (process.platform !== 'win32') assert.equal((await stat(filename)).mode & 0o777, 0o600);
    assert.ok(!(await readFile(filename, 'utf8')).includes('modelPath'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('LaunchAgent escapes paths and binds fixed Python/config argv without shell or token', () => {
  const value = servicePlist(ttsPaths(resolve('a&b'), {}, resolve('home')));
  assert.match(value, /a&amp;b/); assert.match(value, /qwen_service\.py/); assert.match(value, /--config/);
  assert.ok(!value.includes(config.token)); assert.ok(!value.includes('/bin/sh'));
  assert.match(value, /HF_HUB_OFFLINE/);
});
test('refresh stops registered PID before allowing install, refuses an alive old PID', async () => {
  const calls = []; let aliveChecks = 0;
  await stopService({ uid: 501, run: async (file, args) => { calls.push(args[0]); return args[0] === 'print' ? ' pid = 123\n' : ''; }, alive: () => aliveChecks++ === 0, wait: async () => {} });
  assert.deepEqual(calls, ['print', 'bootout']); assert.equal(aliveChecks, 2);
  await assert.rejects(stopService({ uid: 501, run: async (_, args) => args[0] === 'print' ? 'pid = 123\n' : '', alive: () => true, wait: async () => {} }), /종료되지/);
});
test('health requires protocol identity and fixed bilingual speakers', async () => {
  assert.equal((await serviceHealth(config, { fetchImpl: async () => Response.json(health) })).ready, true);
  await assert.rejects(serviceHealth(config, { fetchImpl: async () => Response.json({ ...health, modelRevision: 'main' }) }), /버전/);
});
test('activation samples are real bilingual requests and reject second-language failure', async () => {
  const languages = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
    if (url.endsWith('/health')) return Response.json(health);
    const value = JSON.parse(options.body); languages.push(value.language);
    assert.deepEqual(Object.keys(value).sort(), ['language', 'text']);
    return new Response(wave(), { headers: { 'Content-Type': 'audio/wav' } });
  };
  const results = await checkSamples(config, { fetchImpl });
  assert.deepEqual(languages, ['ko', 'ja']); assert.equal(results.length, 2);
  await assert.rejects(checkSamples(config, { fetchImpl: async (url, options) => url.endsWith('/health') ? Response.json(health) : JSON.parse(options.body).language === 'ko' ? new Response(wave(), { headers: { 'Content-Type': 'audio/wav' } }) : new Response('{}', { status: 503 }) }), /ja/);
});
test('activation refuses 22050Hz, stereo, corrupt WAV or wrong content type', async () => {
  const lowRate = wave(); lowRate.writeUInt32LE(22050, 24); lowRate.writeUInt32LE(44100, 28);
  const stereo = wave(); stereo.writeUInt16LE(2, 22); stereo.writeUInt16LE(4, 32); stereo.writeUInt32LE(96000, 28);
  const corrupt = Buffer.from(wave()); corrupt.write('NOPE', 0);
  for (const [audio, type] of [[lowRate, 'audio/wav'], [stereo, 'audio/wav'], [corrupt, 'audio/wav'], [wave(), 'application/octet-stream']]) {
    await assert.rejects(checkSamples(config, { fetchImpl: async url => url.endsWith('/health') ? Response.json(health) : new Response(audio, { headers: { 'Content-Type': type } }) }), /PCM16/);
  }
});
