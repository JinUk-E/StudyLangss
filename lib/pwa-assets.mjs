import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only these non-private resources are available before authentication.
const assets = new Map([
  ['/manifest.webmanifest', ['pwa/manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/pwa/register.js', ['pwa/register.js', 'text/javascript; charset=utf-8']],
  ['/pwa/app.js', ['pwa/app.js', 'text/javascript; charset=utf-8']],
  ['/pwa/styles.css', ['pwa/styles.css', 'text/css; charset=utf-8']],
  ['/pwa/icon.svg', ['pwa/icon.svg', 'image/svg+xml']],
  ['/pwa/icon-192.png', ['pwa/icon-192.png', 'image/png']],
  ['/pwa/icon-512.png', ['pwa/icon-512.png', 'image/png']],
  ['/pwa/apple-touch-icon.png', ['pwa/apple-touch-icon.png', 'image/png']]
]);

/** Serve the public PWA shell resources; never exposes settings or user data. */
export async function servePwaAsset(req, res, root) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const asset = assets.get(path);
  if (!asset) return false;
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true;
  }
  const content = await readFile(resolve(root, 'public', asset[0]));
  if (path === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
  res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}
