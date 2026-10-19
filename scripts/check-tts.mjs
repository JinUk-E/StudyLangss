import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTts } from '../lib/tts.mjs';

// Run under the same Mac user as the study LaunchAgent. No login credentials needed.
const directory = resolve(process.env.DATA_DIR || 'data');
const tts = createTts({ cacheDir: resolve(directory, 'tts-cache') });
try {
  const status = await tts.voices();
  if (!status.available) throw new Error(status.error || 'Mac 서버 음성을 사용할 수 없습니다.');
  console.log(`일본어 음성: ${status.voices.map(voice => voice.name).join(', ')}`);
  const text = '今日は日本語の勉強をします。音声を確認してください。';
  const audio = await tts.synthesize(text);
  await mkdir(directory, { recursive: true });
  const filename = resolve(directory, 'tts-check.wav');
  await writeFile(filename, audio.buffer, { mode: 0o600 });
  const repeated = await tts.synthesize(text);
  if (!repeated.cached) throw new Error('음성 캐시 재사용을 확인하지 못했습니다.');
  console.log(`합성·WAV 형식·캐시 재사용 확인: ${audio.buffer.length} bytes`);
  console.log(`직접 들어 볼 파일: ${filename}`);
} catch (error) {
  console.error(`서버 음성 점검 실패: ${error.message}`);
  process.exitCode = 1;
} finally { await tts.close(); }
