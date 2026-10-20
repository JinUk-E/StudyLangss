import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, lstat, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultDataPaths, validateRuntimeLayout, assertSafeDataTree } from '../lib/update-layout.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const services = [
  { service: 'portfolio', label: 'org.starlightforge.portfolio', script: 'portfolio-server.mjs', port: 3212, hostKey: 'PORTFOLIO_HOST', portKey: 'PORTFOLIO_PORT' },
  { service: 'chat', label: 'org.starlightforge.chat', script: 'chat-server.mjs', port: 3211, hostKey: 'CHAT_HOST', portKey: 'CHAT_PORT' },
  { service: 'study', label: 'kr.haru.jlpt', script: 'server.mjs', port: 3210, hostKey: 'HOST', portKey: 'PORT' }
];
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function workerPlist(config) {
  const directory = resolve(config.root, '.site-updater');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>org.starlightforge.updater</string>
<key>ProgramArguments</key><array><string>${xml(config.nodePath)}</string><string>${xml(join(directory, 'runtime/scripts/update-worker.mjs'))}</string><string>${xml(directory)}</string></array>
<key>WorkingDirectory</key><string>${xml(directory)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(dirname(config.nodePath))}:/opt/homebrew/bin:/usr/bin:/bin</string><key>HOME</key><string>${xml(homedir())}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(join(directory, 'worker.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory, 'worker.stderr.log'))}</string>
</dict></plist>\n`;
}
export async function validateServicePlist(value, service, appRoot, nodePath) {
  if (value.Label !== service.label || value.Program || !Array.isArray(value.ProgramArguments) || value.ProgramArguments.length !== 2 || resolve(value.WorkingDirectory || '') !== appRoot || value.KeepAlive !== true || value.RunAtLoad !== true || value.Disabled || value.RootDirectory || value.UserName || value.GroupName) throw new Error(`${service.label}: 기본 LaunchAgent 예제 형식을 사용해 주세요.`);
  if (await realpath(value.ProgramArguments[0]) !== nodePath || resolve(value.ProgramArguments[1]) !== resolve(appRoot, service.script)) throw new Error(`${service.label}: Node/서버 절대 경로가 현재 설치와 다릅니다.`);
  const env = value.EnvironmentVariables || {};
  validateRuntimeLayout(appRoot, env);
  if ((env[service.hostKey] || '127.0.0.1') !== '127.0.0.1' || Number(env[service.portKey] || service.port) !== service.port) throw new Error(`${service.label}: 기본 루프백 주소와 포트가 필요합니다.`);
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'SITE_UPDATE_DIR']) if (env[key]) throw new Error(`${service.label}: ${key} 환경변수 설치는 지원하지 않습니다.`);
}
async function setup() {
  if (process.platform !== 'darwin') throw new Error('이 설정은 사이트를 운영하는 Mac의 터미널에서 실행해 주세요.');
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--origin') throw new Error('사용법: npm run setup-updater -- --origin https://starlightforge.duckdns.org');
  const origin = new URL(args[1]);
  if (origin.protocol !== 'https:' || origin.origin !== args[1] || origin.username || origin.password) throw new Error('경로 없이 HTTPS 사이트 주소를 입력해 주세요.');
  const appRoot = await realpath(root), directory = join(appRoot, '.site-updater');
  const command = (file, argv, cwd = appRoot) => execFileSync(file, argv, { cwd, timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try { await lstat(directory); throw new Error('이미 업데이트 설정이 있습니다. 중복 설치하지 않습니다. npm run update-status로 확인해 주세요.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const git = argv => command('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...argv]);
  if (git(['branch', '--show-current']) !== 'starlightForge' || git(['remote', 'get-url', 'origin']) !== 'https://github.com/JinUk-E/StudyLangss.git' || git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('원격 origin/starlightForge 브랜치의 변경 없는 설치에서 실행해 주세요.');
  if (git(['check-ignore', '.site-updater/probe']) !== '.site-updater/probe') throw new Error('.site-updater 경로의 Git 제외 설정이 필요합니다.');
  validateRuntimeLayout(appRoot, process.env);
  await assertSafeDataTree(join(appRoot, 'data'));
  await lstat(join(appRoot, 'data/auth.json')); // auth must already be configured
  const nodePath = await realpath(process.execPath);
  const npmCli = await realpath(command('/usr/bin/which', ['npm']));
  if (basename(npmCli) !== 'npm-cli.js') throw new Error('Node.js 공식 npm-cli.js 경로를 찾을 수 없습니다.');
  // launchd GUI environment may otherwise override absent plist values.
  for (const key of [...Object.keys(defaultDataPaths(appRoot)), 'NODE_OPTIONS', 'NODE_PATH', 'SITE_UPDATE_DIR']) {
    let value = ''; try { value = command('/bin/launchctl', ['getenv', key]); } catch { /* unset */ }
    if (value) validateRuntimeLayout(appRoot, { [key]: value });
    if (value && ['NODE_OPTIONS', 'NODE_PATH', 'SITE_UPDATE_DIR'].includes(key)) throw new Error(`launchd ${key} 환경변수 설치는 지원하지 않습니다.`);
  }
  const targets = [];
  for (const service of services) {
    const plist = join(homedir(), 'Library/LaunchAgents', `${service.label}.plist`);
    const fileInfo = await lstat(plist); if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error(`${service.label}: 일반 plist 파일이 필요합니다.`);
    const value = JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]));
    await validateServicePlist(value, service, appRoot, nodePath);
    command('/bin/launchctl', ['print', `gui/${process.getuid()}/${service.label}`]);
    targets.push({ service: service.service, label: service.label, script: service.script, port: service.port, plist, plistHash: createHash('sha256').update(await readFile(plist)).digest('hex') });
  }
  const updaterPlist = join(homedir(), 'Library/LaunchAgents/org.starlightforge.updater.plist');
  try { await lstat(updaterPlist); throw new Error('기존 updater LaunchAgent가 있습니다. 설치를 중단합니다.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = { version: 1, root: appRoot, branch: 'starlightForge', remote: 'https://github.com/JinUk-E/StudyLangss.git', origin: origin.origin, nodePath, npmCli, token: randomBytes(32).toString('hex'), services: targets };
  await mkdir(join(directory, 'runtime/lib'), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, 'runtime/scripts'), { mode: 0o700 });
  await mkdir(join(directory, 'service-plists'), { mode: 0o700 });
  await writeFile(join(directory, 'config.json'), JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'status.json'), JSON.stringify({ version: 1, phase: 'idle', message: '새 버전을 확인해 주세요.', updatedAt: new Date().toISOString() }), { mode: 0o600 });
  await copyFile(join(appRoot, 'lib/update-worker.mjs'), join(directory, 'runtime/lib/update-worker.mjs'));
  await copyFile(join(appRoot, 'scripts/update-worker.mjs'), join(directory, 'runtime/scripts/update-worker.mjs'));
  for (const service of targets) await copyFile(service.plist, join(directory, 'service-plists', `${service.label}.plist`));
  await writeFile(updaterPlist, workerPlist(config), { flag: 'wx', mode: 0o600 });
  try { command('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, updaterPlist]); }
  catch { throw new Error('작업자 등록에 실패했습니다. .site-updater/worker.stderr.log와 npm run update-status를 확인해 주세요. 설정은 보존했습니다.'); }
  console.log('업데이트 도우미를 등록했습니다. 이제 아래 세 명령으로 앱 서버를 한 번 재시작해 주세요.');
  for (const service of targets) console.log(`launchctl kickstart -k "gui/$(id -u)/${service.label}"`);
  console.log('이후 관리자 계정으로 홈 → 사이트 업데이트에서 새 버전 확인 → 확인한 버전으로 업데이트를 누르세요.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setup().catch(error => { console.error(error.message); process.exitCode = 1; });
}
