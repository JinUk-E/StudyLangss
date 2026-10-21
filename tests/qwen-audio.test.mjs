import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQwenWav, normalizeQwenWav } from '../lib/qwen-audio.mjs';

function wave({ rate = 24000, channels = 1, frames = 2 } = {}) {
  const bytes = frames * channels * 2, buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * channels * 2, 28); buffer.writeUInt16LE(channels * 2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40); return buffer;
}
test('Qwen PCM contract accepts mono 24kHz only with audio WAV content type', () => {
  assert.equal(validateQwenWav(wave(), 'audio/wav'), true);
  assert.equal(validateQwenWav(wave(), 'audio/x-wav; charset=binary'), true);
  for (const audio of [wave({ rate: 22050 }), wave({ channels: 2 }), Buffer.from('corrupt')]) assert.equal(validateQwenWav(audio, 'audio/wav'), false);
  assert.equal(validateQwenWav(wave(), 'application/octet-stream'), false);
  assert.equal(validateQwenWav(wave(), null), false);
});
test('Qwen PCM contract rejects over 180 seconds, corrupt RIFF and files over 16MiB', () => {
  assert.equal(validateQwenWav(wave({ frames: 24000 * 180 }), 'audio/wav'), true);
  assert.equal(validateQwenWav(wave({ frames: 24000 * 180 + 1 }), 'audio/wav'), false);
  const bad = wave(); bad.writeUInt32LE(5, 4); assert.equal(validateQwenWav(bad, 'audio/wav'), false);
  assert.equal(validateQwenWav(Buffer.alloc(16 * 1024 * 1024 + 1), 'audio/wav'), false);
});

function signal(samples) {
  const buffer = wave({ frames: samples.length });
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
  return buffer;
}
const samples = buffer => Array.from({ length: (buffer.length - 44) / 2 }, (_, index) => buffer.readInt16LE(44 + index * 2));

test('quiet speech is louder with identical duration, headers and source bytes', () => {
  const input = signal([2000, -2000, 0, 2000, -2000]), original = Buffer.from(input);
  const output = normalizeQwenWav(input), values = samples(output);
  assert.deepEqual(input, original); assert.equal(output.length, input.length);
  assert.deepEqual(output.subarray(0, 44), input.subarray(0, 44));
  assert.equal(validateQwenWav(output, 'audio/wav'), true);
  assert.ok(values[0] > 5000 && values[0] < 6000); assert.equal(values[1], -values[0]); assert.equal(values[2], 0);
});

test('gain is bounded and peaks retain headroom without flattening the waveform', () => {
  assert.deepEqual(samples(normalizeQwenWav(signal([100, -100]))), [800, -800]);
  const output = samples(normalizeQwenWav(signal([20000, -10000, ...Array(98).fill(100)])));
  assert.ok(output[0] <= 29205 && output[0] > 20000);
  assert.ok(Math.abs(output[0] + 2 * output[1]) <= 1);
  for (const value of samples(normalizeQwenWav(signal([-32768, 32767])))) assert.ok(Math.abs(value) <= 29205);
});

test('silence, near-silence and already adequate speech are not amplified', () => {
  for (const values of [[0, 0], [1, -1], [6000, -6000]]) {
    const input = signal(values); assert.deepEqual(normalizeQwenWav(input), input);
  }
  assert.throws(() => normalizeQwenWav(Buffer.from('broken')), /Invalid Qwen/);
});
