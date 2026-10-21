import { request as httpRequest } from 'node:http';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import manifest from '../tts/manifest.json' with { type: 'json' };
import { createTts } from './tts.mjs';
import { validateQwenWav, normalizeQwenWav, qwenAudioVersion } from './qwen-audio.mjs';

const failure = (message, status = 503, code = 'QWEN_UNAVAILABLE') => Object.assign(new Error(message), { status, code });
const voices = [
  { id: 'stella-ja', name: '스텔라 · 일본어 (차분하고 부드럽게)', language: 'ja-JP' },
  { id: 'stella-ko', name: '스텔라 · 한국어 (차분하고 부드럽게)', language: 'ko-KR' }
];
export const qwenIdentity = JSON.stringify(['qwen-tts-pcm-v1', manifest.protocolVersion, manifest.modelId, manifest.modelRevision, manifest.styleVersion, manifest.segmentationVersion, qwenAudioVersion]);
export function loadQwenConfig(filename) {
  const info = lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384 || process.platform === 'darwin' && (info.mode & 0o077)) throw failure('Qwen 설정 파일의 권한과 형식을 확인해 주세요.');
  const config = JSON.parse(readFileSync(filename, 'utf8'));
  if (config.version !== 1 || config.port !== 8877 || typeof config.token !== 'string' || !/^[a-f0-9]{64}$/.test(config.token)) throw failure('Qwen 설정을 다시 확인해 주세요.');
  for (const key of ['protocolVersion', 'modelId', 'modelRevision', 'styleVersion', 'segmentationVersion']) if (config[key] !== manifest[key]) throw failure('Qwen 서비스 버전이 앱과 다릅니다. Mac에서 설치·점검 명령을 다시 실행해 주세요.', 503, 'QWEN_VERSION_MISMATCH');
  return config;
}
/** Numeric loopback + native HTTP deliberately bypasses environment proxy and DNS settings. */
export function qwenRequest(config, path, { body, signal, timeoutMs = 3000, maxBytes = 16384 } = {}) {
  return new Promise((done, fail) => {
    if (signal?.aborted) return fail(signal.reason);
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    const timer = setTimeout(() => controller.abort(failure('Qwen 음성 요청 시간이 초과되었습니다.', 504, 'QWEN_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const request = httpRequest({ host: '127.0.0.1', port: 8877, path, method: data ? 'POST' : 'GET', signal: controller.signal, agent: false,
      headers: { Authorization: `Bearer ${config.token}`, Connection: 'close', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) } }, response => {
      let size = 0; const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(failure('Qwen 음성 응답이 너무 큽니다.', 502, 'QWEN_OUTPUT_LIMIT')); return; }
        chunks.push(chunk);
      });
      response.once('error', error => { cleanup(); fail(controller.signal.aborted ? controller.signal.reason : error); });
      response.once('end', () => { cleanup(); done({ status: response.statusCode, type: response.headers['content-type'] || '', buffer: Buffer.concat(chunks) }); });
    });
    request.once('error', error => { cleanup(); fail(controller.signal.aborted ? controller.signal.reason : error); });
    if (signal?.aborted) abort();
    request.end(data);
  });
}
export function createQwenBackend(filename, { request = qwenRequest } = {}) {
  let config, configError;
  try { config = loadQwenConfig(filename); } catch { configError = 'Qwen3-TTS 설정이 없거나 버전·권한이 맞지 않습니다. Mac의 설치·점검 안내를 확인해 주세요.'; }
  return {
    identity: qwenIdentity,
    async voices() {
      const off = (state, error) => ({ available: false, voices: [], provider: 'qwen3-tts', state, error });
      if (!config) return off('not-configured', configError);
      try {
        const result = await request(config, '/health');
        if (result.status !== 200) return off('unavailable', 'Qwen 음성 서비스 인증·실행 상태를 Mac에서 확인해 주세요.');
        const health = JSON.parse(result.buffer.toString('utf8'));
        for (const key of ['protocolVersion', 'modelId', 'modelRevision', 'styleVersion', 'segmentationVersion']) if (health[key] !== manifest[key]) return off('version-mismatch', 'Qwen 서비스 버전이 앱과 다릅니다. Mac 설치·점검 명령을 다시 실행해 주세요.');
        if (!health.ready) return off(health.state === 'loading' ? 'loading' : 'unavailable', health.state === 'loading' ? 'Mac에서 Qwen 음성 모델을 불러오고 있습니다. 잠시 후 다시 시도해 주세요.' : 'Qwen 음성 모델을 시작하지 못했습니다. Mac 로그를 확인해 주세요.');
        if (!health.languages?.includes('ko') || !health.languages?.includes('ja') || health.speakers?.ko !== 'Sohee' || health.speakers?.ja !== 'Ono_Anna') return off('version-mismatch', '한국어·일본어 음성을 확인하지 못했습니다. Mac에서 모델을 다시 점검해 주세요.');
        return { available: true, voices, provider: 'qwen3-tts', state: 'ready', prepareTimeoutMs: 150000 };
      } catch { return off('unavailable', 'Qwen 음성 서비스에 연결하지 못했습니다. Mac의 org.starlightforge.tts 실행 상태를 확인해 주세요.'); }
    },
    async generate({ text, language, signal, destination }) {
      if (!config) throw failure(configError);
      const result = await request(config, '/synthesize', { body: { text, language }, signal, timeoutMs: 120000, maxBytes: 16 * 1024 * 1024 });
      if (result.status === 429) throw failure('음성 모델이 다른 요청을 처리 중입니다. 잠시 후 다시 눌러 주세요.', 429, 'QWEN_BUSY');
      if (result.status === 504) throw failure('음성 생성 제한 시간을 넘었습니다. 더 짧은 자료로 다시 시도해 주세요.', 504, 'QWEN_TIMEOUT');
      if (result.status !== 200) throw failure('Qwen 음성을 완성하지 못했습니다. 글 길이와 Mac 서비스 상태를 확인해 주세요.', result.status >= 400 && result.status < 500 ? 400 : 503, 'QWEN_GENERATION_FAILED');
      if (!validateQwenWav(result.buffer, result.type)) throw failure('Qwen 서비스의 PCM16 mono 24kHz WAV 형식 또는 재생 길이를 확인해 주세요.', 502, 'QWEN_INVALID_AUDIO');
      signal?.throwIfAborted();
      await writeFile(destination, normalizeQwenWav(result.buffer), { mode: 0o600, flag: 'wx' });
    }
  };
}
export function createAppTts({ root, cacheDir, namespace = 'study', env = process.env } = {}) {
  const filename = resolve(env.TTS_CONFIG_FILE || resolve(root, 'data/tts/qwen.json'));
  const selected = env.TTS_ENGINE || (existsSync(filename) ? 'qwen' : 'mac');
  if (selected === 'mac') return createTts({ cacheDir, namespace });
  if (selected !== 'qwen') return createTts({ cacheDir, namespace, backend: { identity: 'invalid-engine', voices: async () => ({ available: false, voices: [], state: 'not-configured', provider: 'qwen3-tts', error: 'TTS_ENGINE은 qwen 또는 mac으로 설정해 주세요.' }) } });
  return createTts({ cacheDir, namespace, timeoutMs: 120000, requestTimeoutMs: 140000, maxQueue: 4, backend: createQwenBackend(filename) });
}
