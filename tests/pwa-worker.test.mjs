import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker(windows = []) {
  const events = new Map(), notifications = [], opened = [];
  const self = { location: { origin: 'https://forge.example' }, addEventListener: (name, handle) => events.set(name, handle), registration: { async showNotification(title, options) { notifications.push({ title, ...options }); } }, clients: { async matchAll() { return windows; }, async openWindow(url) { opened.push(url); } } };
  vm.runInNewContext(source, { self, URL, Set });
  async function fire(name, value) { let pending; events.get(name)({ ...value, waitUntil(promise) { pending = promise; } }); await pending; }
  return { events, notifications, opened, fire };
}
test('push always shows a fixed private notification, including missing or malformed data', async () => {
  const w = worker();
  for (const data of [undefined, { json() { throw new Error('malformed'); } }, { json() { return null; } }, { json() { return { title: 'private title', body: 'sensitive report', path: '/chat/' }; } }]) await w.fire('push', { data });
  assert.equal(w.notifications.length, 4);
  for (const notification of w.notifications) { assert.equal(notification.title, '별빛공방'); assert.equal(notification.body, '별빛공방에 새 알림이 있어요'); assert.equal(JSON.stringify(notification).includes('sensitive'), false); }
  assert.equal(w.notifications[0].data.path, '/app/'); assert.equal(w.notifications[3].data.path, '/chat/');
  assert.equal(w.events.has('fetch'), false, 'private responses must never enter a worker cache');
});
test('push and click reject external, credential, query, hash, and unknown destinations', async () => {
  const w = worker();
  for (const path of ['https://evil.example/chat/', '//evil.example/app/', 'javascript:alert(1)', 'https://name@forge.example/app/', '/admin/', '/chat/?secret=anything', '/study/#private', '/app/../admin/', 7, {}]) {
    await w.fire('push', { data: { json: () => ({ path }) } });
    assert.equal(w.notifications.at(-1).data.path, '/app/');
    let closed = false;
    await w.fire('notificationclick', { notification: { data: { path }, close() { closed = true; } } });
    assert.equal(closed, true); assert.equal(w.opened.at(-1), 'https://forge.example/app/');
  }
});
test('notification click focuses exact URL, navigates a same-origin window, and opens if navigation races closure', async () => {
  const calls = [];
  let w = worker([{ url: 'https://forge.example/study/', async focus() { calls.push('exact'); } }]);
  await w.fire('notificationclick', { notification: { data: { path: '/study/' }, close() {} } }); assert.deepEqual(calls, ['exact']); assert.equal(w.opened.length, 0);
  w = worker([{ url: 'https://evil.example/', async navigate() { throw new Error('must not navigate another origin'); } }, { url: 'https://forge.example/chat/', async navigate(url) { calls.push(url); return { async focus() { calls.push('focused'); } }; } }]);
  await w.fire('notificationclick', { notification: { data: { path: '/app/' }, close() {} } }); assert.deepEqual(calls.slice(1), ['https://forge.example/app/', 'focused']); assert.equal(w.opened.length, 0);
  w = worker([{ url: 'https://forge.example/chat/', async navigate() { throw new Error('closed'); } }]);
  await w.fire('notificationclick', { notification: { data: { path: '/study/' }, close() {} } }); assert.deepEqual(w.opened, ['https://forge.example/study/']);
});
