import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, chmod, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import manifest from '../tts/manifest.json' with { type: 'json' };

export { manifest };
export const label = 'org.starlightforge.tts';
export const identity = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'mlxAudioVersion'));
export function ttsPaths(root, env = process.env, home = homedir()) {
  root = resolve(root);
  if (env.TTS_CONFIG_FILE && !isAbsolute(env.TTS_CONFIG_FILE)) throw Error('TTS_CONFIG_FILE은 절대 경로여야 합니다.');
  return { root, directory: join(root, 'data/tts'), service: join(root, 'data/tts/service.json'),
    active: env.TTS_CONFIG_FILE || join(root, 'data/tts/qwen.json'), venv: join(root, '.venv-tts'),
    cache: join(home, 'Library/Caches/StarlightForge/qwen3-tts'),
    plist: join(home, 'Library/LaunchAgents', `${label}.plist`) };
}
export function validateConfig(config, { service = false, allowPrevious = false } = {}) {
  if (!config || config.version !== 1 || config.port !== 8877 || !/^[a-f0-9]{64}$/.test(config.token || '') || (!allowPrevious && Object.entries(identity).some(([key, value]) => config[key] !== value)) || (service && !isAbsolute(config.modelPath || ''))) throw Error('Qwen 설정 버전 또는 필드가 올바르지 않습니다. 안내를 확인해 재설정해 주세요.');
  return config;
}
export async function privateJson(filename, { optional = false, service = false, allowPrevious = false } = {}) {
  let info;
  try { info = await lstat(filename); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384 || (process.platform !== 'win32' && (info.mode & 0o077))) throw Error('Qwen 설정은 권한 600의 일반 파일이어야 합니다.');
  return validateConfig(JSON.parse(await readFile(filename, 'utf8')), { service, allowPrevious });
}
export async function atomicPrivateJson(filename, value) {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  try { const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) throw Error('설정 대상은 일반 파일이어야 합니다.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, filename);
  await chmod(filename, 0o600);
}
export function command(file, argv, { timeout = 120000, cwd, capture = true } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(file, argv, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', reason, force;
    const stop = () => { child.kill('SIGTERM'); force ||= setTimeout(() => child.kill('SIGKILL'), 2000); };
    const timer = setTimeout(() => { reason = Error('명령 실행 시간이 초과됐습니다. 모델 다운로드는 setup을 다시 실행해 이어 받을 수 있습니다.'); stop(); }, timeout);
    const collect = (chunk, error) => {
      const text = chunk.toString();
      if (capture) { if (error) stderr += text; else stdout += text; }
      else (error ? process.stderr : process.stdout).write(text);
      if (stdout.length + stderr.length > 2 * 1024 * 1024) { reason = Error('명령 출력이 너무 큽니다.'); stop(); }
    };
    child.stdout.on('data', chunk => collect(chunk, false)); child.stderr.on('data', chunk => collect(chunk, true));
    child.on('error', error => { reason = error; });
    child.on('close', code => { clearTimeout(timer); clearTimeout(force); if (reason) reject(reason); else if (code !== 0) reject(Object.assign(Error(`도구 실행 실패: ${file} (exit ${code}). 터미널 로그를 확인하세요.`), { stdout, stderr, exitCode: code })); else resolveCommand(stdout.trim()); });
  });
}
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function servicePlist(paths) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(join(paths.venv, 'bin/python'))}</string><string>${xml(join(paths.root, 'tts/qwen_service.py'))}</string><string>--config</string><string>${xml(paths.service)}</string></array>
<key>WorkingDirectory</key><string>${xml(paths.root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string><key>HOME</key><string>${xml(homedir())}</string><key>HF_HUB_OFFLINE</key><string>1</string><key>TRANSFORMERS_OFFLINE</key><string>1</string><key>PYTHONUNBUFFERED</key><string>1</string><key>PYTHONDONTWRITEBYTECODE</key><string>1</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(join(paths.directory, 'service.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(paths.directory, 'service.stderr.log'))}</string>
</dict></plist>\n`;
}
export async function assertInstallPaths(paths) {
  if (await realpath(paths.root) !== paths.root) throw Error('실제 저장소 경로에서 실행해 주세요.');
  for (const file of [paths.venv, paths.directory, paths.plist]) {
    try { const info = await lstat(file); if (info.isSymbolicLink()) throw Error('TTS 설치 경로에 심볼릭 링크를 사용할 수 없습니다.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
export async function serviceHealth(config, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl('http://127.0.0.1:8877/health', { headers: { Authorization: `Bearer ${config.token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > 16384) throw Error('Qwen 도우미 응답을 확인하지 못했습니다.');
  if (!response.body) throw Error('Qwen 도우미 응답이 비어 있습니다.');
  const parts = []; let size = 0;
  for await (const part of response.body) { size += part.length; if (size > 16384) throw Error('Qwen 도우미 응답이 너무 큽니다.'); parts.push(part); }
  const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (Object.entries(identity).some(([key, expected]) => value[key] !== expected) || value.speakers?.ko !== 'Sohee' || value.speakers?.ja !== 'Ono_Anna' || !value.languages?.includes('ko') || !value.languages?.includes('ja')) throw Error('Qwen 도우미와 웹 버전이 다릅니다. setup-qwen-tts -- --refresh로 갱신하세요.');
  return value;
}
