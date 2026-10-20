import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCredentials } from '../lib/auth.mjs';
import { createPortfolioStore, defaultProfile, profileInput, projectInput, resumeInput } from '../lib/portfolio-store.mjs';
import { starterProfile, starterProjects, starterResume } from '../content/portfolio-defaults.mjs';
import { careerProfile, careerResume, careerProjects, careerAssets } from '../content/career-content.mjs';

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

test('starter and career content is seeded once and user edits and deletions survive restart', () => {
  const isolated = join(directory, 'content-migration'); let store = createPortfolioStore(isolated);
  assert.equal(store.projects().length, 7); assert.ok(store.profile().intro.length > 20);
  assert.deepEqual(store.profile(), profileInput(careerProfile));
  assert.deepEqual(store.resume(), resumeInput(careerResume));
  assert.equal(store.resume().published, false);
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM images').get().count, 5);
  for (const asset of careerAssets) { assert.ok(store.image(asset.path).content.length > 0); assert.ok(store.publicImage(asset.path)); }
  const id = careerProjects[0].id, editedId = careerProjects[1].id;
  const custom = { ...store.profile(), tagline: '직접 작성한 문구', intro: '사용자가 수정한 소개' };
  store.saveProfile(custom); store.saveProject({ ...store.project(editedId), title: '직접 수정한 프로젝트' }, editedId);
  store.remove(id); store.db.close(); store = createPortfolioStore(isolated);
  assert.equal(store.profile().tagline, custom.tagline); assert.equal(store.profile().intro, custom.intro);
  assert.equal(store.projects().length, 6); assert.equal(store.project(id), undefined);
  assert.equal(store.project(editedId).title, '직접 수정한 프로젝트'); store.db.close();
});

// Construct the exact data state of an installation before career-import-v1.
function beforeCareerImport(store, profile = starterProfile, resume = starterResume) {
  store.db.prepare('DELETE FROM migrations WHERE id=?').run('career-import-v1');
  for (const project of careerProjects) store.remove(project.id);
  for (const asset of careerAssets) store.db.prepare('DELETE FROM images WHERE path=?').run(asset.path);
  store.db.prepare('UPDATE profile SET json=? WHERE id=1').run(JSON.stringify(profile));
  store.db.prepare('UPDATE documents SET json=? WHERE id=?').run(JSON.stringify(resume), 'resume');
}

test('career import upgrades previous default text and preserves the existing three web projects', () => {
  const isolated = join(directory, 'previous-career-content'); let store = createPortfolioStore(isolated);
  beforeCareerImport(store, { ...defaultProfile, intro: starterProfile.intro });
  const originals = store.projects(); store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.profile(), profileInput(careerProfile));
  assert.deepEqual(store.resume(), resumeInput(careerResume));
  for (const project of originals) assert.deepEqual(store.project(project.id), project);
  for (const project of careerProjects) assert.deepEqual(({ ...store.project(project.id), updatedAt: undefined }), { id: project.id, ...projectInput(project, () => true), updatedAt: undefined });
  assert.equal(store.projects().length, starterProjects.length + careerProjects.length);
  assert.ok(store.db.prepare('SELECT 1 FROM migrations WHERE id=?').get('career-import-v1')); store.db.close();
});

test('career import preserves custom profile fields, custom resume, and projects already using a career ID', () => {
  const isolated = join(directory, 'custom-career-content'); let store = createPortfolioStore(isolated);
  const customProfile = profileInput({ ...starterProfile, name: '사용자 이름', intro: '사용자가 쓴 홈 소개', email: 'custom@example.com', bio: '직접 작성한 소개' });
  const customResume = resumeInput({ ...starterResume, summary: '직접 작성한 이력서', published: true });
  beforeCareerImport(store, customProfile, customResume);
  const customProject = store.saveProject(fixture(), careerProjects[0].id);
  const otherProject = store.saveProject(fixture()); store.db.close(); store = createPortfolioStore(isolated);
  for (const key of ['name', 'intro', 'email', 'bio']) assert.equal(store.profile()[key], customProfile[key]);
  assert.equal(store.profile().role, careerProfile.role);
  assert.deepEqual(store.resume(), customResume);
  assert.equal(store.project(customProject.id).title, customProject.title);
  assert.equal(store.project(otherProject.id).title, otherProject.title);
  assert.equal(store.projects().length, 8); store.db.close();
});

test('replacing untouched starter resume text preserves its existing public visibility', () => {
  const isolated = join(directory, 'public-starter-resume'); let store = createPortfolioStore(isolated);
  beforeCareerImport(store, starterProfile, { ...starterResume, published: true }); store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.resume(), resumeInput({ ...careerResume, published: true })); store.db.close();
});

test('career migration rolls back profile, resume, images, projects, and marker if its final project fails', () => {
  const isolated = join(directory, 'failed-career-content'); let store = createPortfolioStore(isolated);
  beforeCareerImport(store);
  store.db.exec(`CREATE TRIGGER fail_career_project BEFORE INSERT ON projects WHEN NEW.id='${careerProjects.at(-1).id}' BEGIN SELECT RAISE(ABORT, 'injected career import failure'); END`);
  store.db.close();
  assert.throws(() => createPortfolioStore(isolated), /injected career import failure/);
  const db = new DatabaseSync(join(isolated, 'portfolio.sqlite'));
  assert.deepEqual(JSON.parse(db.prepare('SELECT json FROM profile WHERE id=1').get().json), starterProfile);
  assert.deepEqual(JSON.parse(db.prepare('SELECT json FROM documents WHERE id=?').get('resume').json), starterResume);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM images').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM projects').get().count, 3);
  assert.equal(db.prepare('SELECT 1 FROM migrations WHERE id=?').get('career-import-v1'), undefined);
  db.exec('DROP TRIGGER fail_career_project'); db.close();
  store = createPortfolioStore(isolated); assert.equal(store.projects().length, 7); store.db.close();
});

test('imported screenshots follow project visibility and the career resume template requires login', async () => {
  assert.equal((await call('/api/portfolio/career-template', {}, false)).status, 401);
  const template = await call('/api/portfolio/career-template'); assert.equal(template.status, 200);
  assert.deepEqual((await template.json()).resume, careerResume);
  const { projects } = await (await call('/api/portfolio/manage')).json();
  const project = projects.find(value => value.id === careerProjects[1].id);
  assert.ok(project.cover); assert.equal((await call(project.cover, {}, false)).status, 200);
  assert.equal((await call(`/api/portfolio/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ ...project, published: false }) })).status, 200);
  assert.equal((await call(project.cover, {}, false)).status, 401);
  assert.equal((await call(project.cover)).status, 200);
  await call(`/api/portfolio/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) });
});

test('shared navigation assets and portfolio routes are served on the public site', async () => {
  for (const path of ['/shared/shell.css', '/shared/shell.js', '/portfolio/', '/site/editorial.css', '/site/resume.js']) assert.equal((await call(path, {}, false)).status, 200, path);
  const html = await (await call('/')).text(); assert.match(html, /data-section="home"/); assert.match(html, /href="\/resume\/"/);
});
