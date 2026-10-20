import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import webpush from 'web-push';
import { createPushService } from '../lib/push-service.mjs';
import { createPushTransport } from '../lib/push-transport.mjs';

const settings = () => ({ version: 1, origin: 'https://starlightforge.duckdns.org', subject: 'https://starlightforge.duckdns.org', ...webpush.generateVAPIDKeys() });
function subscription(id = randomUUID()) { const key = createECDH('prime256v1'); key.generateKeys(); return { endpoint: `https://web.push.apple.com/account-fixture-${id}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; }
test('legacy push devices retain owner; cross-account matching, transfer and delivery are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stella-push-owner-'));
  let service;
  try {
    const configFile = join(directory, 'vapid.json'); await writeFile(configFile, JSON.stringify(settings()), { mode: 0o600 });
    const db = new DatabaseSync(join(directory, 'push.sqlite'));
    const legacy = subscription(), legacyId = randomUUID();
    db.exec(`CREATE TABLE push_devices(id TEXT PRIMARY KEY,endpoint TEXT NOT NULL UNIQUE,subscription TEXT NOT NULL,label TEXT NOT NULL,createdAt TEXT NOT NULL,lastAttemptAt TEXT,lastStatus TEXT,cooldownUntil INTEGER NOT NULL DEFAULT 0,leaseUntil INTEGER NOT NULL DEFAULT 0,claimToken TEXT);`);
    db.prepare('INSERT INTO push_devices(id,endpoint,subscription,label,createdAt) VALUES(?,?,?,?,?)').run(legacyId, legacy.endpoint, JSON.stringify(legacy), '기존 폰', '2026-10-20T00:00:00.000Z'); db.close();
    let active = true, calls = 0;
    service = await createPushService({ directory, configFile, isAccountActive: () => active, transport: async () => { calls++; return { statusCode: 201 }; } });
    assert.equal(service.list()[0].id, legacyId); assert.equal(service.list()[0].label, '기존 폰');
    const guest = randomUUID(), guestSub = subscription(), guestDevice = service.subscribe({ subscription: guestSub, label: '새 폰' }, guest).device;
    assert.equal(service.list(guest).length, 1); assert.equal(service.list().length, 1);
    assert.equal(service.match(legacy.endpoint, guest), null); assert.equal(service.remove(legacyId, guest), false);
    assert.throws(() => service.subscribe({ subscription: legacy, label: '가로채기' }, guest), { status: 409 });
    await assert.rejects(service.test(legacyId, guest), { status: 404 }); assert.equal(calls, 0);
    active = false; await assert.rejects(service.test(guestDevice.id, guest), { status: 403 }); assert.equal(calls, 0);
    active = true; assert.equal((await service.send({ all: true }))[0].id, legacyId); assert.equal(calls, 1);
    assert.equal((await service.test(guestDevice.id, guest)).status, 'accepted'); assert.equal(calls, 2);
    service.close(); service = await createPushService({ directory, configFile });
    assert.equal(service.list()[0].id, legacyId); assert.equal(service.list(guest)[0].id, guestDevice.id);
  } finally { service?.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); }
});

test('account suspension while resolving a push destination prevents the HTTPS request', async () => {
  let allowed = true, release, lookups = 0, requests = 0;
  const transport = createPushTransport({ lookup: async () => { lookups++; await new Promise(resolve => { release = resolve; }); return [{ address: '8.8.8.8', family: 4 }]; }, request: () => { requests++; throw Error('must not request'); } });
  const pending = transport({ subscription: subscription(), config: settings(), payload: { path: '/app/' }, canSend: () => allowed });
  assert.equal(lookups, 1); allowed = false; release();
  await assert.rejects(pending, { code: 'PUSH_ACCOUNT_INACTIVE' }); assert.equal(requests, 0);
});
