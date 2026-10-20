import { validWav } from './tts.mjs';

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
