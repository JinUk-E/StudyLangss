import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import webpush from 'web-push';
import { createCredentials } from '../lib/auth.mjs';

let directory, child, base, config;
const authorization = `Basic ${Buffer.from('pwa-test:pwa-tests-only-2026').toString('base64')}`;
const call = (path, options = {}, authenticated = true) => fetch(base + path, {
  ...options, headers: { ...(authenticated ? { Authorization: authorization } : {}), 'Content-Type': 'application/json', ...options.headers }
});
const proxyCall = (path, body) => new Promise((resolve, reject) => {
  const req = request(base + path, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', Host: 'starlightforge.duckdns.org', Origin: config.origin } }, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
  });
  req.on('error', reject); req.end(JSON.stringify(body));
});
async function start() {
  child = spawn(process.execPath, ['portfolio-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, AUTH_FILE: join(directory, 'auth.json'), AUTH_USERS_FILE: join(directory, 'accounts.sqlite'), PORTFOLIO_DATA_DIR: join(directory, 'portfolio'), PUSH_DATA_DIR: join(directory, 'push'), PUSH_CONFIG_FILE: join(directory, 'vapid.json'), PORTFOLIO_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('PWA HTTP startup timed out')), 10000);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`PWA HTTP exited ${code}`)); });
    child.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127.0.0.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
}
async function stop() {
  if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stella-pwa-http-'));
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials('pwa-test', 'pwa-tests-only-2026')), { mode: 0o600 });
  const keys = webpush.generateVAPIDKeys();
  config = { version: 1, origin: 'https://starlightforge.duckdns.org', subject: 'https://starlightforge.duckdns.org/app/', ...keys };
  await writeFile(join(directory, 'vapid.json'), JSON.stringify(config), { mode: 0o600 });
  await start();
});
after(async () => { await stop(); if (directory) { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); } });

test('PWA metadata and worker are public while settings, subscriptions, and public key require authentication', async () => {
  const manifestResponse = await call('/manifest.webmanifest', {}, false);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.id, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.start_url, '/app/'); assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const image = await call(icon.src, {}, false); assert.equal(image.status, 200);
    if (icon.type === 'image/png') assert.deepEqual(Buffer.from(await image.arrayBuffer()).subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  const worker = await call('/sw.js', {}, false); assert.equal(worker.status, 200);
  assert.equal(worker.headers.get('service-worker-allowed'), '/');
  assert.match(worker.headers.get('content-type'), /javascript/); assert.equal(worker.headers.get('cache-control'), 'no-cache');
  for (const route of ['/app/', '/app', '/api/portfolio/push/config', '/api/portfolio/push/devices']) assert.equal((await call(route, {}, false)).status, 401, route);
  assert.equal((await call('/app/')).status, 200);
  const info = await (await call('/api/portfolio/push/config')).json();
  assert.equal(info.configured, true); assert.equal(info.applicationServerKey, config.publicKey);
  assert.ok(!JSON.stringify(info).includes(config.privateKey));
  for (const path of ['/data/push/vapid.json', '/pwa/../vapid.json', '/pwa/index.html']) assert.equal((await call(path, {}, false)).status, 404);
  assert.equal((await call('/sw.js', { method: 'POST', body: '{}' }, false)).status, 405);
});

test('push writes reject foreign origins, malformed JSON, invalid endpoints, and oversized requests', async () => {
  const endpoint = '/api/portfolio/push/devices';
  assert.equal((await call(endpoint, { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(endpoint, { method: 'POST', body: '{}', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call(endpoint, { method: 'POST', body: '[' })).status, 400);
  assert.equal((await call(endpoint, { method: 'POST', body: JSON.stringify({ label: 'x'.repeat(17000) }) })).status, 413);
  assert.equal((await call(endpoint, { method: 'POST', body: JSON.stringify({ subscription: { endpoint: 'http://127.0.0.1:11434' }, label: 'unsafe' }) })).status, 400);
  assert.equal((await call('/api/portfolio/push/test', { method: 'POST', body: JSON.stringify({ id: '../anything' }) })).status, 400);
});

test('subscription registration uses proxy origin, hides capability URLs and keys, and persists through restart', async () => {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const subscription = { endpoint: 'https://web.push.apple.com/http-test-fixture-no-send', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  const response = await proxyCall('/api/portfolio/push/devices', { subscription, label: '나의 폰' });
  assert.equal(response.status, 201); const registered = await response.json();
  assert.ok(registered.device.id);
  const listed = await (await call('/api/portfolio/push/devices')).json();
  for (const secret of [subscription.endpoint, subscription.keys.auth, subscription.keys.p256dh, config.privateKey]) assert.ok(!JSON.stringify(listed).includes(secret));
  const matched = await (await call('/api/portfolio/push/match', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) })).json();
  assert.equal(matched.device.id, registered.device.id);
  const upsert = await (await call('/api/portfolio/push/devices', { method: 'POST', body: JSON.stringify({ subscription, label: '내 폰 수정' }) })).json();
  assert.equal(upsert.device.id, registered.device.id);
  await stop(); await start();
  const persisted = await (await call('/api/portfolio/push/devices')).json(); assert.equal(persisted.devices.length, 1); assert.equal(persisted.devices[0].label, '내 폰 수정');
  assert.equal((await call(`/api/portfolio/push/devices/${registered.device.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await call('/api/portfolio/push/devices')).json()).devices.length, 0);
});

test('missing or damaged push settings disable only push; existing home and private app remain available', async () => {
  await stop(); await writeFile(join(directory, 'vapid.json'), '{bad-json'); await start();
  assert.equal((await call('/', {}, false)).status, 200); assert.equal((await call('/app/')).status, 200);
  const info = await (await call('/api/portfolio/push/config')).json(); assert.equal(info.configured, false);
  assert.ok(!JSON.stringify(info).includes(config.privateKey));
  const shared = await readFile(new URL('../public/shared/shell.js', import.meta.url), 'utf8');
  assert.match(shared, /\/app\//); assert.match(shared, /\/pwa\/register\.js/);
});
