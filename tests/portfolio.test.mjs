import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentials } from '../lib/auth.mjs';
import { createPortfolioStore } from '../lib/portfolio-store.mjs';

let directory, child, base;
const authorization = `Basic ${Buffer.from('portfolio-test:portfolio-test-only-2026').toString('base64')}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
const fixture = () => ({ title: '작업 <script>alert(1)</script>', category: '웹', summary: '소개', description: '상세 설명', role: '개발', year: '2026', tags: ['Node'], link: 'https://example.com', repository: '', cover: '', gallery: [], published: false, featured: false, order: 0 });
const call = (path, options = {}, auth = true) => fetch(base + path, { ...options, headers: { ...(auth ? { Authorization: authorization } : {}), 'Content-Type': 'application/json', ...options.headers } });
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'starlight-portfolio-test-'));
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials('portfolio-test', 'portfolio-test-only-2026')), { mode: 0o600 });
  child = spawn(process.execPath, ['portfolio-server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, AUTH_FILE: join(directory, 'auth.json'), PORTFOLIO_DATA_DIR: directory, PORTFOLIO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Portfolio startup timed out')), 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Portfolio exited ${code}`)); });
    child.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127.0.0.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
  });
});
after(async () => {
  if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('portfolio is public while administration, uploads, and writes require login and same-origin requests', async () => {
  for (const path of ['/', '/site/styles.css', '/site/app.js', '/site/shared.js', '/api/portfolio/public', '/robots.txt']) assert.equal((await call(path, {}, false)).status, 200, path);
  for (const path of ['/admin/', '/site/admin.js', '/api/portfolio/manage']) assert.equal((await call(path, {}, false)).status, 401, path);
  for (const path of ['/api/portfolio/projects', '/api/portfolio/images']) assert.equal((await call(path, { method: 'POST', body: '{}' }, false)).status, 401);
  assert.equal((await call('/api/portfolio/profile', { method: 'PUT', body: '{}' }, false)).status, 401);
  const evil = await call('/api/portfolio/projects', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: JSON.stringify(fixture()) }); assert.equal(evil.status, 403);
  assert.equal((await call('/api/portfolio/projects', { method: 'POST', body: '[' })).status, 400);
  for (const path of ['/data/auth.json', '/data/duckdns-token', '/api/state', '/api/chat/threads', '/site/../../auth.json']) assert.equal((await call(path, {}, false)).status, 404, path);
});
test('draft projects and images remain private until published and become private again after unpublishing', async () => {
  const image = await (await call('/api/portfolio/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).json();
  const value = { ...fixture(), cover: image.path, gallery: [image.path] };
  const created = await call('/api/portfolio/projects', { method: 'POST', body: JSON.stringify(value) }); assert.equal(created.status, 201);
  const { project } = await created.json();
  assert.equal((await call(image.path, {}, false)).status, 401);
  assert.equal((await call(`/projects/${project.id}`, {}, false)).status, 404);
  assert.ok(!(await (await call('/api/portfolio/public', {}, false)).json()).projects.some(p => p.id === project.id));
  const publish = await call(`/api/portfolio/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ ...value, published: true }) }); assert.equal(publish.status, 200);
  const publicData = await (await call('/api/portfolio/public', {}, false)).json(); assert.ok(publicData.projects.some(p => p.id === project.id));
  const response = await call(image.path, {}, false); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await call(`/projects/${project.id}`, {}, false)).status, 200);
  await call(`/api/portfolio/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(value) });
  assert.equal((await call(image.path, {}, false)).status, 401);
  assert.equal((await call(`/projects/${project.id}`, {}, false)).status, 404);
  assert.equal((await call(`/api/portfolio/projects/${project.id}`, { method: 'DELETE' })).status, 200);
});
test('unsafe URLs, unsupported files, oversized uploads, and nonexistent image paths are rejected', async () => {
  for (const body of [Buffer.from('<svg onload="alert(1)"></svg>'), Buffer.from('<html>not an image</html>')]) assert.equal((await call('/api/portfolio/images', { method: 'POST', body })).status, 415);
  assert.equal((await call('/api/portfolio/images', { method: 'POST', body: Buffer.alloc(8 * 1024 * 1024 + 1) })).status, 413);
  for (const change of [{ link: 'javascript:alert(1)' }, { repository: 'https://user:password@example.com' }, { cover: '/data/auth.json' }, { cover: '/media/00000000-0000-0000-0000-000000000000.png' }, { published: 'true' }, { tags: Array(9).fill('x') }]) {
    assert.equal((await call('/api/portfolio/projects', { method: 'POST', body: JSON.stringify({ ...fixture(), ...change }) })).status, 400);
  }
});
test('profile editing publishes only validated fields; portfolio data survives reopening', async () => {
  const { profile } = await (await call('/api/portfolio/manage')).json();
  assert.equal((await call('/api/portfolio/profile', { method: 'PUT', body: JSON.stringify({ ...profile, githubUrl: 'file:///etc/passwd' }) })).status, 400);
  const updated = { ...profile, name: '별빛공방 테스트', tagline: '외부 AI로 만든 소개를 붙여넣을 수 있어요.', secret: 'must-not-save' };
  assert.equal((await call('/api/portfolio/profile', { method: 'PUT', body: JSON.stringify(updated) })).status, 200);
  const publicData = await (await call('/api/portfolio/public', {}, false)).json(); assert.equal(publicData.profile.name, updated.name); assert.equal(publicData.profile.secret, undefined);
  const isolated = join(directory, 'persistence'); let store = createPortfolioStore(isolated);
  const project = store.saveProject(fixture()); store.db.close(); store = createPortfolioStore(isolated);
  assert.equal(store.project(project.id).title, fixture().title); store.db.close();
});

test('resume stays private until explicitly published and persists after reopening', async () => {
  assert.equal((await call('/resume/', {}, false)).status, 401);
  assert.equal((await call('/api/portfolio/resume', {}, false)).status, 401);
  assert.equal((await call('/api/portfolio/resume', { method: 'PUT', body: '{}' }, false)).status, 401);
  const { resume } = await (await call('/api/portfolio/manage')).json();
  const value = { ...resume, headline: '프로젝트 이력서', summary: '직접 입력한 소개', experience: [{ title: '실제 입력 경력', organization: '테스트 기관', period: '2026', description: '입력한 설명' }], education: [], published: false };
  assert.equal((await call('/api/portfolio/resume', { method: 'PUT', body: JSON.stringify(value) })).status, 200);
  assert.equal((await call('/resume/')).status, 200);
  assert.equal((await call('/api/portfolio/resume', { method: 'PUT', body: JSON.stringify({ ...value, published: true }) })).status, 200);
  assert.equal((await call('/resume/', {}, false)).status, 200);
  assert.equal((await (await call('/api/portfolio/resume', {}, false)).json()).resume.summary, value.summary);
  assert.equal((await call('/api/portfolio/resume', { method: 'PUT', headers: { Origin: 'https://other.example' }, body: JSON.stringify(value) })).status, 403);
  assert.equal((await call('/api/portfolio/resume', { method: 'PUT', body: JSON.stringify({ ...value, skills: Array(41).fill('x') }) })).status, 400);
  await call('/api/portfolio/resume', { method: 'PUT', body: JSON.stringify(value) });
  assert.equal((await call('/resume/', {}, false)).status, 401);
  const isolated = join(directory, 'resume-persistence'); let store = createPortfolioStore(isolated);
  store.saveResume(value); store.db.close(); store = createPortfolioStore(isolated); assert.deepEqual(store.resume(), value); store.db.close();
});

test('starter content is seeded once and user edits and deletions survive restart', () => {
  const isolated = join(directory, 'content-migration'); let store = createPortfolioStore(isolated);
  assert.equal(store.projects().length, 3); assert.ok(store.profile().intro.length > 20);
  assert.deepEqual(store.resume().experience, []); assert.deepEqual(store.resume().education, []);
  const id = store.projects()[0].id;
  const custom = { ...store.profile(), tagline: '직접 작성한 문구', intro: '사용자가 수정한 소개' };
  store.saveProfile(custom); store.remove(id); store.db.close(); store = createPortfolioStore(isolated);
  assert.equal(store.profile().tagline, custom.tagline); assert.equal(store.profile().intro, custom.intro);
  assert.equal(store.projects().length, 2); assert.equal(store.project(id), undefined); store.db.close();
});

test('shared navigation assets and portfolio routes are served on the public site', async () => {
  for (const path of ['/shared/shell.css', '/shared/shell.js', '/portfolio/', '/site/editorial.css', '/site/resume.js']) assert.equal((await call(path, {}, false)).status, 200, path);
  const html = await (await call('/')).text(); assert.match(html, /data-section="home"/); assert.match(html, /href="\/resume\/"/);
});
