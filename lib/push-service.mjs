import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createECDH, ECDH, randomUUID, timingSafeEqual } from 'node:crypto';
import { assert } from './validation.mjs';
import { validateEndpoint, sendPushRequest } from './push-transport.mjs';

const DEFAULT_TITLE = '별빛공방';
const DEFAULT_BODY = '별빛공방에 새 알림이 있어요';
const SAFE_PATHS = new Set(['/app/', '/chat/', '/study/']);
const publicDevice = row => row ? { id: row.id, label: row.label, createdAt: row.createdAt, lastAttemptAt: row.lastAttemptAt, lastStatus: row.lastStatus } : null;
const decode = (value, length) => {
  assert(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value), '푸시 키 형식을 확인하세요.');
  const bytes = Buffer.from(value, 'base64url');
  assert(bytes.length === length && bytes.toString('base64url') === value, '푸시 키 길이를 확인하세요.');
  return bytes;
};
function publicKey(value) {
  const key = decode(value, 65);
  assert(key[0] === 4, '푸시 공개키 형식을 확인하세요.');
  try { ECDH.convertKey(key, 'prime256v1', undefined, undefined, 'uncompressed'); }
  catch { assert(false, '올바른 푸시 공개키가 아닙니다.'); }
  return key;
}

export function validatePushConfig(value) {
  assert(value && value.version === 1, '푸시 설정 버전을 확인하세요.');
  let origin;
  try { origin = new URL(value.origin); } catch { assert(false, 'HTTPS 원본 주소를 확인하세요.'); }
  assert(origin.protocol === 'https:' && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash && typeof value.origin === 'string' && value.origin.length <= 2048, 'HTTPS 원본 주소만 입력하세요.');
  assert(typeof value.subject === 'string' && value.subject.length <= 500, '푸시 연락처를 확인하세요.');
  let contact; try { contact = new URL(value.subject); } catch { assert(false, '푸시 연락처를 확인하세요.'); }
  assert((contact.protocol === 'mailto:' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.pathname) && !contact.search && !contact.hash)
    || (contact.protocol === 'https:' && !contact.username && !contact.password && Boolean(contact.hostname) && !contact.hash), 'mailto 또는 HTTPS 연락처를 입력하세요.');
  const expected = publicKey(value.publicKey);
  const secret = decode(value.privateKey, 32);
  let generated;
  try { const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(secret); generated = ecdh.getPublicKey(); }
  catch { assert(false, '푸시 개인키를 확인하세요.'); }
  assert(timingSafeEqual(expected, generated), '푸시 키 쌍이 일치하지 않습니다.');
  return { version: 1, origin: origin.origin, subject: contact.href, publicKey: value.publicKey, privateKey: value.privateKey };
}

export function validateSubscription(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), '푸시 구독 형식을 확인하세요.');
  const endpoint = validateEndpoint(input.endpoint);
  assert(input.keys && typeof input.keys === 'object', '푸시 구독 키를 확인하세요.');
  publicKey(input.keys.p256dh); decode(input.keys.auth, 16);
  return { endpoint, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}

export async function createPushService({ directory, configFile = join(directory, 'vapid.json'), transport = sendPushRequest }) {
  let config, reason = 'not_configured';
  try {
    const info = await stat(configFile);
    assert(info.isFile() && info.size <= 8192 && (process.platform === 'win32' || (info.mode & 0o077) === 0), '푸시 설정 파일 권한을 확인하세요.');
    config = validatePushConfig(JSON.parse(await readFile(configFile, 'utf8')));
  } catch (error) { reason = error.code === 'ENOENT' ? 'not_configured' : 'invalid_config'; }
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  const filename = join(directory, 'push.sqlite');
  const db = new DatabaseSync(filename); await chmod(filename, 0o600);
  db.exec(`PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS push_devices (
      id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL,
      label TEXT NOT NULL, createdAt TEXT NOT NULL, lastAttemptAt TEXT, lastStatus TEXT,
      cooldownUntil INTEGER NOT NULL DEFAULT 0, leaseUntil INTEGER NOT NULL DEFAULT 0, claimToken TEXT
    );`);
  let closed = false, dbClosed = false, active = 0;
  const open = () => assert(!closed, '푸시 서비스가 종료되었습니다.', 503);
  const configured = () => { open(); assert(config, 'Mac에서 푸시 설정을 먼저 완료하세요.', 503); };
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const list = () => { open(); return db.prepare('SELECT * FROM push_devices ORDER BY createdAt,id').all().map(publicDevice); };
  const get = id => {
    assert(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), '기기 ID를 확인하세요.');
    const row = db.prepare('SELECT * FROM push_devices WHERE id=?').get(id);
    assert(row, '등록된 기기를 찾을 수 없습니다.', 404); return row;
  };
  const finalClose = () => { if (closed && !active && !dbClosed) { dbClosed = true; db.close(); } };

  async function deliver(id, path = '/app/') {
    configured();
    const now = Date.now(), token = randomUUID();
    const claim = tx(() => {
      const row = get(id);
      if (row.cooldownUntil > now) return { status: 'rate_limited', retryAfter: Math.ceil((row.cooldownUntil - now) / 1000) };
      if (db.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE leaseUntil>?').get(now).n >= 2) return { status: 'rate_limited', retryAfter: 15 };
      db.prepare("UPDATE push_devices SET lastAttemptAt=?,lastStatus='sending',cooldownUntil=?,leaseUntil=?,claimToken=? WHERE id=?")
        .run(new Date(now).toISOString(), now + 60_000, now + 15_000, token, id);
      return { row };
    });
    if (!claim.row) return { id, ...claim };
    active++;
    let status = 'unknown', code;
    try {
      const result = await transport({ subscription: JSON.parse(claim.row.subscription), config, payload: { title: DEFAULT_TITLE, body: DEFAULT_BODY, path } });
      const http = Number(result?.statusCode);
      status = http >= 200 && http < 300 ? 'accepted' : http === 404 || http === 410 ? 'expired' : http === 429 ? 'rate_limited' : http >= 500 ? 'unknown' : 'failed';
      code = Number.isInteger(http) ? `HTTP_${http}` : 'PUSH_RESPONSE';
    } catch (error) {
      const safeCodes = new Set(['PUSH_ENDPOINT', 'PUSH_DNS_BLOCKED', 'PUSH_REQUEST', 'PUSH_TIMEOUT', 'PUSH_NETWORK', 'PUSH_RESPONSE', 'PUSH_RESPONSE_SIZE']);
      code = safeCodes.has(error?.code) ? error.code : 'PUSH_TRANSPORT';
      status = ['PUSH_ENDPOINT', 'PUSH_DNS_BLOCKED', 'PUSH_REQUEST'].includes(code) ? 'failed' : 'unknown';
    } finally {
      try {
        if (status === 'expired') db.prepare('DELETE FROM push_devices WHERE id=? AND claimToken=?').run(id, token);
        else db.prepare('UPDATE push_devices SET lastStatus=?,leaseUntil=0,claimToken=NULL WHERE id=? AND claimToken=?').run(status, id, token);
      } finally { active--; finalClose(); }
    }
    return { id, status, code };
  }

  return {
    info: () => config ? { configured: true, applicationServerKey: config.publicKey, origin: config.origin } : { configured: false, reason },
    list,
    match(endpoint) { open(); const safe = validateEndpoint(endpoint); return publicDevice(db.prepare('SELECT * FROM push_devices WHERE endpoint=?').get(safe)); },
    subscribe({ subscription, label = '내 기기' } = {}) {
      configured();
      const value = validateSubscription(subscription);
      assert(typeof label === 'string' && label.trim().length >= 1 && label.length <= 60 && !/[\x00-\x1f\x7f]/.test(label), '기기 이름은 1~60자로 입력하세요.');
      return tx(() => {
        const previous = db.prepare('SELECT * FROM push_devices WHERE endpoint=?').get(value.endpoint);
        if (previous) {
          db.prepare('UPDATE push_devices SET subscription=?,label=? WHERE id=?').run(JSON.stringify(value), label.trim(), previous.id);
          return { device: publicDevice(db.prepare('SELECT * FROM push_devices WHERE id=?').get(previous.id)) };
        }
        assert(db.prepare('SELECT COUNT(*) AS n FROM push_devices').get().n < 10, '기기는 최대 10개까지 등록할 수 있습니다.', 409);
        const id = randomUUID(), createdAt = new Date().toISOString();
        db.prepare('INSERT INTO push_devices(id,endpoint,subscription,label,createdAt) VALUES(?,?,?,?,?)').run(id, value.endpoint, JSON.stringify(value), label.trim(), createdAt);
        return { device: publicDevice(db.prepare('SELECT * FROM push_devices WHERE id=?').get(id)) };
      });
    },
    remove(id) { open(); assert(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), '기기 ID를 확인하세요.'); return db.prepare('DELETE FROM push_devices WHERE id=?').run(id).changes > 0; },
    test: id => deliver(id),
    async send({ id, all = false, title, body, path = '/app/' } = {}) {
      configured();
      assert((typeof id === 'string' && !all) || (id === undefined && all === true), '--id 또는 --all 중 하나를 지정하세요.');
      assert(SAFE_PATHS.has(path), '허용된 앱 경로만 사용할 수 있습니다.');
      assert((title === undefined || typeof title === 'string' && title.length <= 100) && (body === undefined || typeof body === 'string' && body.length <= 1000), '알림 문구 길이를 확인하세요.');
      // Generic notifications intentionally omit caller text from lock screens.
      const ids = all ? list().map(device => device.id) : [get(id).id];
      const result = [];
      for (const target of ids) result.push(await deliver(target, path));
      return result;
    },
    close() { closed = true; finalClose(); }
  };
}
