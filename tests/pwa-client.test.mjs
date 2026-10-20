import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/pwa/app.js', import.meta.url), 'utf8');
const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
class Element {
  textContent = ''; dataset = {}; children = []; value = ''; disabled = false; hidden = false; events = new Map();
  addEventListener(name, callback) { this.events.set(name, callback); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this[name] = value; }
  click() { return this.events.get('click')?.(); }
}
function browser(options = {}) {
  const elements = new Map(), all = [], requests = [], counters = { permission: 0, subscribed: 0, unsubscribed: 0 }, windowEvents = new Map();
  const element = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  const device = { id: 'device-1', label: '내 휴대폰', createdAt: '2026-10-20T01:00:00.000Z', lastAttemptAt: null, lastStatus: null };
  let currentSubscription = options.subscription ? { endpoint: 'https://fcm.googleapis.com/test-secret-endpoint', options: { applicationServerKey: new Uint8Array(options.oldKey || [1, 2, 3, 4]).buffer }, toJSON() { return { endpoint: this.endpoint, keys: {} }; }, async unsubscribe() { counters.unsubscribed++; currentSubscription = null; return true; } } : null;
  const registration = { active: {}, pushManager: { async getSubscription() { return currentSubscription; }, async subscribe() { counters.subscribed++; currentSubscription = { endpoint: 'https://fcm.googleapis.com/new-endpoint', options: { applicationServerKey: new Uint8Array([1, 2, 3, 4]).buffer }, toJSON() { return { endpoint: this.endpoint, keys: {} }; }, async unsubscribe() { counters.unsubscribed++; currentSubscription = null; return true; } }; return currentSubscription; } } };
  const Notification = { permission: options.permission || 'default', requestPermission() { counters.permission++; return options.permissionPromise || Promise.resolve(Notification.permission = 'granted'); } };
  const window = { isSecureContext: true, Notification, PushManager: class {}, matchMedia: () => ({ matches: options.standalone || false }), addEventListener: (name, callback) => windowEvents.set(name, callback) };
  const context = vm.createContext({ window, document: { querySelector: element, querySelectorAll: () => all.filter(item => item.dataset.removeDevice), createElement() { const value = new Element(); all.push(value); return value; } }, navigator: { userAgent: options.ios ? 'iPhone' : 'Chrome', platform: options.ios ? 'iPhone' : 'Linux', maxTouchPoints: 0, serviceWorker: { async register() { return registration; }, ready: options.neverReady ? new Promise(() => {}) : Promise.resolve(registration) } }, Notification, location: { origin: 'https://forge.example' }, AbortController, Uint8Array, atob: value => Buffer.from(value, 'base64').toString('binary'), setTimeout: options.fastTimers ? (fn, ms) => setTimeout(fn, Math.min(20, ms)) : setTimeout, clearTimeout, console,
    async fetch(url, init = {}) {
      const path = url.replace('/api/portfolio/push', ''); requests.push({ path, ...init });
      const custom = options.respond?.(path, init);
      if (custom) return { ok: custom.ok ?? true, status: custom.status || 200, async json() { return custom.data; } };
      const data = path === '/config' ? { configured: true, applicationServerKey: 'AQIDBA', origin: 'https://forge.example' } : path === '/devices' && init.method === 'POST' ? { device } : path === '/devices' ? { devices: options.subscription ? [device] : [] } : path === '/match' ? { device: options.subscription ? device : null } : path === '/test' ? { status: 'accepted' } : { deleted: true };
      return { ok: true, status: 200, async json() { return data; } };
    }
  });
  vm.runInContext(source, context);
  return { element, counters, requests, Notification, windowEvents };
}
test('permission is requested only by enable click and before the async registration step', async () => {
  let resolvePermission;
  const permissionPromise = new Promise(resolve => { resolvePermission = resolve; });
  const b = browser({ permissionPromise }); await settle();
  assert.equal(b.counters.permission, 0); assert.equal(b.counters.subscribed, 0);
  const pending = b.element('#enable-push').click();
  assert.equal(b.counters.permission, 1, 'permission must be requested synchronously in the click');
  assert.equal(b.counters.subscribed, 0);
  b.Notification.permission = 'granted'; resolvePermission('granted'); await pending;
  assert.equal(b.counters.subscribed, 1); assert.match(b.element('#push-state').textContent, /이 기기를 연결했습니다/);
});
test('failed server registration never claims the device is connected', async () => {
  const b = browser({ permission: 'granted', respond(path, init) { if (path === '/devices' && init.method === 'POST') return { ok: false, status: 503, data: { error: '서버 저장 실패' } }; } }); await settle();
  await b.element('#enable-push').click();
  assert.equal(b.element('#push-state').textContent, '서버 저장 실패'); assert.equal(b.element('#subscription-state').textContent, '이 기기 등록 없음'); assert.equal(b.element('#test-push').disabled, true);
});
test('server disconnect failure does not unsubscribe the browser or claim success', async () => {
  const b = browser({ subscription: true, permission: 'granted', respond(path, init) { if (path === '/devices/device-1' && init.method === 'DELETE') return { ok: false, status: 503, data: { error: '삭제 실패' } }; } }); await settle();
  await b.element('#disable-push').click();
  assert.equal(b.counters.unsubscribed, 0); assert.equal(b.element('#push-state').textContent, '삭제 실패'); assert.equal(b.element('#subscription-state').textContent, '이 기기 연결됨');
});
test('existing key changes are passive until user click and failed deletion stops key replacement', async () => {
  const b = browser({ subscription: true, permission: 'granted', oldKey: [8, 9], respond(path, init) { if (path === '/devices/device-1' && init.method === 'DELETE') return { ok: false, status: 503, data: { error: '이전 연결 삭제 실패' } }; } }); await settle();
  assert.equal(b.counters.unsubscribed, 0); assert.equal(b.counters.subscribed, 0); assert.match(b.element('#push-state').textContent, /키가 변경/);
  await b.element('#enable-push').click();
  assert.equal(b.counters.unsubscribed, 0); assert.equal(b.counters.subscribed, 0); assert.equal(b.element('#push-state').textContent, '이전 연결 삭제 실패');
});
test('remote removal clears server status but explains remaining browser permission', async () => {
  let removed = false;
  const b = browser({ subscription: true, permission: 'granted', respond(path) { if (removed && path === '/devices') return { data: { devices: [] } }; if (removed && path === '/match') return { data: { device: null } }; } }); await settle();
  removed = true; await b.element('#refresh-devices').click();
  assert.equal(b.element('#subscription-state').textContent, '이 기기 등록 없음'); assert.equal(b.element('#permission-state').textContent, '허용됨'); assert.match(b.element('#push-state').textContent, /서버에는 등록되어 있지 않습니다/); assert.equal(b.element('#test-push').disabled, true); assert.equal(b.counters.unsubscribed, 0);
});
test('iPhone outside home-screen mode cannot request permission; readiness timeout is recoverable', async () => {
  const iphone = browser({ ios: true }); await settle();
  assert.equal(iphone.element('#enable-push').disabled, true); await iphone.element('#enable-push').click(); assert.equal(iphone.counters.permission, 0); assert.match(iphone.element('#push-state').textContent, /홈 화면/);
  const stalled = browser({ neverReady: true, fastTimers: true });
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.match(stalled.element('#push-state').textContent, /준비가 지연/); assert.equal(stalled.element('#refresh-devices').disabled, false);
});
