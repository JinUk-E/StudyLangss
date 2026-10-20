import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQwenWav } from '../lib/qwen-audio.mjs';

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
