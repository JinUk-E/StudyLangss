import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAuth } from './lib/auth.mjs';
import { assert } from './lib/validation.mjs';
import { createPortfolioStore } from './lib/portfolio-store.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
let authenticate;
try { authenticate = await loadAuth(resolve(process.env.AUTH_FILE || resolve(root, 'data/auth.json'))); }
catch (error) { console.error(error.message); process.exit(1); }
const store = createPortfolioStore(resolve(process.env.PORTFOLIO_DATA_DIR || resolve(root, 'data/portfolio')));
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/site/styles.css', ['styles.css', 'text/css']],
  ['/site/app.js', ['app.js', 'text/javascript']], ['/site/shared.js', ['shared.js', 'text/javascript']],
  ['/site/admin.js', ['admin.js', 'text/javascript']], ['/admin/', ['admin.html', 'text/html']]
]);
async function bytes(req, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; assert(size <= limit, '파일 또는 요청이 너무 큽니다.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function body(req) {
  assert((req.headers['content-type'] || '').startsWith('application/json'), 'JSON 형식이 필요합니다.', 415);
  const raw = await bytes(req, 128 * 1024);
  try { const value = JSON.parse(raw.toString('utf8')); assert(value && typeof value === 'object' && !Array.isArray(value), '객체가 필요합니다.'); return value; }
  catch { assert(false, '올바른 JSON 객체를 보내 주세요.'); }
}
function sameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  assert(req.headers['sec-fetch-site'] !== 'cross-site', '다른 사이트에서의 변경 요청은 허용하지 않습니다.', 403);
  if (req.headers.origin) {
    let origin; try { origin = new URL(req.headers.origin); } catch { assert(false, '요청 출처를 확인해 주세요.', 403); }
    assert(['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host, '다른 사이트에서의 변경 요청은 허용하지 않습니다.', 403);
  }
}
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const path = new URL(req.url, 'http://localhost').pathname, method = req.method;
    const read = ['GET', 'HEAD'].includes(method);
    if (path === '/api/portfolio/public' && read) {
      if (method === 'HEAD') { res.writeHead(200); return res.end(); }
      return json(res, 200, { profile: store.profile(), projects: store.projects().filter(p => p.published) });
    }
    if (path === '/robots.txt' && read) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(method === 'HEAD' ? undefined : 'User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /chat\nDisallow: /study\n'); }
    if (path.startsWith('/media/') && read) {
      const image = store.image(path); assert(image, '이미지를 찾을 수 없습니다.', 404);
      if (!store.publicImage(path) && !await authenticate(req, res)) return;
      res.writeHead(200, { 'Content-Type': image.mime }); return res.end(method === 'HEAD' ? undefined : Buffer.from(image.content));
    }
    let asset = files.get(path);
    if (/^\/projects\/[a-f0-9-]{36}$/.test(path) && read) {
      assert(store.project(path.split('/').pop())?.published, '공개된 프로젝트를 찾을 수 없습니다.', 404);
      asset = files.get('/');
    }
    const privateRoute = path.startsWith('/admin') || path === '/site/admin.js' || path.startsWith('/api/portfolio/');
    if (privateRoute && !await authenticate(req, res)) return;
    sameOrigin(req);
    if (path === '/admin' && read) { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    if (asset && read) { const content = await readFile(resolve(root, 'public/site', asset[0])); res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); return res.end(method === 'HEAD' ? undefined : content); }
    if (path === '/api/portfolio/manage' && method === 'GET') return json(res, 200, { profile: store.profile(), projects: store.projects() });
    if (path === '/api/portfolio/profile' && method === 'PUT') return json(res, 200, { profile: store.saveProfile(await body(req)) });
    if (path === '/api/portfolio/images' && method === 'POST') return json(res, 201, store.addImage(await bytes(req, 8 * 1024 * 1024)));
    if (path === '/api/portfolio/projects' && method === 'POST') return json(res, 201, { project: store.saveProject(await body(req)) });
    const match = path.match(/^\/api\/portfolio\/projects\/([a-f0-9-]{36})$/);
    if (match) {
      assert(store.project(match[1]), '프로젝트를 찾을 수 없습니다.', 404);
      if (method === 'PUT') return json(res, 200, { project: store.saveProject(await body(req), match[1]) });
      if (method === 'DELETE') { store.remove(match[1]); return json(res, 200, { deleted: true }); }
    }
    json(res, 404, { error: '페이지를 찾을 수 없습니다.' });
  } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '요청을 처리하지 못했습니다.' }); else res.end(); }
});
server.requestTimeout = 60000; server.headersTimeout = 10000;
const host = process.env.PORTFOLIO_HOST || '127.0.0.1', port = Number(process.env.PORTFOLIO_PORT || 3212);
server.listen(port, host, () => console.log(`Starlight Portfolio is running at http://${host}:${server.address().port}`));
let closing = false;
function shutdown() { if (closing) return; closing = true; server.close(() => { store.db.close(); process.exit(0); }); server.closeIdleConnections(); setTimeout(() => server.closeAllConnections(), 5000).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
