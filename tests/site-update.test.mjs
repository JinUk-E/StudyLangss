import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSiteUpdater, readUpdateConfig } from '../lib/site-update.mjs';
import { validateRuntimeLayout, assertSafeDataTree } from '../lib/update-layout.mjs';
import { workerPlist, validateServicePlist, services } from '../scripts/setup-updater.mjs';

const current = { sha: 'a'.repeat(40), subject: '현재' }, target = { sha: 'b'.repeat(40), subject: '다음' };
const origin = 'https://starlightforge.duckdns.org';
const req = { headers: { origin, host: 'starlightforge.duckdns.org', 'sec-fetch-site': 'same-origin' } };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'starlight-update-bridge-')), directory = join(root, '.site-updater');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(directory);
  const config = { version: 1, root, origin, branch: 'starlightForge', remote: 'https://github.com/JinUk-E/StudyLangss.git', token: 'c'.repeat(64) };
  const state = { version: 1, phase: 'ready', message: '확인 완료', current, target, checkToken: 'd'.repeat(32), checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), privatePath: '/secret/file', token: config.token };
  await writeFile(join(directory, 'config.json'), JSON.stringify(config));
  await writeFile(join(directory, 'status.json'), JSON.stringify(state));
  await writeFile(join(directory, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString() }));
  return { root, directory, config, state, bridge: createSiteUpdater(root, { directory }) };
}

test('updater is disabled until local opt-in and exposes only public state fields', async t => {
  const f = await fixture(t);
  const result = await f.bridge.status();
  assert.equal(result.available, true); assert.equal(result.checkToken, f.state.checkToken);
  assert.ok(!JSON.stringify(result).includes('/secret')); assert.ok(!JSON.stringify(result).includes(f.config.token));
  await rm(join(f.directory, 'config.json'));
  assert.deepEqual(await f.bridge.status(), { configured: false, available: false, phase: 'disabled', message: 'Mac 연결 설정이 필요합니다.' });
  await assert.rejects(f.bridge.enqueue(req, 'check', {}), error => error.status === 503);
});
test('update POST requires configured origin and host and refuses arbitrary fields', async t => {
  const { bridge } = await fixture(t);
  for (const headers of [{ host: req.headers.host }, { ...req.headers, origin: 'https://evil.example' }, { ...req.headers, host: 'evil.example' }, { ...req.headers, 'sec-fetch-site': 'same-site' }]) await assert.rejects(bridge.enqueue({ headers }, 'check', {}), error => error.status === 403);
  for (const payload of [{ command: 'rm -rf' }, { branch: 'main' }, { path: '/etc' }]) await assert.rejects(bridge.enqueue(req, 'check', payload), error => error.status === 400);
});
test('one atomic queue wins concurrent requests and pending state disables more jobs', async t => {
  const { bridge, directory } = await fixture(t);
  const results = await Promise.allSettled([bridge.enqueue(req, 'check', {}), bridge.enqueue(req, 'check', {})]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  const queued = JSON.parse(await readFile(join(directory, 'pending/request.json'), 'utf8'));
  assert.equal(queued.action, 'check'); assert.match(queued.id, /^[a-f0-9-]{36}$/);
  assert.equal((await bridge.status()).available, false);
});
test('apply binds exact head, target and expiring check token', async t => {
  const f = await fixture(t), input = { expectedHead: current.sha, targetSha: target.sha, checkToken: f.state.checkToken };
  for (const change of [{ expectedHead: 'e'.repeat(40) }, { targetSha: 'e'.repeat(40) }, { checkToken: 'e'.repeat(32) }]) await assert.rejects(f.bridge.enqueue(req, 'apply', { ...input, ...change }), error => error.status === 409);
  const stale = createSiteUpdater(f.root, { directory: f.directory, now: () => Date.now() + 601000 });
  await writeFile(join(f.directory, 'heartbeat.json'), JSON.stringify({ at: new Date(Date.now() + 601000).toISOString() }));
  await assert.rejects(stale.enqueue(req, 'apply', input), error => error.status === 409);
  await writeFile(join(f.directory, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString() }));
  await f.bridge.enqueue(req, 'apply', input);
  assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'pending/request.json'), 'utf8')).targetSha, target.sha);
});
test('offline worker and interrupted jobs never allow enqueue', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'heartbeat.json'), JSON.stringify({ at: new Date(Date.now() - 20000).toISOString() }));
  assert.equal((await f.bridge.status()).available, false);
  await assert.rejects(f.bridge.enqueue(req, 'check', {}), error => error.status === 409);
  await writeFile(join(f.directory, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString() }));
  await writeFile(join(f.directory, 'status.json'), JSON.stringify({ phase: 'manual' }));
  assert.equal((await f.bridge.status()).available, false);
});
test('configuration fails closed for wrong repo, non-HTTPS origin and malformed secrets', async t => {
  const f = await fixture(t);
  for (const change of [{ root: tmpdir() }, { origin: 'http://example.test' }, { origin: origin + '/' }, { token: '' }, { branch: 'main' }, { remote: 'https://evil.test/repo.git' }]) {
    await writeFile(join(f.directory, 'config.json'), JSON.stringify({ ...f.config, ...change }));
    assert.equal(await readUpdateConfig(f.root, f.directory), null);
  }
});
test('setup limits data layout and rejects executable/extra argument plist variants', async t => {
  const f = await fixture(t);
  assert.doesNotThrow(() => validateRuntimeLayout(f.root, { DATA_DIR: join(f.root, 'data') }));
  assert.throws(() => validateRuntimeLayout(f.root, { AUTH_USERS_FILE: '/external/accounts.sqlite' }));
  await writeFile(join(f.root, 'normal'), 'ok'); await assertSafeDataTree(f.root);
  const service = services[0];
  const value = { Label: service.label, ProgramArguments: [process.execPath, join(f.root, service.script)], WorkingDirectory: f.root, KeepAlive: true, RunAtLoad: true };
  const nodePath = await import('node:fs/promises').then(fs => fs.realpath(process.execPath));
  await validateServicePlist(value, service, f.root, nodePath);
  for (const change of [{ Program: '/bin/sh' }, { ProgramArguments: [...value.ProgramArguments, '--inspect'] }, { EnvironmentVariables: { DATA_DIR: '/external' } }, { EnvironmentVariables: { PORTFOLIO_HOST: '0.0.0.0' } }]) await assert.rejects(validateServicePlist({ ...value, ...change }, service, f.root, nodePath));
  const xml = workerPlist({ root: join(f.root, 'A&B'), nodePath: process.execPath });
  assert.ok(xml.includes('A&amp;B')); assert.ok(!xml.includes('A&B')); assert.ok(xml.includes('org.starlightforge.updater'));
});
