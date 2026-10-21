import { validWav } from './tts.mjs';

// Include processing changes in cache identity so old, quiet WAVs are not reused.
export const qwenAudioVersion = 'pcm16-rms-v1';

/** One contract for activation samples and authenticated application responses. */
export function validateQwenWav(buffer, contentType) {
  if (typeof contentType !== 'string' || !/^audio\/(?:wav|x-wav)(?:\s*;|$)/i.test(contentType) || !Buffer.isBuffer(buffer) || buffer.length > 16 * 1024 * 1024 || !validWav(buffer)) return false;
  let formatCount = 0, dataCount = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), start = offset + 8;
    if (kind === 'fmt ') {
      formatCount++;
      if (buffer.readUInt16LE(start) !== 1 || buffer.readUInt16LE(start + 2) !== 1 || buffer.readUInt32LE(start + 4) !== 24000 || buffer.readUInt16LE(start + 14) !== 16) return false;
    }
    if (kind === 'data') { dataCount++; if (!size || size > 24000 * 2 * 180) return false; }
    offset = start + size + (size % 2);
  }
  return formatCount === 1 && dataCount === 1;
}

/** Raise quiet speech with one gain for the whole utterance, without hard clipping. */
export function normalizeQwenWav(buffer) {
  if (!validateQwenWav(buffer, 'audio/wav')) throw new TypeError('Invalid Qwen PCM audio');
  const output = Buffer.from(buffer);
  for (let offset = 12; offset + 8 <= output.length;) {
    const size = output.readUInt32LE(offset + 4), start = offset + 8;
    if (output.toString('ascii', offset, offset + 4) === 'data') {
      let squares = 0, peak = 0;
      for (let index = start; index < start + size; index += 2) {
        const sample = output.readInt16LE(index);
        squares += sample * sample; peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(squares / (size / 2));
      // Leave silence/noise below -60 dBFS alone. Aim for -16 dBFS RMS,
      // cap amplification at 8x (+18 dB), and retain 1 dB of peak headroom.
      if (rms <= 32768 * 0.001) return output;
      const gain = Math.min(8, Math.max(1, 32768 * 10 ** (-16 / 20) / rms), 32768 * 10 ** (-1 / 20) / peak);
      for (let index = start; index < start + size; index += 2) {
        output.writeInt16LE(Math.round(output.readInt16LE(index) * gain), index);
      }
      return output;
    }
    offset = start + size + (size % 2);
  }
  return output;
}
