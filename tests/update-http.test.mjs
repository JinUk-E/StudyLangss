import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCredentials } from '../lib/auth.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let directory, child, port;
const password = 'test-update-password-2026';
const origin = 'https://starlightforge.duckdns.org';
function call(path, { user = 'owner-test', method = 'GET', data, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: { Host: 'starlightforge.duckdns.org', 'Content-Type': 'application/json', ...(user ? { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` } : {}), ...headers } }, response => {
      let text = ''; response.on('data', b => text += b); response.on('end', () => { let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ status: response.statusCode, value }); });
    });
    request.on('error', reject); request.end(data === undefined ? undefined : JSON.stringify(data));
  });
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'starlight-update-http-'));
  const control = join(directory, 'updater'); await mkdir(control);
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials('owner-test', password)));
  await writeFile(join(control, 'config.json'), JSON.stringify({ version: 1, root, origin, branch: 'starlightForge', remote: 'https://github.com/JinUk-E/StudyLangss.git', token: 'c'.repeat(64) }));
  await writeFile(join(control, 'status.json'), JSON.stringify({ phase: 'idle', updatedAt: new Date().toISOString() }));
  await writeFile(join(control, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString() }));
  child = spawn(process.execPath, ['portfolio-server.mjs'], { cwd: root, env: { ...process.env, AUTH_FILE: join(directory, 'auth.json'), AUTH_USERS_FILE: join(directory, 'accounts.sqlite'), PORTFOLIO_DATA_DIR: join(directory, 'portfolio'), PUSH_DATA_DIR: join(directory, 'push'), PUSH_CONFIG_FILE: join(directory, 'no-vapid.json'), SITE_UPDATE_DIR: control, PORTFOLIO_HOST: '127.0.0.1', PORTFOLIO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', b => errors += b);
  port = await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error(errors || 'server startup timeout')), 15000); child.once('exit', () => { clearTimeout(timeout); reject(Error(errors)); }); child.stdout.on('data', b => { const match = String(b).match(/127.0.0.1:(\d+)/); if (match) { clearTimeout(timeout); resolve(Number(match[1])); } }); });
  assert.equal((await call('/api/portfolio/accounts', { method: 'POST', data: { username: 'guest', password, permissions: ['study'] } })).status, 201);
});
after(async () => { if (child?.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } if (directory) await rm(directory, { recursive: true, force: true }); });
test('owner-only update page, assets, guide and API enforce authentication on the server', async () => {
  for (const path of ['/admin/system/', '/admin/system/app.js', '/admin/system/styles.css', '/admin/system/guide.html', '/api/portfolio/updates']) {
    assert.equal((await call(path, { user: null })).status, 401, path);
    assert.equal((await call(path, { user: 'guest' })).status, 403, path);
    assert.equal((await call(path)).status, 200, path);
  }
  assert.equal((await call('/internal/update-health')).status, 404);
});
test('owner cannot mutate via CSRF or missing Origin and guests cannot enqueue at all', async () => {
  for (const originHeader of [undefined, 'https://evil.example', 'null']) assert.equal((await call('/api/portfolio/updates/check', { method: 'POST', data: {}, headers: originHeader ? { Origin: originHeader } : {} })).status, 403);
  assert.equal((await call('/api/portfolio/updates/check', { user: 'guest', method: 'POST', data: {}, headers: { Origin: origin } })).status, 403);
  assert.equal((await call('/api/portfolio/updates/check', { method: 'POST', data: { command: 'deploy' }, headers: { Origin: origin } })).status, 400);
  assert.equal((await call('/api/portfolio/updates/check', { method: 'POST', data: {}, headers: { Origin: origin, 'Content-Type': 'text/plain' } })).status, 415);
});
test('accepted request is file-only, returns no secrets and cannot be duplicated', async () => {
  const response = await call('/api/portfolio/updates/check', { method: 'POST', data: {}, headers: { Origin: origin } });
  assert.equal(response.status, 202); assert.deepEqual(Object.keys(response.value), ['jobId']);
  const queued = JSON.parse(await readFile(join(directory, 'updater/pending/request.json'), 'utf8'));
  assert.equal(queued.id, response.value.jobId); assert.equal(queued.action, 'check'); assert.ok(!JSON.stringify(queued).includes(password));
  assert.equal((await call('/api/portfolio/updates/check', { method: 'POST', data: {}, headers: { Origin: origin } })).status, 409);
  assert.equal((await call('/api/portfolio/updates')).value.available, false);
});
