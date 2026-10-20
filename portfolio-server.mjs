import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAuth } from './lib/auth.mjs';
import { assert } from './lib/validation.mjs';
import { createPortfolioStore } from './lib/portfolio-store.mjs';
import { careerResume } from './content/career-content.mjs';
import { servePwaAsset } from './lib/pwa-assets.mjs';
import { createPushService } from './lib/push-service.mjs';
import { pushPaths } from './lib/push-paths.mjs';
import { requireAccess } from './lib/access.mjs';
import { createSiteUpdater } from './lib/site-update.mjs';
import { createRuntimeHealth } from './lib/runtime-health.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtimeHealth = await createRuntimeHealth(root, 'portfolio');
const updater = createSiteUpdater(root);
let authenticate;
try { authenticate = await loadAuth(resolve(process.env.AUTH_FILE || resolve(root, 'data/auth.json'))); }
catch (error) { console.error(error.message); process.exit(1); }
const store = createPortfolioStore(resolve(process.env.PORTFOLIO_DATA_DIR || resolve(root, 'data/portfolio')));
const push = await createPushService({ ...pushPaths(root), isAccountActive: id => authenticate.accounts.isActive(id) });
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/site/styles.css', ['styles.css', 'text/css']],
  ['/site/app.js', ['app.js', 'text/javascript']], ['/site/shared.js', ['shared.js', 'text/javascript']],
  ['/site/admin.js', ['admin.js', 'text/javascript']], ['/admin/', ['admin.html', 'text/html']],
  ['/portfolio/', ['index.html', 'text/html']], ['/resume/', ['resume.html', 'text/html']], ['/site/resume.js', ['resume.js', 'text/javascript']], ['/site/editorial.css', ['editorial.css', 'text/css']],
  ['/accounts/', ['../accounts/index.html', 'text/html']], ['/accounts/app.js', ['../accounts/app.js', 'text/javascript']], ['/accounts/styles.css', ['../accounts/styles.css', 'text/css']],
  ['/admin/system/', ['../updates/index.html', 'text/html']], ['/admin/system/app.js', ['../updates/app.js', 'text/javascript']], ['/admin/system/styles.css', ['../updates/styles.css', 'text/css']], ['/admin/system/guide.html', ['../../docs/updates/guide.html', 'text/html']]
]);
async function bytes(req, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; assert(size <= limit, '파일 또는 요청이 너무 큽니다.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function body(req, limit = 128 * 1024) {
  assert((req.headers['content-type'] || '').startsWith('application/json'), 'JSON 형식이 필요합니다.', 415);
  const raw = await bytes(req, limit);
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
    if (runtimeHealth(req, res)) return;
    if (await servePwaAsset(req, res, root)) return;
    const path = new URL(req.url, 'http://localhost').pathname, method = req.method;
    const read = ['GET', 'HEAD'].includes(method);
    if (read && ['/portfolio', '/resume'].includes(path)) { res.writeHead(302, { Location: `${path}/` }); return res.end(); }
    if (read && ['/shared/shell.css', '/shared/shell.js'].includes(path)) {
      const content = await readFile(resolve(root, 'public', path.slice(1)));
      res.writeHead(200, { 'Content-Type': path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' }); return res.end(method === 'HEAD' ? undefined : content);
    }
    if (path === '/api/portfolio/public' && read) {
      if (method === 'HEAD') { res.writeHead(200); return res.end(); }
      return json(res, 200, { profile: store.profile(), projects: store.projects().filter(p => p.published) });
    }
    if (path === '/robots.txt' && read) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(method === 'HEAD' ? undefined : 'User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /chat\nDisallow: /study\n'); }
    if (path.startsWith('/media/') && read) {
      const image = store.image(path); assert(image, '이미지를 찾을 수 없습니다.', 404);
      if (!store.publicImage(path)) {
        if (!await authenticate(req, res)) return;
        if (!requireAccess(req, res, 'admin')) return;
      }
      res.writeHead(200, { 'Content-Type': image.mime }); return res.end(method === 'HEAD' ? undefined : Buffer.from(image.content));
    }
    let asset = files.get(path);
    if (/^\/projects\/[a-f0-9-]{36}$/.test(path) && read) {
      assert(store.project(path.split('/').pop())?.published, '공개된 프로젝트를 찾을 수 없습니다.', 404);
      asset = files.get('/');
    }
    if (path === '/api/portfolio/session' && read) return json(res, 200, { user: await authenticate(req, res, { optional: true }) || null });
    const privateRoute = path.startsWith('/admin') || path === '/site/admin.js' || path.startsWith('/api/portfolio/') || path === '/app' || path.startsWith('/app/') || path === '/accounts' || path.startsWith('/accounts/');
    if (path === '/resume/' && !store.resume().published) {
      if (!await authenticate(req, res)) return;
      if (!requireAccess(req, res, 'admin')) return;
    }
    if (path === '/api/portfolio/resume' && read && store.resume().published) return json(res, 200, { resume: store.resume(), profile: store.profile(), projects: store.projects().filter(p => p.published) });
    if (privateRoute && !await authenticate(req, res)) return;
    const memberRoute = path === '/app' || path.startsWith('/app/') || path === '/api/portfolio/me' || path.startsWith('/api/portfolio/push/');
    if (privateRoute && !memberRoute && !requireAccess(req, res, 'admin')) return;
    sameOrigin(req);
    if (path === '/admin/system' && read) { res.writeHead(302, { Location: '/admin/system/' }); return res.end(); }
    if (path === '/api/portfolio/updates' && method === 'GET') return json(res, 200, await updater.status());
    const updateAction = path.match(/^\/api\/portfolio\/updates\/(check|apply)$/);
    if (updateAction && method === 'POST') {
      const input = await body(req, 2048);
      assert(authenticate.accounts.current(req.user, 'admin'), '관리자 계정을 확인해 주세요.', 403);
      return json(res, 202, await updater.enqueue(req, updateAction[1], input));
    }
    if (path === '/accounts' && read) { res.writeHead(302, { Location: '/accounts/' }); return res.end(); }
    if (path === '/api/portfolio/me' && method === 'GET') return json(res, 200, { user: req.user });
    if (path === '/api/portfolio/accounts') {
      if (method === 'GET') return json(res, 200, { accounts: authenticate.accounts.list() });
      if (method === 'POST') return json(res, 201, { account: await authenticate.accounts.create(await body(req, 16384)) });
    }
    const accountMatch = path.match(/^\/api\/portfolio\/accounts\/(owner|[a-f0-9-]{36})$/);
    if (accountMatch && method === 'PATCH') return json(res, 200, { account: await authenticate.accounts.update(accountMatch[1], await body(req, 16384)) });
    if (path === '/app' && read) { res.writeHead(302, { Location: '/app/' }); return res.end(); }
    if (path === '/app/' && read) {
      const content = await readFile(resolve(root, 'public/pwa/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(method === 'HEAD' ? undefined : content);
    }
    if (path.startsWith('/api/portfolio/push/')) {
      if (!read && req.headers.origin && push.info().configured) assert(req.headers.origin === push.info().origin, '설정된 HTTPS 사이트에서 요청해 주세요.', 403);
      if (path === '/api/portfolio/push/config' && method === 'GET') return json(res, 200, { ...push.info(), user: req.user });
      if (path === '/api/portfolio/push/devices') {
        if (method === 'GET') return json(res, 200, { devices: push.list(req.user.id) });
        if (method === 'POST') return json(res, 201, await push.subscribe(await body(req, 16384), req.user.id));
      }
      if (path === '/api/portfolio/push/match' && method === 'POST') {
        const input = await body(req, 16384);
        assert(typeof input.endpoint === 'string' && input.endpoint.length <= 4096, '기기 구독 정보가 올바르지 않습니다.');
        return json(res, 200, { device: push.match(input.endpoint, req.user.id) });
      }
      if (path === '/api/portfolio/push/test' && method === 'POST') {
        const input = await body(req, 16384);
        assert(typeof input.id === 'string' && /^[a-f0-9-]{36}$/.test(input.id), '기기를 선택해 주세요.');
        return json(res, 200, await push.test(input.id, req.user.id));
      }
      const deviceMatch = path.match(/^\/api\/portfolio\/push\/devices\/([a-f0-9-]{36})$/);
      if (deviceMatch && method === 'DELETE') return json(res, 200, { deleted: push.remove(deviceMatch[1], req.user.id) });
      return json(res, 404, { error: '요청한 알림 경로를 찾을 수 없습니다.' });
    }
    if (path === '/admin' && read) { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    if (asset && read) {
      const content = await readFile(resolve(root, 'public/site', asset[0]));
      if (path === '/admin/system/guide.html') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); return res.end(method === 'HEAD' ? undefined : content);
    }
    if (path === '/api/portfolio/manage' && method === 'GET') return json(res, 200, { profile: store.profile(), projects: store.projects(), resume: store.resume() });
    if (path === '/api/portfolio/career-template' && method === 'GET') return json(res, 200, { resume: careerResume });
    if (path === '/api/portfolio/resume' && method === 'GET') return json(res, 200, { resume: store.resume(), profile: store.profile(), projects: store.projects().filter(p => p.published) });
    if (path === '/api/portfolio/resume' && method === 'PUT') return json(res, 200, { resume: store.saveResume(await body(req)) });
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
function shutdown() { if (closing) return; closing = true; server.close(() => { push.close(); store.db.close(); authenticate.accounts.close(); process.exit(0); }); server.closeIdleConnections(); setTimeout(() => server.closeAllConnections(), 5000).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
