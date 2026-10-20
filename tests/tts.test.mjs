import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTts, runCommand, validWav } from '../lib/tts.mjs';

function wav() {
  const result = Buffer.alloc(48);
  result.write('RIFF'); result.writeUInt32LE(40, 4); result.write('WAVEfmt ', 8); result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22); result.writeUInt32LE(22050, 24); result.writeUInt32LE(44100, 28);
  result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write('data', 36); result.writeUInt32LE(4, 40); result.writeInt16LE(30, 44);
  return result;
}
const voicesOutput = 'Kyoko               ja_JP    # こんにちは\nSamantha            en_US    # Hello\nOtoya (Enhanced)     ja_JP    # こんにちは\n';
async function setup(t, options = {}, behavior) {
  const directory = await mkdtemp(join(tmpdir(), 'haru-tts-')), calls = [];
  const run = async (command, args, opts) => {
    calls.push({ command, args, opts });
    if (args[1] === '?') return { stdout: voicesOutput };
    if (behavior) return behavior(command, args, opts);
    if (command === '/usr/bin/say') await writeFile(args[args.indexOf('-o') + 1], 'AIFF');
    else await writeFile(args.at(-1), wav());
    return { stdout: '' };
  };
  const tts = createTts({ cacheDir: directory, platform: 'darwin', run, ...options });
  t.after(async () => { await tts.close(); await rm(directory, { recursive: true, force: true }); });
  return { tts, directory, calls };
}
const waitFor = async condition => { const end = Date.now() + 2000; while (!condition()) { if (Date.now() > end) throw new Error('condition timeout'); await new Promise(resolve => setTimeout(resolve, 5)); } };

test('TTS reports unsupported servers and missing Japanese voices without attempting synthesis', async t => {
  const { tts, calls } = await setup(t, { platform: 'win32' });
  assert.deepEqual((await tts.voices()).voices, []);
  await assert.rejects(tts.synthesize('学校'), error => error.status === 503 && /macOS/.test(error.message));
  assert.equal(calls.length, 0);
  const empty = await setup(t, { run: async () => ({ stdout: 'Samantha en_US # Hello' }) });
  assert.equal((await empty.tts.voices()).available, false);
  await assert.rejects(empty.tts.synthesize('学校'), /日本語|일본어/);
});

test('TTS only lists installed Japanese voices and rejects text directives and unknown voice names', async t => {
  const { tts, calls } = await setup(t);
  const list = await tts.voices();
  assert.equal(list.available, true);
  assert.deepEqual(list.voices.map(item => item.id), ['Kyoko', 'Otoya (Enhanced)']);
  assert.ok(list.voices.every(item => item.language === 'ja-JP'));
  for (const text of ['', ' ', 'a'.repeat(2001), '\0bad', '[[rate 999]]hello']) await assert.rejects(tts.synthesize(text), error => error.status === 400);
  await assert.rejects(tts.synthesize('学校', { voice: 'Samantha' }), error => error.code === 'TTS_INVALID_VOICE');
  await assert.rejects(tts.synthesize('学校', { voice: '; rm -rf /' }), error => error.status === 400);
  assert.equal(calls.length, 1);
});

test('TTS writes UTF-8 input privately, uses fixed argv and returns a validated WAV cache', async t => {
  let inputText;
  const { tts, directory, calls } = await setup(t, {}, async (command, args) => {
    if (command === '/usr/bin/say') { inputText = await readFile(args[args.indexOf('-f') + 1], 'utf8'); await writeFile(args[args.indexOf('-o') + 1], 'AIFF'); }
    else await writeFile(args.at(-1), wav());
    return { stdout: '' };
  });
  const text = '学校へ行きます。 "$(touch bad)"';
  const first = await tts.synthesize(text);
  assert.equal(first.cached, false); assert.equal(first.contentType, 'audio/wav'); assert.equal(validWav(first.buffer), true);
  assert.equal(inputText, text);
  assert.deepEqual(calls[1].args.slice(0, 2), ['-v', 'Kyoko']);
  assert.ok(!calls[1].args.includes(text));
  assert.deepEqual(calls[2].args.slice(0, 6), ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1']);
  const second = await tts.synthesize(text);
  assert.equal(second.cached, true); assert.equal(second.cacheKey, first.cacheKey); assert.equal(calls.length, 3);
  assert.deepEqual(await readdir(directory), [`${first.cacheKey}.wav`]);
});

test('TTS deduplicates identical requests and serializes different synthesis jobs', async t => {
  let active = 0, peak = 0, syntheses = 0;
  const { tts } = await setup(t, {}, async (command, args) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    if (command === '/usr/bin/say') { syntheses++; await writeFile(args[args.indexOf('-o') + 1], 'AIFF'); }
    else await writeFile(args.at(-1), wav());
    active--; return { stdout: '' };
  });
  const [a, duplicate, b] = await Promise.all([tts.synthesize('学校'), tts.synthesize('学校'), tts.synthesize('先生')]);
  assert.equal(a.cacheKey, duplicate.cacheKey); assert.notEqual(a.cacheKey, b.cacheKey);
  assert.equal(peak, 1); assert.equal(syntheses, 2);
});

test('one subscriber cancellation preserves shared synthesis; last cancellation aborts and removes temporary files', async t => {
  let release, signals = [];
  const { tts, directory } = await setup(t, {}, async (command, args, { signal }) => {
    if (command === '/usr/bin/say') {
      signals.push(signal);
      await new Promise((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
      await writeFile(args[args.indexOf('-o') + 1], 'AIFF');
    } else await writeFile(args.at(-1), wav());
    return { stdout: '' };
  });
  const a = new AbortController(), b = new AbortController();
  const first = tts.synthesize('同じ文', { signal: a.signal }), second = tts.synthesize('同じ文', { signal: b.signal });
  const rejected = assert.rejects(first, error => error.code === 'TTS_CANCELLED');
  await waitFor(() => signals.length === 1); a.abort(); await rejected;
  assert.equal(signals[0].aborted, false); release(); assert.equal(validWav((await second).buffer), true);
  const c = new AbortController(), last = tts.synthesize('別の文', { signal: c.signal });
  const lastRejected = assert.rejects(last, error => error.code === 'TTS_CANCELLED');
  await waitFor(() => signals.length === 2); c.abort(); await lastRejected;
  await tts.close();
  assert.equal(signals[1].aborted, true);
  assert.ok((await readdir(directory)).every(name => /^[a-f0-9]{64}\.wav$/.test(name)));
});

test('TTS times out a hung command, cleans temporary files, and permits retry', async t => {
  let hang = true;
  const { tts, directory } = await setup(t, { timeoutMs: 30 }, async (command, args, { signal }) => {
    if (command === '/usr/bin/say' && hang) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    await writeFile(command === '/usr/bin/say' ? args[args.indexOf('-o') + 1] : args.at(-1), command === '/usr/bin/say' ? 'AIFF' : wav());
    return { stdout: '' };
  });
  await assert.rejects(tts.synthesize('時間切れ'), error => error.code === 'TTS_TIMEOUT' && error.status === 504);
  assert.deepEqual(await readdir(directory), []); hang = false;
  assert.equal(validWav((await tts.synthesize('時間切れ')).buffer), true);
});

test('TTS rejects corrupt output and corrupt cached files are regenerated', async t => {
  let corrupt = true;
  const { tts, directory } = await setup(t, {}, async (command, args) => {
    await writeFile(command === '/usr/bin/say' ? args[args.indexOf('-o') + 1] : args.at(-1), command === '/usr/bin/say' ? 'AIFF' : corrupt ? Buffer.from('not wave') : wav());
    return { stdout: '' };
  });
  await assert.rejects(tts.synthesize('音声'), error => error.code === 'TTS_INVALID_AUDIO');
  assert.deepEqual(await readdir(directory), []); corrupt = false;
  const good = await tts.synthesize('音声');
  await writeFile(join(directory, `${good.cacheKey}.wav`), 'broken');
  assert.equal((await tts.synthesize('音声')).cached, false);
});

test('request deadline includes queue wait and aborts generation instead of overrunning the browser wait', async t => {
  const entered = [];
  const backend = {
    identity: 'test-deadline',
    voices: async () => ({ available: true, voices: [{ id: 'ja', language: 'ja-JP' }] }),
    async generate({ text, signal, destination }) {
      entered.push(text);
      await new Promise((done, fail) => {
        const timer = setTimeout(done, 100);
        signal.addEventListener('abort', () => { clearTimeout(timer); fail(signal.reason); }, { once: true });
      });
      await writeFile(destination, wav());
    }
  };
  const { tts } = await setup(t, { backend, timeoutMs: 1000, requestTimeoutMs: 160 });
  const first = tts.synthesize('最初');
  await waitFor(() => entered.length === 1);
  const queued = tts.synthesize('次の音声');
  const rejected = assert.rejects(queued, error => error.status === 504 && error.code === 'TTS_TIMEOUT');
  assert.equal(validWav((await first).buffer), true);
  await rejected;
  assert.deepEqual(entered, ['最初', '次の音声']);
});

test('TTS cache evicts oldest files and rejects oversized audio', async t => {
  const { tts, directory } = await setup(t, { maxCacheBytes: 96, maxAudioBytes: 48 });
  const a = await tts.synthesize('一'); await new Promise(resolve => setTimeout(resolve, 5));
  await tts.synthesize('二'); await new Promise(resolve => setTimeout(resolve, 5));
  await tts.synthesize('三');
  const files = await readdir(directory);
  assert.equal(files.length, 2); assert.ok(!files.includes(`${a.cacheKey}.wav`));
  const small = await setup(t, { maxAudioBytes: 47 });
  await assert.rejects(small.tts.synthesize('大きい'), error => error.code === 'TTS_AUDIO_LIMIT');
});

test('TTS queue cap, queued cancellation, and shutdown reject work without leaking jobs', async t => {
  let started = false;
  const { tts, directory } = await setup(t, { maxQueue: 2 }, async (command, args, { signal }) => {
    started = true;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const first = tts.synthesize('一'), firstRejected = assert.rejects(first, error => error.code === 'TTS_CANCELLED');
  await waitFor(() => started);
  const controller = new AbortController(), queued = tts.synthesize('二', { signal: controller.signal });
  const queuedRejected = assert.rejects(queued, error => error.code === 'TTS_CANCELLED');
  await assert.rejects(tts.synthesize('三'), error => error.status === 429);
  controller.abort(); await queuedRejected;
  await tts.close(); await firstRejected;
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(tts.synthesize('再開'), error => error.status === 503);
});

test('shutdown waits for cancelled old work when a new request replaces the same cache key', async t => {
  let entered = false;
  const { tts, directory } = await setup(t, {}, async (command, args, { signal }) => {
    entered = true;
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => setTimeout(() => reject(signal.reason), 25), { once: true }));
  });
  const controller = new AbortController();
  const first = tts.synthesize('同じ鍵', { signal: controller.signal });
  const firstRejected = assert.rejects(first, error => error.code === 'TTS_CANCELLED');
  await waitFor(() => entered); controller.abort(); await firstRejected;
  const retry = tts.synthesize('同じ鍵'), retryRejected = assert.rejects(retry, error => error.code === 'TTS_CANCELLED' || error.status === 503);
  // Let the replacement request enter the queue before shutting the service down.
  await new Promise(resolve => setTimeout(resolve, 1));
  await tts.close(); await retryRejected;
  assert.deepEqual(await readdir(directory), []);
});

test('WAV validation rejects truncation, empty data, non-PCM and wrong byte alignment', () => {
  const valid = wav(); assert.equal(validWav(valid), true);
  assert.equal(validWav(valid.subarray(0, 47)), false);
  for (const [offset, value] of [[20, 3], [22, 0], [34, 8], [40, 0]]) {
    const bad = Buffer.from(valid); bad.writeUInt16LE(value, offset); assert.equal(validWav(bad), false);
  }
});

test('command runner uses argv literally and enforces a hard timeout', async () => {
  const literal = '"; $(echo unsafe)';
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal]);
  assert.equal(result.stdout, literal);
  await assert.rejects(runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 40 }), error => error.code === 'TTS_TIMEOUT');
});
