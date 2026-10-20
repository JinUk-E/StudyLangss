import { randomBytes } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from 'node:net';
import { ttsPaths, privateJson, atomicPrivateJson, manifest, identity, command, servicePlist, assertInstallPaths, label } from '../lib/qwen-setup.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const exists = async file => { try { return await lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; } };
const sleep = ms => new Promise(done => setTimeout(done, ms));
export async function stopService({ run = command, uid = process.getuid?.(), wait = sleep, alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } } } = {}) {
  const target = `gui/${uid}/${label}`;
  let old;
  try { old = await run('/bin/launchctl', ['print', target]); }
  catch (error) { if (!/could not find service|service not found/i.test(`${error.stderr || ''} ${error.stdout || ''}`)) throw Error('TTS LaunchAgent 조회에 실패했습니다. 기존 등록 상태를 직접 확인하세요.'); return; }
  const pids = [...old.matchAll(/^\s*pid = (\d+)\s*$/gm)].map(match => Number(match[1]));
  await run('/bin/launchctl', ['bootout', target]);
  for (let count = 0; count < 40; count++) {
    if (!pids.some(alive)) return;
    await wait(250);
  }
  throw Error('기존 Python 프로세스가 종료되지 않았습니다. 설치를 중단했습니다. PID를 확인하세요.');
}
export async function setup(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--refresh') || args.length > 1) throw Error('사용법: npm run setup-qwen-tts [-- --refresh]');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Apple Silicon Mac에서 실행해 주세요. Windows/Intel Mac에는 MLX 모델을 설치하지 않습니다.');
  if (Number((await command('/usr/bin/sw_vers', ['-productVersion'])).split('.')[0]) < 14) throw Error('고정 MLX 버전은 macOS 14 이상이 필요합니다.');
  const paths = ttsPaths(root); await assertInstallPaths(paths);
  const refresh = args.includes('--refresh'), existing = await privateJson(paths.service, { optional: true, service: true, allowPrevious: refresh });
  if ((await exists(paths.plist) || existing) && !refresh) throw Error('설치 기록이 있습니다. check-qwen-tts로 확인하거나 --refresh로 정지 후 재설치하세요. 기존 토큰은 보존됩니다.');
  // No package modification is allowed until the registered Python process exits.
  if (refresh) {
    if (await exists(paths.plist)) {
      const installed = JSON.parse(await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', paths.plist]));
      const expected = [join(paths.venv, 'bin/python'), join(paths.root, 'tts/qwen_service.py'), '--config', paths.service];
      if (installed.Label !== label || JSON.stringify(installed.ProgramArguments) !== JSON.stringify(expected)) throw Error('기존 TTS LaunchAgent가 다른 설치를 가리킵니다. 해당 설치를 확인한 뒤 직접 정지하세요.');
    }
    await stopService();
  }
  // Also refuse a manually launched or foreign listener before touching its venv.
  const occupied = await new Promise((done, reject) => { const socket = connect({ host: '127.0.0.1', port: 8877 }); socket.once('connect', () => { socket.destroy(); done(true); }); socket.once('error', error => error.code === 'ECONNREFUSED' ? done(false) : reject(error)); socket.setTimeout(2000, () => { socket.destroy(); reject(Error('TTS 포트 상태를 확인하지 못했습니다.')); }); });
  if (occupied) throw Error('8877 포트가 사용 중입니다. 수동 Python/다른 서비스를 종료하고 다시 설치하세요.');
  const python = (await command('/usr/bin/which', ['python3.12'])).trim();
  const version = JSON.parse(await command(python, ['-c', 'import json,sys,platform;print(json.dumps([sys.version_info.major,sys.version_info.minor,platform.machine()]))']));
  if (version[0] !== 3 || version[1] !== 12 || version[2] !== 'arm64') throw Error('arm64 Python 3.12가 필요합니다. brew install python@3.12 후 다시 실행하세요.');
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  if (!await exists(paths.venv)) await command(python, ['-m', 'venv', paths.venv], { cwd: paths.root });
  const venvPython = join(paths.venv, 'bin/python');
  await command(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(paths.root, 'tts/requirements-macos.txt')], { capture: false, timeout: 30 * 60000 });
  await command(venvPython, ['-m', 'pip', 'check'], { capture: false });
  await writeFile(join(paths.directory, 'installed-packages.txt'), `${await command(venvPython, ['-m', 'pip', 'freeze'])}\n`, { mode: 0o600 });
  await mkdir(paths.cache, { recursive: true, mode: 0o700 });
  console.log('고정 revision 모델 다운로드 중입니다. 최초 다운로드는 수 GB가 필요합니다.');
  const download = 'import sys; from huggingface_hub import snapshot_download; print(snapshot_download(repo_id=sys.argv[1],revision=sys.argv[2],cache_dir=sys.argv[3]))';
  const modelPath = (await command(venvPython, ['-c', download, manifest.modelId, manifest.modelRevision, paths.cache], { timeout: 60 * 60000 })).split(/\r?\n/).at(-1);
  if (!modelPath || !modelPath.includes(manifest.modelRevision)) throw Error('모델의 고정 revision 다운로드 경로를 확인하지 못했습니다.');
  // No active Node configuration is written here. Only real synthesis can activate it.
  const config = { version: 1, ...identity, port: 8877, token: existing?.token || randomBytes(32).toString('hex'), modelPath };
  await atomicPrivateJson(paths.service, config);
  await mkdir(join(paths.plist, '..'), { recursive: true, mode: 0o700 });
  const plist = servicePlist(paths);
  if (await exists(paths.plist)) {
    const old = await readFile(paths.plist, 'utf8');
    if (!old.includes(`<string>${label}</string>`)) throw Error('같은 이름의 다른 LaunchAgent를 덮어쓰지 않습니다.');
  }
  await writeFile(paths.plist, plist, { mode: 0o600 });
  await command('/usr/bin/plutil', ['-lint', paths.plist]);
  await command('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, paths.plist]);
  console.log('도우미를 등록했습니다. 모델 로딩 완료 후 실제 두 언어를 확인하세요. 아직 웹 엔진은 변경하지 않았습니다.');
  console.log('npm run check-qwen-tts -- --activate');
  if (process.env.TTS_CONFIG_FILE) console.log(`Node 학습·채팅 LaunchAgent에도 같은 TTS_CONFIG_FILE 절대 경로를 설정해야 합니다: ${paths.active}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) setup().catch(error => { console.error(error.message); process.exitCode = 1; });
