import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, appendFile, mkdir, rename, rm, lstat, stat, readdir, readlink, realpath, cp } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, sep } from 'node:path';

const REMOTE = 'https://github.com/JinUk-E/StudyLangss.git';
const BRANCH = 'starlightForge';
const ACTIVE = new Set(['checking', 'validating', 'stopping', 'backing-up', 'applying', 'starting']);
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const delay = ms => new Promise(done => setTimeout(done, ms));
const stamp = (options = {}) => new Date((options.now || Date.now)()).toISOString();
const digest = value => createHash('sha256').update(value).digest('hex');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const area = config => join(config.root, '.site-updater');
const safeMessage = error => /^[가-힣]/.test(error.message || '') ? error.message : '로컬 처리 오류가 발생했습니다. Mac의 worker 로그를 확인하세요.';

export async function runCommand(file, args, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, shell: false,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure, killer;
    const terminate = message => {
      if (failure) return;
      failure = Error(message);
      const kill = signal => { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch {} };
      kill('SIGTERM'); killer = setTimeout(() => kill('SIGKILL'), 1500);
    };
    const timer = setTimeout(() => terminate('명령 실행 제한 시간을 초과했습니다.'), options.timeout || 120000);
    for (const [stream, append] of [[child.stdout, text => stdout += text], [child.stderr, text => stderr += text]]) {
      stream.on('data', bytes => { append(bytes.toString()); if (stdout.length + stderr.length > 2 * 1024 * 1024) terminate('명령 출력 한도를 초과했습니다.'); });
    }
    child.once('error', error => { clearTimeout(timer); clearTimeout(killer); fail(error); });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(killer);
      if (failure) { failure.stdout = stdout.slice(-12000); failure.stderr = stderr.slice(-12000); return fail(failure); }
      if (code !== 0 && !options.allowFailure) {
        const error = Error(`명령 실행 실패 (${code}): ${file.split(/[\\/]/).pop()}`);
        // Keep command output for private Mac diagnostics, never for HTTP status.
        error.exitCode = code; error.stdout = stdout.slice(-12000); error.stderr = stderr.slice(-12000);
        return fail(error);
      }
      done({ stdout, stderr, code });
    });
  });
}

function environment(config, directory) {
  const env = { PATH: `${dirname(config.nodePath)}:/opt/homebrew/bin:/usr/bin:/bin`,
    HOME: join(directory, 'home'), TMPDIR: directory, LANG: 'en_US.UTF-8',
    CI: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', npm_config_userconfig: join(directory, 'empty.npmrc'),
    npm_config_cache: join(directory, 'npm-cache') };
  if (process.platform === 'win32') for (const key of ['SystemRoot', 'TEMP', 'TMP', 'ComSpec']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

function context(config, options = {}) {
  const command = options.command || runCommand;
  const env = environment(config, area(config));
  const invoke = async (file, args, extra = {}) => {
    try { return await command(file, args, { cwd: config.root, env, ...extra }); }
    catch (error) {
      if (file === config.nodePath && (args[0] === config.npmCli || args[0] === '--test')) {
        const step = args[0] === '--test' ? '새 버전 자동 테스트' : '의존성 설치(npm ci)';
        const code = Number.isInteger(error.exitCode) ? ` (종료 코드 ${error.exitCode})` : '';
        const reason = error.message === '명령 실행 제한 시간을 초과했습니다.' ? ' 실행 제한 시간 초과.' : error.message === '명령 출력 한도를 초과했습니다.' ? ' 명령 출력 한도 초과.' : '';
        error.message = `${step} 단계에서 실패했습니다${code}.${reason} 세부 결과는 Mac의 .site-updater/worker-errors.log에 기록됩니다.`;
      }
      throw error;
    }
  };
  const git = (args, extra = {}) => invoke(process.platform === 'darwin' ? '/usr/bin/git' : 'git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], extra);
  return { invoke, git };
}

function validateConfig(config) {
  let origin;
  try { origin = new URL(config.origin); } catch { throw Error('사이트 주소 설정이 올바르지 않습니다.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.origin !== config.origin) throw Error('사이트 주소 설정이 올바르지 않습니다.');
  if (config.version !== 1 || !isAbsolute(config.root) || config.branch !== BRANCH || config.remote !== REMOTE ||
      !isAbsolute(config.nodePath) || !isAbsolute(config.npmCli) || !/^[a-f0-9]{64}$/.test(config.token || '')) throw Error('업데이트 설정이 올바르지 않습니다.');
  const expected = { portfolio: ['org.starlightforge.portfolio', 'portfolio-server.mjs', 3212],
    chat: ['org.starlightforge.chat', 'chat-server.mjs', 3211], study: ['kr.haru.jlpt', 'server.mjs', 3210] };
  if (!Array.isArray(config.services) || config.services.length !== 3 || new Set(config.services.map(x => x.service)).size !== 3) throw Error('서비스 설정이 올바르지 않습니다.');
  for (const service of config.services) {
    const known = expected[service.service];
    if (!known || service.label !== known[0] || service.script !== known[1] || service.port !== known[2] ||
        !isAbsolute(service.plist) || !/^[a-f0-9]{64}$/.test(service.plistHash || '')) throw Error('기본 서비스 설정만 지원합니다.');
  }
}

async function verifyPlists(config) {
  for (const service of config.services) {
    if ((await lstat(service.plist)).isSymbolicLink() || digest(await readFile(service.plist)) !== service.plistHash) throw Error('서비스 설정이 설치 시점과 달라졌습니다. 다시 설정하세요.');
  }
}

export async function inspectCheckout(config, options = {}) {
  validateConfig(config);
  if (await realpath(config.root) !== resolve(config.root)) throw Error('실제 저장소 경로를 사용해야 합니다.');
  if (await realpath(area(config)) !== resolve(area(config))) throw Error('업데이트 디렉터리의 심볼릭 링크는 지원하지 않습니다.');
  await mkdir(join(area(config), 'home'), { recursive: true, mode: 0o700 });
  await writeFile(join(area(config), 'empty.npmrc'), '', { mode: 0o600 });
  const { git } = context(config, options);
  const output = async args => (await git(args)).stdout.trim();
  if (resolve(await output(['rev-parse', '--show-toplevel'])) !== resolve(config.root)) throw Error('저장소 루트가 일치하지 않습니다.');
  if (await output(['symbolic-ref', '--short', 'HEAD']) !== BRANCH) throw Error('업데이트 대상 브랜치가 아닙니다.');
  if (await output(['remote', 'get-url', 'origin']) !== REMOTE) throw Error('원격 저장소가 일치하지 않습니다.');
  if (await output(['status', '--porcelain', '--untracked-files=normal'])) throw Error('저장소에 로컬 변경이 있습니다. 먼저 보관하고 다시 확인하세요.');
  const sha = await output(['rev-parse', 'HEAD']);
  if (!SHA.test(sha)) throw Error('현재 버전을 확인할 수 없습니다.');
  return { sha, subject: (await output(['log', '-1', '--format=%s', sha])).slice(0, 240) };
}

async function fetchTarget(config, options = {}) {
  const { git } = context(config, options);
  await git(['fetch', '--no-tags', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`], { timeout: 120000 });
  const sha = (await git(['rev-parse', `refs/remotes/origin/${BRANCH}`])).stdout.trim();
  if (!SHA.test(sha)) throw Error('원격 버전을 확인할 수 없습니다.');
  const files = (await git(['ls-tree', '-r', '--name-only', sha])).stdout.split('\n');
  if (files.some(file => /^(data|node_modules|\.site-updater)(\/|$)/i.test(file))) throw Error('업데이트에 보호된 로컬 경로가 포함되어 있습니다.');
  const ancestry = await git(['merge-base', '--is-ancestor', 'HEAD', sha], { allowFailure: true });
  if (ancestry.code !== 0) throw Error('브랜치가 원격과 갈라져 자동 업데이트할 수 없습니다.');
  return { sha, subject: (await git(['log', '-1', '--format=%s', sha])).stdout.trim().slice(0, 240) };
}

export async function checkForUpdate(config, options = {}) {
  const current = await inspectCheckout(config, options);
  const target = await fetchTarget(config, options);
  if ((await inspectCheckout(config, options)).sha !== current.sha) throw Error('확인 중 현재 버전이 변경되었습니다.');
  return { version: 1, phase: current.sha === target.sha ? 'current' : 'ready',
    message: current.sha === target.sha ? '최신 버전입니다.' : '새 버전을 확인했습니다. 적용할 수 있습니다.',
    current, target, checkedAt: stamp(options), checkToken: randomBytes(16).toString('hex'), updatedAt: stamp(options) };
}

async function missing(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function inventory(path, relative = '', result = [], base = path) {
  const info = await lstat(path);
  let link;
  if (info.isSymbolicLink()) {
    link = await readlink(path);
    const lexical = resolve(dirname(path), link);
    const actual = await realpath(path);
    if (!relative || isAbsolute(link) || !lexical.startsWith(resolve(base) + sep) || !actual.startsWith(resolve(base) + sep) || !(await stat(actual)).isFile()) throw Error('백업 대상의 외부 또는 디렉터리 심볼릭 링크는 지원하지 않습니다.');
  }
  if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await inventory(join(path, name), relative ? `${relative}/${name}` : name, result, base);
  else if (info.isFile() || link) {
    const hasher = createHash('sha256'); for await (const bytes of createReadStream(path)) hasher.update(bytes);
    result.push({ path: relative, size: link ? (await stat(path)).size : info.size, sha: hasher.digest('hex'), ...(link ? { link } : {}) });
  }
  else throw Error('백업 대상에 일반 파일이 아닌 항목이 있습니다.');
  return result;
}

function portOpen(port) {
  return new Promise(done => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); done(value); };
    socket.setTimeout(500, () => finish(false)); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
  });
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function closed(config, options, timeout = 15000, pids = []) {
  const sleep = options.sleep || delay;
  for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
    const listening = (await Promise.all(config.services.map(service => (options.portOpen || portOpen)(service.port)))).some(Boolean);
    const running = (await Promise.all(pids.map(pid => (options.pidAlive || pidAlive)(pid)))).some(Boolean);
    if (!listening && !running) return;
    await sleep(250);
  }
  throw Error('앱 서버가 종료되지 않았습니다.');
}
async function health(service, config, sha) {
  const response = await fetch(`http://127.0.0.1:${service.port}/internal/update-health`, {
    headers: { 'X-Starlight-Update-Token': config.token }, redirect: 'error', signal: AbortSignal.timeout(2000) });
  if (!response.ok) return false;
  const data = await response.json();
  return data.service === service.service && data.startupSha === sha;
}
async function healthy(config, sha, options) {
  for (let elapsed = 0; elapsed < 45000; elapsed += 500) {
    const values = await Promise.all(config.services.map(service => (options.health || health)(service, config, sha).catch(() => false)));
    if (values.every(Boolean)) return;
    await (options.sleep || delay)(500);
  }
  throw Error('세 서버의 새 버전 시작을 확인하지 못했습니다.');
}

export async function performUpdate(config, request, saveStatus, options = {}) {
  validateConfig(config);
  const previous = await readJson(join(area(config), 'status.json'));
  if (!UUID.test(request.id || '') || request.action !== 'apply' || previous.phase !== 'ready' ||
      !/^[a-f0-9]{32}$/.test(request.checkToken || '') || request.checkToken !== previous.checkToken ||
      request.expectedHead !== previous.current?.sha || request.targetSha !== previous.target?.sha ||
      !SHA.test(request.expectedHead || '') || !SHA.test(request.targetSha || '') ||
      !Number.isFinite(Date.parse(previous.checkedAt)) || Math.abs((options.now || Date.now)() - Date.parse(previous.checkedAt)) > 600000) throw Error('업데이트 확인 결과가 만료되었거나 일치하지 않습니다.');
  const { git, invoke } = context(config, options);
  const stage = join(area(config), 'stage', request.id);
  const backup = join(area(config), 'backups', request.id);
  const oldModules = join(area(config), 'previous-modules', request.id);
  let stopping = false, staged = false, stoppedPids = [];
  const state = async (phase, message, extra = {}) => saveStatus({ version: 1, phase, message,
    current: previous.current, target: previous.target, jobId: request.id, updatedAt: stamp(options), ...extra });
  const assertHead = async () => { if ((await inspectCheckout(config, options)).sha !== request.expectedHead) throw Error('현재 버전이 바뀌어 적용을 중단했습니다.'); };
  const servicePids = async strict => {
    const pids = [];
    for (const service of config.services) {
      try {
        const result = await invoke('/bin/launchctl', ['print', `gui/${process.getuid?.() ?? 0}/${service.label}`], { timeout: 10000 });
        const pid = Number(result.stdout.match(/^\s*pid = ([1-9][0-9]*)\s*$/m)?.[1]);
        if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid || pids.includes(pid)) throw Error('서비스의 실행 프로세스를 확인하지 못했습니다.');
        pids.push(pid);
      } catch (error) { if (strict) throw error; }
    }
    return pids;
  };
  const bootout = async strict => {
    let failure;
    for (const service of config.services) {
      try { await invoke('/bin/launchctl', ['bootout', `gui/${process.getuid?.() ?? 0}/${service.label}`], { timeout: 20000 }); }
      catch (error) { failure ||= error; }
    }
    if (strict && failure) throw failure;
  };
  try {
    await state('validating', '별도 디렉터리에서 새 버전을 검증하고 있습니다.');
    await assertHead(); await verifyPlists(config);
    if ((await fetchTarget(config, options)).sha !== request.targetSha) throw Error('원격 버전이 변경되었습니다. 다시 확인하세요.');
    await assertHead();
    await mkdir(dirname(stage), { recursive: true, mode: 0o700 });
    await git(['worktree', 'add', '--detach', stage, request.targetSha]); staged = true;
    if ((await stat(stage)).dev !== (await stat(config.root)).dev) throw Error('검증 디렉터리는 같은 볼륨에 있어야 합니다.');
    await writeFile(join(area(config), 'empty.npmrc'), '', { mode: 0o600 });
    await state('validating', '새 버전의 의존성을 설치하고 있습니다 (npm ci).');
    await invoke(config.nodePath, [config.npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, timeout: 300000 });
    const tests = (await readdir(join(stage, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`);
    if (!tests.length) throw Error('검증할 테스트가 없습니다.');
    await state('validating', '새 버전 자동 테스트를 실행하고 있습니다 (node --test).');
    await invoke(config.nodePath, ['--test', ...tests], { cwd: stage, timeout: 300000 });
    if ((await git(['status', '--porcelain', '--untracked-files=normal'], { cwd: stage })).stdout.trim()) throw Error('검증 과정에서 새 소스가 변경되었습니다.');
    if (!(await lstat(join(stage, 'node_modules'))).isDirectory() || (await lstat(join(stage, 'node_modules'))).isSymbolicLink()) throw Error('검증된 의존성을 확인하지 못했습니다.');
    await assertHead(); await verifyPlists(config);
    await inventory(join(config.root, 'data'));
    await healthy(config, request.expectedHead, options);
    stoppedPids = await servicePids(true);
    const modules = await missing(join(config.root, 'node_modules'));
    if (modules && (!modules.isDirectory() || modules.isSymbolicLink())) throw Error('기존 의존성 디렉터리를 확인하세요.');
    await state('stopping', '검증이 완료되었습니다. 세 앱 서버를 잠시 정지합니다.'); stopping = true;
    await bootout(true); await closed(config, options, 15000, stoppedPids);
    await assertHead(); await verifyPlists(config);
    await state('backing-up', '종료된 서버의 데이터를 백업하고 사본을 검증합니다.', { backupId: request.id });
    await mkdir(backup, { recursive: true, mode: 0o700 });
    const data = join(config.root, 'data');
    const before = await inventory(data);
    await cp(data, join(backup, 'data'), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, dereference: false, verbatimSymlinks: true });
    if (JSON.stringify(before) !== JSON.stringify(await inventory(join(backup, 'data')))) throw Error('데이터 백업 검증에 실패했습니다.');
    await writeFile(join(backup, 'manifest.json'), JSON.stringify({ version: 1, sha: request.expectedHead, files: before }), { mode: 0o600 });
    await state('applying', '백업을 보존하고 확인한 버전과 의존성을 적용합니다.', { backupId: request.id });
    await assertHead();
    await git(['merge', '--ff-only', '--no-edit', request.targetSha]);
    if ((await git(['rev-parse', 'HEAD'])).stdout.trim() !== request.targetSha) throw Error('적용 버전이 일치하지 않습니다.');
    await mkdir(dirname(oldModules), { recursive: true, mode: 0o700 });
    if (modules) await rename(join(config.root, 'node_modules'), oldModules);
    await rename(join(stage, 'node_modules'), join(config.root, 'node_modules'));
    await state('starting', '세 서버를 시작하고 실제 실행 버전을 확인합니다.', { backupId: request.id });
    for (const service of config.services) await invoke('/bin/launchctl', ['bootstrap', `gui/${process.getuid?.() ?? 0}`, service.plist], { timeout: 20000 });
    await healthy(config, request.targetSha, options);
    return await state('succeeded', '새 버전을 적용했습니다. 세 서버가 정상적으로 실행 중입니다.', { backupId: request.id, current: previous.target });
  } catch (error) {
    if (stopping) {
      const remainingPids = [...new Set([...stoppedPids, ...await servicePids(false)])];
      await bootout(false); try { await closed(config, options, 3000, remainingPids); } catch {}
    }
    const output = [typeof error.stdout === 'string' ? `stdout:\n${error.stdout.slice(-12000)}` : '', typeof error.stderr === 'string' ? `stderr:\n${error.stderr.slice(-12000)}` : ''].filter(Boolean).join('\n');
    await appendFile(join(area(config), 'worker-errors.log'), `${stamp(options)} ${request.id} ${error.stack || error.message}\n${output}\n`, { mode: 0o600 }).catch(() => {});
    await state(stopping ? 'manual' : 'failed', stopping ? '적용 도중 중단되어 서버 종료를 요청했습니다. Mac에서 종료 상태와 백업 검증 여부를 확인하고 복구하세요.' : `적용 전 검증에 실패했습니다. 기존 서비스는 유지됩니다. ${safeMessage(error)}`, stopping ? { backupId: await missing(backup) ? request.id : undefined } : {});
    return { phase: stopping ? 'manual' : 'failed' };
  } finally {
    if (staged && resolve(stage).startsWith(resolve(join(area(config), 'stage')) + sep)) {
      try { await git(['worktree', 'remove', '--force', stage]); } catch {}
    }
  }
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, file);
}

export async function runWorker(directory, options = {}) {
  const config = await readJson(join(directory, 'config.json'));
  validateConfig(config);
  if (resolve(directory) !== resolve(area(config))) throw Error('업데이트 디렉터리가 일치하지 않습니다.');
  const lock = join(directory, 'worker.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const reaper = join(directory, 'worker-recovery.lock');
    try { await mkdir(reaper, { mode: 0o700 }); } catch { throw Error('worker 잠금 복구가 진행 중이거나 직접 확인이 필요합니다.'); }
    try {
      let pid;
      try { pid = Number(await readFile(join(lock, 'pid'), 'utf8')); } catch {}
      if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('worker 잠금을 직접 확인해야 합니다.');
      try { process.kill(pid, 0); throw Error('업데이트 worker가 이미 실행 중입니다.'); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      await rm(lock, { recursive: true }); await mkdir(lock, { mode: 0o700 });
    } finally { await rm(reaper, { recursive: true }); }
  }
  await writeFile(join(lock, 'pid'), String(process.pid), { mode: 0o600 });
  const pending = join(directory, 'pending');
  const saveStatus = value => atomicJson(join(directory, 'status.json'), value);
  const heartbeat = () => atomicJson(join(directory, 'heartbeat.json'), { at: stamp(options), pid: process.pid });
  let ticker;
  try {
    const initial = await readJson(join(directory, 'status.json')).catch(() => ({ phase: 'idle' }));
    if (await missing(pending) || ACTIVE.has(initial.phase)) {
      await saveStatus({ ...initial, version: 1, phase: 'manual', message: '이전 작업이 중단되었습니다. 자동으로 다시 실행하지 않습니다. Mac에서 상태를 확인하세요.', updatedAt: stamp(options) });
      if (await missing(pending)) await rm(pending, { recursive: true });
    }
    await heartbeat();
    let writing = false;
    ticker = setInterval(async () => { if (writing) return; writing = true; try { await heartbeat(); } catch {} finally { writing = false; } }, 2000);
    while (!options.signal?.aborted) {
      if (await missing(join(pending, 'request.json'))) {
        let request;
        try {
          request = await readJson(join(pending, 'request.json'));
          if (!UUID.test(request.id || '') || !['check', 'apply'].includes(request.action) || !Number.isFinite(Date.parse(request.requestedAt)) || Math.abs((options.now || Date.now)() - Date.parse(request.requestedAt)) > 600000) throw Error('작업 요청이 올바르지 않거나 만료되었습니다.');
          const status = await readJson(join(directory, 'status.json')).catch(() => ({ phase: 'idle' }));
          if (status.phase === 'manual') throw Error('Mac에서 이전 작업을 확인한 뒤 worker를 다시 설정하세요.');
          if (request.action === 'check') {
            await saveStatus({ version: 1, phase: 'checking', message: '원격 버전을 확인하고 있습니다.', jobId: request.id, updatedAt: stamp(options) });
            await saveStatus({ ...await checkForUpdate(config, options), jobId: request.id });
          } else await performUpdate(config, request, saveStatus, options);
        } catch (error) {
          const current = await readJson(join(directory, 'status.json')).catch(() => ({}));
          await appendFile(join(directory, 'worker-errors.log'), `${stamp(options)} ${request?.id || 'unknown'} ${error.stack || error.message}\n`, { mode: 0o600 }).catch(() => {});
          await saveStatus({ ...current, version: 1, phase: current.phase === 'manual' ? 'manual' : 'failed', message: safeMessage(error), jobId: request?.id, updatedAt: stamp(options) });
        } finally { await rm(pending, { recursive: true, force: true }); }
      }
      await (options.sleep || delay)(2000);
    }
  } finally { clearInterval(ticker); await rm(lock, { recursive: true, force: true }); }
}
