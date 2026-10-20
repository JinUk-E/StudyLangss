/* Notifications only: private pages and API responses are never cached here. */
const notificationTitle = '별빛공방';
const notificationBody = '별빛공방에 새 알림이 있어요';
const allowedPaths = new Set(['/app/', '/chat/', '/study/']);
function notificationPath(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/app/', self.location.origin);
    return url.origin === self.location.origin && !url.username && !url.password && !url.search && !url.hash && allowedPaths.has(url.pathname) ? url.pathname : '/app/';
  } catch { return '/app/'; }
}
self.addEventListener('push', event => {
  let data;
  try { data = event.data?.json(); } catch { data = null; }
  const path = notificationPath(data && typeof data === 'object' ? data.path ?? data.url : undefined);
  event.waitUntil(self.registration.showNotification(notificationTitle, { body: notificationBody, icon: '/pwa/icon-192.png', badge: '/pwa/icon-192.png', data: { path } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = notificationPath(event.notification.data?.path);
  const url = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exact = windows.find(client => client.url === url);
    if (exact) { await exact.focus(); return; }
    const sameOrigin = windows.find(client => {
      try { return new URL(client.url).origin === self.location.origin; } catch { return false; }
    });
    if (sameOrigin && typeof sameOrigin.navigate === 'function') {
      try { const moved = await sameOrigin.navigate(url); if (moved) { await moved.focus(); return; } } catch { /* A closed window can race this click. */ }
    }
    await self.clients.openWindow(url);
  })());
});
