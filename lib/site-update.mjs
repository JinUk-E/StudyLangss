import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, rm, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert } from './validation.mjs';

const phases = new Set(['idle', 'checking', 'ready', 'current', 'validating', 'stopping', 'backing-up', 'applying', 'starting', 'succeeded', 'failed', 'manual']);
const busy = new Set(['checking', 'validating', 'stopping', 'backing-up', 'applying', 'starting']);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const nonce = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const recent = (stamp, age, now = Date.now()) => Number.isFinite(Date.parse(stamp)) && now - Date.parse(stamp) >= -5000 && now - Date.parse(stamp) < age;
async function readJson(path, max = 32768) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > max) throw new Error('Invalid update file');
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function readUpdateConfig(root, directory = resolve(root, '.site-updater')) {
  try {
    const config = await readJson(resolve(directory, 'config.json'));
    if (config.version !== 1 || resolve(config.root) !== resolve(root) || config.branch !== 'starlightForge' || config.remote !== 'https://github.com/JinUk-E/StudyLangss.git' || !/^[a-f0-9]{64}$/.test(config.token)) return null;
    const origin = new URL(config.origin);
    if (origin.protocol !== 'https:' || origin.origin !== config.origin || origin.username || origin.password) return null;
    return config;
  } catch { return null; }
}
function revision(value) {
  return value && sha(value.sha) ? { sha: value.sha, subject: typeof value.subject === 'string' ? value.subject.slice(0, 240) : '' } : undefined;
}
/** Only a file queue crosses the HTTP/deployment boundary. No command is supplied by HTTP. */
export function createSiteUpdater(root, { directory = process.env.SITE_UPDATE_DIR || resolve(root, '.site-updater'), now = Date.now } = {}) {
  const pending = resolve(directory, 'pending');
  async function status() {
    const config = await readUpdateConfig(root, directory);
    if (!config) return { configured: false, available: false, phase: 'disabled', message: 'Mac 연결 설정이 필요합니다.' };
    let value = {}, heartbeat = {}, queued = false;
    try { value = await readJson(resolve(directory, 'status.json')); } catch { /* first launch */ }
    try { heartbeat = await readJson(resolve(directory, 'heartbeat.json')); } catch { /* offline */ }
    try { await lstat(pending); queued = true; } catch { /* no request */ }
    const phase = phases.has(value.phase) ? value.phase : 'idle';
    const online = recent(heartbeat.at, 15000, now());
    const result = {
      configured: true, available: online && !queued && !busy.has(phase) && phase !== 'manual', phase,
      message: !online ? 'Mac 업데이트 도우미에 연결할 수 없습니다. Mac에서 상태를 확인해 주세요.' : typeof value.message === 'string' ? value.message.slice(0, 600) : '새 버전을 확인해 주세요.'
    };
    for (const key of ['updatedAt', 'checkedAt']) if (Number.isFinite(Date.parse(value[key]))) result[key] = value[key];
    for (const key of ['jobId', 'backupId']) if (typeof value[key] === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value[key])) result[key] = value[key];
    for (const key of ['current', 'target']) { const item = revision(value[key]); if (item) result[key] = item; }
    if (phase === 'ready' && nonce(value.checkToken) && recent(value.checkedAt, 600000, now())) result.checkToken = value.checkToken;
    return result;
  }
  async function enqueue(req, action, input) {
    const config = await readUpdateConfig(root, directory);
    assert(config, 'Mac 연결 설정을 먼저 완료해 주세요.', 503);
    assert(req.headers.origin === config.origin && req.headers.host === new URL(config.origin).host && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin'), '설정된 사이트에서 업데이트를 요청해 주세요.', 403);
    assert(input && typeof input === 'object' && !Array.isArray(input), '업데이트 요청을 확인해 주세요.');
    assert(['check', 'apply'].includes(action), '올바른 업데이트 작업이 아닙니다.');
    const keys = action === 'check' ? [] : ['expectedHead', 'targetSha', 'checkToken'];
    assert(Object.keys(input).every(key => keys.includes(key)) && Object.keys(input).length === keys.length, '업데이트 요청의 항목을 확인해 주세요.');
    if (action === 'apply') assert(sha(input.expectedHead) && sha(input.targetSha) && nonce(input.checkToken), '확인한 버전을 다시 선택해 주세요.');
    const state = await status();
    assert(state.available, '다른 작업이 진행 중이거나 Mac 확인이 필요합니다.', 409);
    if (action === 'apply') assert(state.phase === 'ready' && state.checkToken === input.checkToken && state.current?.sha === input.expectedHead && state.target?.sha === input.targetSha, '버전 확인 결과가 바뀌었거나 만료되었습니다. 새 버전을 다시 확인해 주세요.', 409);
    try { await mkdir(pending, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') assert(false, '이미 접수한 작업이 있습니다.', 409); throw error; }
    const id = randomUUID();
    try {
      const temporary = resolve(pending, 'request.tmp');
      await writeFile(temporary, JSON.stringify({ version: 1, id, action, requestedAt: new Date(now()).toISOString(), ...input }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, resolve(pending, 'request.json'));
    } catch (error) { await rm(pending, { recursive: true, force: true }); throw error; }
    return { jobId: id };
  }
  return { status, enqueue };
}
