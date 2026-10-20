import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import webpush from 'web-push';
import { createPushService, validatePushConfig, validateSubscription } from '../lib/push-service.mjs';
import { createPushTransport, validateEndpoint, isPublicAddress, resolvePinnedEndpoint } from '../lib/push-transport.mjs';
import { setupPushConfig } from '../scripts/setup-push.mjs';

function subscription(number = 1, host = 'fcm.googleapis.com') {
  const curve = createECDH('prime256v1'); curve.generateKeys();
  return { endpoint: `https://${host}/fcm/send/device-${number}`, keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}
const config = () => ({ version: 1, origin: 'https://example.com', subject: 'mailto:owner@example.com', ...webpush.generateVAPIDKeys() });
async function fixture(t, { transport = async () => ({ statusCode: 201 }), configured = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'stella-push-'));
  const configFile = join(directory, 'vapid.json');
  const settings = config();
  if (configured) await writeFile(configFile, JSON.stringify(settings), { mode: 0o600 });
  const services = [];
  const open = async () => { const service = await createPushService({ directory, configFile, transport }); services.push(service); return service; };
  const service = await open();
  t.after(async () => { services.forEach(value => value.close()); await rm(directory, { recursive: true, force: true }); });
  return { service, directory, configFile, settings, open };
}

test('push config validates HTTPS, contact and matching EC keypair; only public VAPID is exposed', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.service.info(), { configured: true, applicationServerKey: f.settings.publicKey, origin: 'https://example.com' });
  for (const change of [{ origin: 'http://example.com' }, { origin: 'https://example.com/path' }, { origin: 'https://user@example.com' }, { subject: 'http://example.com' }, { privateKey: webpush.generateVAPIDKeys().privateKey }, { publicKey: randomBytes(65).toString('base64url') }]) {
    assert.throws(() => validatePushConfig({ ...f.settings, ...change }));
  }
  assert(!JSON.stringify(f.service.info()).includes(f.settings.privateKey));
});

test('missing or damaged push configuration disables only push, without leaking parse errors', async t => {
  const f = await fixture(t, { configured: false });
  assert.deepEqual(f.service.info(), { configured: false, reason: 'not_configured' });
  assert.deepEqual(f.service.list(), []);
  assert.throws(() => f.service.subscribe({ subscription: subscription() }), { status: 503 });
  await writeFile(f.configFile, '{private-secret', { mode: 0o600 });
  const broken = await f.open();
  assert.deepEqual(broken.info(), { configured: false, reason: 'invalid_config' });
});

test('setup preserves existing keys and keeps the config and directory private', async t => {
  const f = await fixture(t, { configured: false });
  await setupPushConfig({ filename: f.configFile, origin: 'https://example.com/', subject: 'mailto:owner@example.com' });
  const first = await readFile(f.configFile, 'utf8');
  assert.equal(JSON.parse(first).origin, 'https://example.com');
  await assert.rejects(setupPushConfig({ filename: f.configFile, origin: 'https://other.example', subject: 'mailto:owner@example.com' }), { code: 'EEXIST' });
  assert.equal(await readFile(f.configFile, 'utf8'), first);
  if (process.platform !== 'win32') {
    assert.equal((await stat(f.configFile)).mode & 0o777, 0o600);
    assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
    await chmod(f.configFile, 0o644);
    assert.equal((await f.open()).info().reason, 'invalid_config');
  }
});

test('subscription input rejects forged EC points, auth lengths, endpoint tricks and oversized labels', async t => {
  const { service } = await fixture(t);
  const good = subscription();
  assert.equal(validateSubscription(good).endpoint, good.endpoint);
  for (const keys of [{ ...good.keys, auth: randomBytes(15).toString('base64url') }, { ...good.keys, p256dh: Buffer.alloc(65, 4).toString('base64url') }, { ...good.keys, auth: `${good.keys.auth}=` }]) assert.throws(() => validateSubscription({ ...good, keys }));
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://fcm.googleapis.com:444/a', 'https://fcm.googleapis.com.evil.test/a', 'https://evilpush.apple.com/a', 'https://evil.push.apple.com.evil.test/a', 'https://127.0.0.1/a', 'https://user:password@fcm.googleapis.com/a', 'https://@fcm.googleapis.com/a', 'https://fcm.googleapis.com/a#', 'https://fcm.googleapis.com/a#secret', 'https://fcm.googleapis.com/']) assert.throws(() => validateEndpoint(endpoint));
  for (const endpoint of ['https://web.push.apple.com/Qabc', 'https://a-1.push.apple.com/Qabc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', good.endpoint]) assert.equal(validateEndpoint(endpoint), endpoint);
  assert.throws(() => service.subscribe({ subscription: good, label: 'x'.repeat(61) }));
  assert.throws(() => service.subscribe({ subscription: good, label: 'bad\nname' }));
});

test('devices have bounded capacity, endpoint uniqueness, private public views and persist across restarts', async t => {
  const f = await fixture(t);
  const firstSub = subscription();
  const first = f.service.subscribe({ subscription: firstSub, label: '휴대폰' }).device;
  const again = f.service.subscribe({ subscription: firstSub, label: '아이폰' }).device;
  assert.equal(again.id, first.id); assert.equal(again.label, '아이폰');
  assert.deepEqual(f.service.match(firstSub.endpoint), again);
  for (let i = 2; i <= 10; i++) f.service.subscribe({ subscription: subscription(i) });
  assert.throws(() => f.service.subscribe({ subscription: subscription(11) }), { status: 409 });
  const serialized = JSON.stringify(f.service.list());
  for (const secret of [firstSub.endpoint, firstSub.keys.auth, firstSub.keys.p256dh, f.settings.privateKey]) assert(!serialized.includes(secret));
  assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'id', 'label', 'lastAttemptAt', 'lastStatus']);
  f.service.close();
  const restarted = await f.open();
  assert.equal(restarted.list().length, 10);
  assert.equal(restarted.match(firstSub.endpoint).id, first.id);
  assert.equal(restarted.remove(first.id), true);
  assert.equal(restarted.remove(first.id), false);
  assert.equal(restarted.match(firstSub.endpoint), null);
});

test('durable per-device cooldown and conditional claims prevent concurrent duplicate requests', async t => {
  let called = 0, release;
  const f = await fixture(t, { transport: async () => { called++; await new Promise(resolve => { release = resolve; }); return { statusCode: 201 }; } });
  const device = f.service.subscribe({ subscription: subscription() }).device;
  const second = await f.open();
  const pending = f.service.test(device.id);
  const duplicate = await second.test(device.id);
  assert.equal(duplicate.status, 'rate_limited'); assert.equal(called, 1);
  release();
  assert.equal((await pending).status, 'accepted');
  f.service.close(); second.close();
  const restarted = await f.open();
  assert.equal((await restarted.test(device.id)).status, 'rate_limited');
  assert.equal(restarted.list()[0].lastStatus, 'accepted');
});

test('global in-flight claims cap transport concurrency at two across service instances', async t => {
  const releases = [];
  const f = await fixture(t, { transport: async () => { await new Promise(resolve => releases.push(resolve)); return { statusCode: 201 }; } });
  const ids = [1, 2, 3].map(i => f.service.subscribe({ subscription: subscription(i) }).device.id);
  const second = await f.open();
  const one = f.service.test(ids[0]), two = second.test(ids[1]);
  assert.equal((await f.service.test(ids[2])).status, 'rate_limited');
  assert.equal(releases.length, 2);
  releases.forEach(release => release());
  assert.equal((await one).status, 'accepted'); assert.equal((await two).status, 'accepted');
});

test('delivery distinguishes broker statuses and never retries or returns transport secrets', async t => {
  const outcomes = [404, 410, 429, 500, 302, 400, 'error']; let calls = 0;
  const f = await fixture(t, { transport: async () => {
    const next = outcomes[calls++];
    if (next === 'error') throw new Error('https://secret-endpoint.invalid/private-key');
    return { statusCode: next, body: 'secret-body' };
  } });
  const actual = [];
  for (let i = 0; i < outcomes.length; i++) {
    const id = f.service.subscribe({ subscription: subscription(i) }).device.id;
    actual.push(await f.service.test(id));
  }
  assert.deepEqual(actual.map(item => item.status), ['expired', 'expired', 'rate_limited', 'unknown', 'failed', 'failed', 'unknown']);
  assert.equal(f.service.list().length, 5); assert.equal(calls, 7);
  assert(!JSON.stringify(actual).includes('secret'));
});

test('explicit CLI-style targeting and generic payload prevent arbitrary lock-screen content and paths', async t => {
  const sent = [];
  const f = await fixture(t, { transport: async input => { sent.push(input); return { statusCode: 201 }; } });
  const id = f.service.subscribe({ subscription: subscription() }).device.id;
  await assert.rejects(f.service.send({}));
  await assert.rejects(f.service.send({ id, all: true }));
  await assert.rejects(f.service.send({ id, path: '//evil.test/' }));
  await assert.rejects(f.service.send({ id, path: '/app/?redirect=https://evil.test' }));
  const result = await f.service.send({ id, title: '민감한 제목', body: '민감한 내용', path: '/chat/' });
  assert.equal(result[0].status, 'accepted');
  assert.deepEqual(sent[0].payload, { title: '별빛공방', body: '별빛공방에 새 알림이 있어요', path: '/chat/' });
});

test('SSRF protection rejects all private, documentation and transition DNS answers, including mixed sets', async () => {
  for (const address of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '192.0.0.1', '192.0.2.2', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fe80::1', 'fc00::1', '2002:7f00:1::1', '2001:0:4136:e378::1', '2001:db8::1', '64:ff9b::7f00:1', '2001:4860::5efe:7f00:1', '3fff::1']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '142.250.185.10', '2001:4860:4860::8888', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
  const endpoint = subscription().endpoint;
  await assert.rejects(resolvePinnedEndpoint(endpoint, async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), { code: 'PUSH_DNS_BLOCKED' });
  await assert.rejects(resolvePinnedEndpoint(endpoint, async () => []), { code: 'PUSH_DNS_BLOCKED' });
  await assert.rejects(resolvePinnedEndpoint(endpoint, async () => [{ address: '8.8.8.8', family: 6 }]), { code: 'PUSH_DNS_BLOCKED' });
});

function fakeRequest({ statusCode = 201, responseBytes = 0, hang = false, inspect } = {}) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    options.signal.addEventListener('abort', () => req.emit('error', new Error('aborted')), { once: true });
    req.end = body => {
      inspect?.(url, options, body);
      if (hang) return;
      const response = new EventEmitter(); response.statusCode = statusCode; response.destroy = () => {};
      callback(response);
      queueMicrotask(() => { if (responseBytes) response.emit('data', Buffer.alloc(responseBytes)); response.emit('end'); });
    };
    return req;
  };
}

test('encrypted HTTPS request pins the validated DNS address with TLS hostname and does not follow redirects', async () => {
  let dnsCalls = 0, requests = 0;
  const transport = createPushTransport({ lookup: async () => { dnsCalls++; return [{ address: '8.8.8.8', family: 4 }]; }, request: fakeRequest({ statusCode: 302, inspect: (url, options, body) => {
    requests++;
    assert.equal(url.hostname, 'fcm.googleapis.com');
    assert.equal(options.servername, url.hostname);
    assert.equal(options.agent, false);
    assert.equal(options.headers['Content-Encoding'], 'aes128gcm');
    assert(!body.toString().includes('private-notification'));
    options.lookup(url.hostname, { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]); });
    options.lookup(url.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
    options.lookup('evil.test', {}, error => assert.equal(error.code, 'PUSH_DNS_BLOCKED'));
  } }) });
  const result = await transport({ subscription: subscription(), config: config(), payload: { body: 'private-notification' } });
  assert.equal(result.statusCode, 302); assert.equal(dnsCalls, 1); assert.equal(requests, 1);
});

test('transport applies overall timeout to DNS and request, and bounds broker response size', async () => {
  const input = { subscription: subscription(), config: config(), payload: { body: 'safe' } };
  await assert.rejects(createPushTransport({ lookup: async () => new Promise(() => {}), timeoutMs: 10 })(input), { code: 'PUSH_TIMEOUT' });
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  await assert.rejects(createPushTransport({ lookup, timeoutMs: 10, request: fakeRequest({ hang: true }) })(input), { code: 'PUSH_TIMEOUT' });
  await assert.rejects(createPushTransport({ lookup, request: fakeRequest({ responseBytes: 8193 }) })(input), { code: 'PUSH_RESPONSE_SIZE' });
});
