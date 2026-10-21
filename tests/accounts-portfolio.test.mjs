import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { createCredentials } from '../lib/auth.mjs';

let directory, child, base, study, chat;
const password = 'accounts-test-only-2026';
const header = name => `Basic ${Buffer.from(`${name}:${password}`).toString('base64')}`;
const call = (path, options = {}, name = 'owner-test') => fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(name ? { Authorization: header(name) } : {}), ...options.headers } });
const json = async (path, options = {}, name) => { const response = await call(path, options, name); assert.ok(response.ok, `${path}: ${response.status}`); return response.json(); };
const mutate = (method, value) => ({ method, body: JSON.stringify(value) });
function subscription(name) { const ec = createECDH('prime256v1'); ec.generateKeys(); return { endpoint: `https://web.push.apple.com/accounts-fixture-${name}`, keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; }
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stella-accounts-http-'));
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials('owner-test', password)), { mode: 0o600 });
  await writeFile(join(directory, 'vapid.json'), JSON.stringify({ version: 1, origin: 'https://starlightforge.duckdns.org', subject: 'https://starlightforge.duckdns.org', ...webpush.generateVAPIDKeys() }), { mode: 0o600 });
  child = spawn(process.execPath, ['portfolio-server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, AUTH_FILE: join(directory, 'auth.json'), AUTH_USERS_FILE: join(directory, 'accounts.sqlite'), PORTFOLIO_DATA_DIR: join(directory, 'portfolio'), PUSH_DATA_DIR: join(directory, 'push'), PUSH_CONFIG_FILE: join(directory, 'vapid.json'), PORTFOLIO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('account portfolio startup timed out')), 10000);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`portfolio exit ${code}`)); });
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127.0.0.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  study = (await json('/api/portfolio/accounts', mutate('POST', { username: 'study-guest', password, permissions: ['study'] }))).account;
  chat = (await json('/api/portfolio/accounts', mutate('POST', { username: 'chat-guest', password, permissions: ['chat'] }))).account;
});
after(async () => {
  if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  if (directory) { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); }
});

test('account management is owner-only while session probes do not challenge public visitors', async () => {
  const anonymous = await call('/api/portfolio/session', {}, null);
  assert.equal(anonymous.status, 200); assert.equal(anonymous.headers.get('www-authenticate'), null); assert.deepEqual(await anonymous.json(), { user: null });
  for (const path of ['/accounts/', '/accounts/app.js', '/accounts/styles.css', '/api/portfolio/accounts']) {
    assert.equal((await call(path, {}, null)).status, 401, path);
    assert.equal((await call(path, {}, 'study-guest')).status, 403, path);
    assert.equal((await call(path)).status, 200, path);
  }
  assert.equal((await call('/api/portfolio/me', {}, null)).status, 401);
  const me = (await json('/api/portfolio/me', {}, 'study-guest')).user;
  assert.equal(me.id, study.id); assert.deepEqual(me.permissions, ['study']); assert.equal(me.isAdmin, false);
  assert.equal((await json('/api/portfolio/session', {}, 'chat-guest')).user.id, chat.id);
  assert.equal((await call('/api/portfolio/accounts', mutate('POST', { username: 'escalate', password, permissions: ['study'] }), 'study-guest')).status, 403);
  assert.equal((await call('/api/portfolio/accounts', { ...mutate('POST', { username: 'foreign', password, permissions: ['study'] }), headers: { Origin: 'https://evil.example' } })).status, 403);
  for (const input of [{ username: 'escalate', password, permissions: ['study'], isAdmin: true }, { username: 'weak', password: 'short', permissions: ['study'] }, { username: 'empty', password, permissions: [] }]) assert.equal((await call('/api/portfolio/accounts', mutate('POST', input))).status, 400);
  assert.equal((await call('/api/portfolio/accounts/owner', mutate('PATCH', { enabled: false }))).status, 403);
  const accounts = await json('/api/portfolio/accounts');
  for (const key of ['password', 'hash', 'salt', 'credentials']) assert.ok(!JSON.stringify(accounts).includes(`"${key}"`));
});

test('guest accounts cannot open private resume, unpublished images, or edit public content', async () => {
  for (const name of [null, 'study-guest', 'chat-guest']) {
    for (const path of ['/resume/', '/api/portfolio/resume', '/portfolio/']) assert.equal((await call(path, {}, name)).status, 200, path);
  }
  const { resume } = await json('/api/portfolio/resume');
  await json('/api/portfolio/resume', mutate('PUT', { ...resume, published: false }));
  for (const name of ['study-guest', 'chat-guest']) {
    for (const path of ['/admin/', '/site/admin.js', '/api/portfolio/manage', '/api/portfolio/career-template', '/api/portfolio/resume', '/resume/']) assert.equal((await call(path, {}, name)).status, 403, path);
    assert.equal((await call('/api/portfolio/profile', mutate('PUT', {}), name)).status, 403);
    assert.equal((await call('/app/', {}, name)).status, 200);
    assert.equal((await call('/', {}, name)).status, 200);
  }
  const image = await json('/api/portfolio/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64') });
  assert.equal((await call(image.path, {}, 'study-guest')).status, 403);
  assert.equal((await call(image.path, {}, null)).status, 401);
});

test('push devices and capability URL matching are scoped by the authenticated account, never by input IDs', async () => {
  const studySubscription = subscription('study'), chatSubscription = subscription('chat');
  const studyDevice = (await json('/api/portfolio/push/devices', mutate('POST', { subscription: studySubscription, label: '학습 폰', ownerId: 'owner' }), 'study-guest')).device;
  const chatDevice = (await json('/api/portfolio/push/devices', mutate('POST', { subscription: chatSubscription, label: '대화 폰' }), 'chat-guest')).device;
  const listStudy = await json(`/api/portfolio/push/devices?ownerId=${chat.id}`, {}, 'study-guest'); assert.deepEqual(listStudy.devices.map(value => value.id), [studyDevice.id]);
  const listOwner = await json('/api/portfolio/push/devices'); assert.equal(listOwner.devices.length, 0);
  assert.equal((await json('/api/portfolio/push/config', {}, 'study-guest')).user.id, study.id);
  assert.deepEqual(await json('/api/portfolio/push/match', mutate('POST', { endpoint: chatSubscription.endpoint }), 'study-guest'), { device: null });
  assert.equal((await call('/api/portfolio/push/devices', mutate('POST', { subscription: chatSubscription, label: '가로채기' }), 'study-guest')).status, 409);
  assert.deepEqual(await json(`/api/portfolio/push/devices/${chatDevice.id}`, { method: 'DELETE' }, 'study-guest'), { deleted: false });
  assert.equal((await call('/api/portfolio/push/test', mutate('POST', { id: chatDevice.id, ownerId: chat.id }), 'study-guest')).status, 404);
  assert.equal((await json('/api/portfolio/push/devices', {}, 'chat-guest')).devices.length, 1);
  assert.ok(!JSON.stringify(listStudy).includes(studySubscription.endpoint));
});

test('permission changes, suspension and password resets apply to cached HTTP credentials without a restart', async () => {
  assert.equal((await call('/api/portfolio/me', {}, 'chat-guest')).status, 200);
  await json(`/api/portfolio/accounts/${chat.id}`, mutate('PATCH', { enabled: false }));
  assert.equal((await call('/api/portfolio/me', {}, 'chat-guest')).status, 401);
  const publicProbe = await call('/api/portfolio/session', {}, 'chat-guest'); assert.equal(publicProbe.headers.get('www-authenticate'), null); assert.deepEqual(await publicProbe.json(), { user: null });
  const reset = 'replacement-password-only-2026';
  await json(`/api/portfolio/accounts/${chat.id}`, mutate('PATCH', { enabled: true, permissions: ['study', 'chat'], password: reset }));
  assert.equal((await call('/api/portfolio/me', {}, 'chat-guest')).status, 401);
  const response = await call('/api/portfolio/me', { headers: { Authorization: `Basic ${Buffer.from(`chat-guest:${reset}`).toString('base64')}` } });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).user.permissions, ['study', 'chat']);
});
