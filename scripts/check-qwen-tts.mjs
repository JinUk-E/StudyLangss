import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ttsPaths, privateJson, atomicPrivateJson, serviceHealth, identity } from '../lib/qwen-setup.mjs';
import { validateQwenWav, normalizeQwenWav } from '../lib/qwen-audio.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function checkSamples(config, { fetchImpl = fetch } = {}) {
  const health = await serviceHealth(config, { fetchImpl });
  if (!health.ready || health.state !== 'ready') throw Error(health.state === 'loading' ? 'Qwen 모델을 로딩 중입니다. 잠시 뒤 다시 점검하세요.' : '모델 준비에 실패했습니다. data/tts/service.stderr.log와 Mac 설치 안내를 확인하세요.');
  const samples = [];
  for (const [language, text] of [['ko', '안녕하세요. 저는 스텔라예요. 오늘도 차분하게 함께 공부해 볼까요?'], ['ja', 'こんにちは、ステラです。今日は一緒に日本語を勉強しましょう。']]) {
    const response = await fetchImpl('http://127.0.0.1:8877/synthesize', { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language }), redirect: 'error', signal: AbortSignal.timeout(150000) });
    if (!response.ok) throw Error(`${language} 실제 음성 생성 실패 (HTTP ${response.status}). 웹 엔진 설정은 바꾸지 않았습니다.`);
    const limit = 16 * 1024 * 1024;
    if (!response.body || Number(response.headers.get('content-length') || 0) > limit) throw Error('샘플 음성 크기가 올바르지 않습니다.');
    const chunks = []; let size = 0;
    for await (const part of response.body) { size += part.length; if (size > limit) throw Error('샘플 음성 크기가 너무 큽니다.'); chunks.push(part); }
    const audio = Buffer.concat(chunks);
    if (!validateQwenWav(audio, response.headers.get('content-type'))) throw Error(`${language} 샘플의 PCM16 mono 24kHz WAV 형식·길이를 확인하지 못했습니다.`);
    samples.push({ language, audio: normalizeQwenWav(audio) });
  }
  return samples;
}
export async function check(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--activate') || args.length > 1) throw Error('사용법: npm run check-qwen-tts [-- --activate]');
  const paths = ttsPaths(root), config = await privateJson(paths.service, { service: true });
  const previous = await privateJson(paths.active, { optional: true, allowPrevious: true });
  if (previous && previous.token !== config.token) throw Error('기존 활성 설정의 토큰이 다릅니다. 자동으로 덮어쓰지 않습니다. 설치 안내에서 경로를 확인하세요.');
  const samples = await checkSamples(config);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  for (const { language, audio } of samples) {
    const filename = join(paths.directory, `qwen-check-${language}.wav`);
    await writeFile(filename, audio, { mode: 0o600 });
    console.log(`실제 합성 성공: ${filename}`);
  }
  if (args.includes('--activate')) {
    await atomicPrivateJson(paths.active, { version: 1, ...identity, port: 8877, token: config.token });
    console.log('두 언어 합성을 확인하고 Qwen을 활성화했습니다. 샘플을 직접 들어 보고 학습·채팅 Node 서버를 다시 시작하세요.');
  } else console.log('음성 파일을 직접 들어 보세요. 웹에 적용하려면 --activate를 추가해 실행합니다.');
  console.log('launchctl kickstart -k "gui/$(id -u)/kr.haru.jlpt"');
  console.log('launchctl kickstart -k "gui/$(id -u)/org.starlightforge.chat"');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) check().catch(error => { console.error(error.message); process.exitCode = 1; });
