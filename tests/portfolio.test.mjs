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
import previousCareerResume from '../content/career-resume-v1.json' with { type: 'json' };
import previousProjects from '../content/portfolio-projects-v1.json' with { type: 'json' };
import { refreshedAssets, projectRefresh } from '../content/portfolio-latest.mjs';
import { baseballProject, baseballAsset } from '../content/baseball-project.mjs';

let directory, child, base;
const authorization = `Basic ${Buffer.from('portfolio-test:portfolio-test-only-2026').toString('base64')}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
const fixture = () => ({ title: '작업 <script>alert(1)</script>', category: '웹', summary: '소개', description: '상세 설명', role: '개발', year: '2026', tags: ['Node'], link: 'https://example.com', repository: '', cover: '', gallery: [], published: false, featured: false, order: 0 });
// Synchronous migration checks can outlast an idle keep-alive socket between HTTP tests.
const call = (path, options = {}, auth = true) => fetch(base + path, { ...options, headers: { ...(auth ? { Authorization: authorization } : {}), 'Content-Type': 'application/json', Connection: 'close', ...options.headers } });
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'starlight-portfolio-test-'));
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials('portfolio-test', 'portfolio-test-only-2026')), { mode: 0o600 });
  child = spawn(process.execPath, ['portfolio-server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, AUTH_FILE: join(directory, 'auth.json'), AUTH_USERS_FILE: join(directory, 'accounts.sqlite'), PORTFOLIO_DATA_DIR: directory, PUSH_DATA_DIR: join(directory, 'push'), PUSH_CONFIG_FILE: join(directory, 'push', 'missing.json'), PORTFOLIO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (const path of ['/', '/portfolio/', '/resume/', '/api/portfolio/resume', '/site/styles.css', '/site/app.js', '/site/shared.js', '/api/portfolio/public', '/robots.txt']) {
    const response = await call(path, {}, false); assert.equal(response.status, 200, path); assert.equal(response.headers.get('www-authenticate'), null, path);
  }
  const { projects } = await (await call('/api/portfolio/public', {}, false)).json();
  assert.ok(projects.length > 0);
  for (const project of projects) assert.equal((await call(`/projects/${project.id}`, {}, false)).status, 200);
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

test('baseball is publicly listed in portfolio and resume with its detail route, screenshot and repository', async () => {
  const portfolio = await (await call('/api/portfolio/public', {}, false)).json();
  assert.ok(portfolio.projects.some(project => project.id === baseballProject.id && project.repository === baseballProject.repository));
  const resume = await (await call('/api/portfolio/resume', {}, false)).json();
  assert.ok(resume.projects.some(project => project.id === baseballProject.id));
  assert.equal((await call(`/projects/${baseballProject.id}`, {}, false)).status, 200);
  const image = await call(baseballAsset.path, {}, false);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()).subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
});

test('resume defaults public but deliberate private settings remain enforced and persist after reopening', async () => {
  assert.equal((await call('/resume/', {}, false)).status, 200);
  assert.equal((await call('/api/portfolio/resume', {}, false)).status, 200);
  assert.equal((await call('/api/portfolio/resume', { method: 'PUT', body: '{}' }, false)).status, 401);
  const { resume } = await (await call('/api/portfolio/manage')).json();
  const value = { ...resume, headline: '프로젝트 이력서', summary: '직접 입력한 소개', experience: [{ title: '실제 입력 경력', organization: '테스트 기관', period: '2026', description: '입력한 설명' }], education: [], published: false };
  assert.equal((await call('/api/portfolio/resume', { method: 'PUT', body: JSON.stringify(value) })).status, 200);
  assert.equal((await call('/resume/', {}, false)).status, 401);
  assert.equal((await call('/api/portfolio/resume', {}, false)).status, 401);
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
  assert.equal(store.projects().length, starterProjects.length + careerProjects.length); assert.ok(store.profile().intro.length > 20);
  assert.deepEqual(store.profile(), profileInput(careerProfile));
  assert.deepEqual(store.resume(), resumeInput(careerResume));
  assert.equal(store.resume().published, true);
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM images').get().count, careerAssets.length);
  for (const asset of careerAssets) assert.ok(store.image(asset.path).content.length > 0);
  for (const project of store.projects()) for (const path of [project.cover, ...project.gallery].filter(Boolean)) assert.ok(store.publicImage(path));
  const id = careerProjects[0].id, editedId = careerProjects[1].id;
  const custom = { ...store.profile(), tagline: '직접 작성한 문구', intro: '사용자가 수정한 소개' };
  store.saveProfile(custom); store.saveProject({ ...store.project(editedId), title: '직접 수정한 프로젝트' }, editedId);
  store.remove(id); store.db.close(); store = createPortfolioStore(isolated);
  assert.equal(store.profile().tagline, custom.tagline); assert.equal(store.profile().intro, custom.intro);
  assert.equal(store.projects().length, starterProjects.length + careerProjects.length - 1); assert.equal(store.project(id), undefined);
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
  assert.equal(store.projects().length, starterProjects.length + careerProjects.length + 1); store.db.close();
});

test('replacing untouched starter resume text preserves its existing public visibility', () => {
  const isolated = join(directory, 'public-starter-resume'); let store = createPortfolioStore(isolated);
  beforeCareerImport(store, starterProfile, { ...starterResume, published: true }); store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.resume(), resumeInput({ ...careerResume, published: true })); store.db.close();
});

test('readability refresh upgrades the exact previous resume once and preserves public visibility', () => {
  const isolated = join(directory, 'readable-resume'); let store = createPortfolioStore(isolated);
  store.saveResume({ ...previousCareerResume, published: true });
  store.db.prepare('DELETE FROM migrations WHERE id=?').run('resume-readable-copy-v1');
  const previousProjects = store.projects(), previousProfile = store.profile();
  store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.resume(), { ...resumeInput(careerResume), published: true });
  assert.deepEqual(store.projects(), previousProjects); assert.deepEqual(store.profile(), previousProfile);
  const custom = { ...store.resume(), summary: '이후 직접 다듬은 소개', published: false };
  store.saveResume(custom); store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.resume(), custom); store.db.close();
});

test('readability refresh preserves even a single user edit to the previous generated resume', () => {
  for (const [index, patch] of [{ headline: '직접 정한 제목' }, { summary: '새로 작성한 소개', published: true }, { skills: ['Unity', '직접 추가한 기술'] }].entries()) {
    const isolated = join(directory, `custom-readable-resume-${index}`); let store = createPortfolioStore(isolated);
    const custom = resumeInput({ ...previousCareerResume, ...patch });
    store.saveResume(custom); store.db.prepare('DELETE FROM migrations WHERE id=?').run('resume-readable-copy-v1');
    store.db.close(); store = createPortfolioStore(isolated);
    assert.deepEqual(store.resume(), custom); store.db.close();
  }
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
  store = createPortfolioStore(isolated); assert.equal(store.projects().length, starterProjects.length + careerProjects.length); store.db.close();
});

test('imported screenshots follow project visibility and the career resume template requires login', async () => {
  assert.equal((await call('/api/portfolio/career-template', {}, false)).status, 401);
  const template = await call('/api/portfolio/career-template'); assert.equal(template.status, 200);
  assert.deepEqual((await template.json()).resume, careerResume);
  const { projects } = await (await call('/api/portfolio/manage')).json();
  const project = projects.find(value => value.id === careerProjects[1].id);
  assert.ok(project.cover);
  const publicImage = await call(project.cover, {}, false); assert.equal(publicImage.status, 200);
  assert.ok((await publicImage.arrayBuffer()).byteLength > 0);
  assert.equal((await call(`/api/portfolio/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ ...project, published: false }) })).status, 200);
  assert.equal((await call(project.cover, {}, false)).status, 401);
  const privateImage = await call(project.cover); assert.equal(privateImage.status, 200);
  assert.ok((await privateImage.arrayBuffer()).byteLength > 0);
  await call(`/api/portfolio/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) });
});

test('public rollout publishes every existing item once without altering copy, images, IDs or later private choices', () => {
  const isolated = join(directory, 'public-rollout'); let store = createPortfolioStore(isolated);
  const resume = { ...store.resume(), summary: '직접 쓴 소개와 경력은 그대로', published: false };
  store.saveResume(resume);
  const { path } = store.addImage(png);
  const draft = store.saveProject({ ...fixture(), cover: path, gallery: [path] });
  const before = store.projects();
  store.db.prepare('DELETE FROM migrations WHERE id=?').run('public-career-content-v1');
  store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.resume(), { ...resume, published: true });
  assert.deepEqual(store.projects(), before.map(project => ({ ...project, published: true })));
  assert.equal(store.publicImage(path), true);
  assert.deepEqual(Buffer.from(store.image(path).content), png);
  store.saveResume(resume); store.saveProject(draft, draft.id);
  store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.resume(), resume);
  assert.equal(store.project(draft.id).published, false);
  assert.equal(store.publicImage(path), false);
  assert.ok(store.db.prepare('SELECT 1 FROM migrations WHERE id=?').get('public-career-content-v1'));
  store.db.close();
});

test('public rollout rolls back resume and marker if a project cannot be published', () => {
  const isolated = join(directory, 'failed-public-rollout'); let store = createPortfolioStore(isolated);
  const resume = { ...store.resume(), published: false }; store.saveResume(resume);
  const draft = store.saveProject(fixture());
  store.db.prepare('DELETE FROM migrations WHERE id=?').run('public-career-content-v1');
  store.db.exec(`CREATE TRIGGER fail_public_project BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'injected public rollout failure'); END`);
  store.db.close(); assert.throws(() => createPortfolioStore(isolated), /injected public rollout failure/);
  const db = new DatabaseSync(join(isolated, 'portfolio.sqlite'));
  assert.deepEqual(JSON.parse(db.prepare('SELECT json FROM documents WHERE id=?').get('resume').json), resume);
  assert.equal(JSON.parse(db.prepare('SELECT json FROM projects WHERE id=?').get(draft.id).json).published, false);
  assert.equal(db.prepare('SELECT 1 FROM migrations WHERE id=?').get('public-career-content-v1'), undefined);
  db.exec('DROP TRIGGER fail_public_project'); db.close();
  store = createPortfolioStore(isolated); assert.equal(store.resume().published, true); assert.equal(store.project(draft.id).published, true); store.db.close();
});

function beforeScreenRefresh(store) {
  for (const { id, ...project } of previousProjects) store.saveProject(project, id);
  for (const asset of refreshedAssets) store.db.prepare('DELETE FROM images WHERE path=?').run(asset.path);
  store.db.prepare('DELETE FROM migrations WHERE id=?').run('portfolio-screens-20261023-v1');
}

test('latest screens refresh previous defaults once while preserving edits, private flags, custom images and deleted projects', () => {
  const isolated = join(directory, 'latest-screens'); let store = createPortfolioStore(isolated);
  beforeScreenRefresh(store);
  const ids = previousProjects.map(project => project.id), editedId = ids[1], deletedId = ids[3];
  const { path } = store.addImage(png);
  store.saveProject({ ...store.project(editedId), summary: '직접 다듬은 소개', cover: path, gallery: [path], published: false, featured: false, order: 800 }, editedId);
  store.remove(deletedId);
  const extra = store.project(store.saveProject(fixture()).id);
  const customResume = store.saveResume({ ...store.resume(), summary: '직접 쓴 이력서', published: false });
  const profile = store.profile();
  store.db.close(); store = createPortfolioStore(isolated);
  for (const id of ids.filter(id => id !== deletedId && id !== editedId)) {
    const current = store.project(id);
    for (const [field, value] of Object.entries(projectRefresh[id])) assert.deepEqual(current[field], value, `${id}/${field}`);
    assert.equal(store.publicImage(current.cover), true);
  }
  const edited = store.project(editedId);
  assert.equal(edited.summary, '직접 다듬은 소개'); assert.equal(edited.cover, path); assert.deepEqual(edited.gallery, [path]);
  assert.equal(edited.published, false); assert.equal(edited.featured, false); assert.equal(edited.order, 800);
  assert.equal(edited.description, projectRefresh[editedId].description);
  assert.equal(store.project(deletedId), undefined); assert.deepEqual(store.project(extra.id), extra);
  assert.deepEqual(store.resume(), customResume); assert.deepEqual(store.profile(), profile);
  store.saveProject({ ...edited, description: '갱신 후 편집' }, editedId);
  const future = store.project(editedId), projects = store.projects();
  store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.project(editedId), future); assert.deepEqual(store.projects(), projects); store.db.close();
});

test('screen refresh rolls back image imports, earlier project updates and marker together on failure', () => {
  const isolated = join(directory, 'failed-screen-refresh'); let store = createPortfolioStore(isolated);
  beforeScreenRefresh(store);
  const previous = store.projects(), imageCount = store.db.prepare('SELECT COUNT(*) count FROM images').get().count;
  store.db.exec(`CREATE TRIGGER fail_screen_update BEFORE UPDATE ON projects WHEN NEW.id='${previousProjects[1].id}' BEGIN SELECT RAISE(ABORT, 'injected screen refresh failure'); END`);
  store.db.close(); assert.throws(() => createPortfolioStore(isolated), /injected screen refresh failure/);
  const db = new DatabaseSync(join(isolated, 'portfolio.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) count FROM images').get().count, imageCount);
  assert.equal(db.prepare('SELECT 1 FROM migrations WHERE id=?').get('portfolio-screens-20261023-v1'), undefined);
  for (const project of previous) assert.deepEqual(JSON.parse(db.prepare('SELECT json FROM projects WHERE id=?').get(project.id).json), projectInput(project, () => true));
  db.exec('DROP TRIGGER fail_screen_update'); db.close();
  store = createPortfolioStore(isolated); assert.ok(store.projects().every(project => project.cover)); store.db.close();
});

const previousCareerIntro = 'Unity와 C#으로 게임을 만들고, 출시 이후에도 개발을 이어 갈 수 있는 기반을 다듬습니다. SDK 연동, 모바일 출시, 빌드 자동화와 런타임 안정성을 네 개의 프로젝트에 담았습니다.';
function beforeBaseballAddition(store) {
  store.remove(baseballProject.id);
  store.db.prepare('DELETE FROM images WHERE path=?').run(baseballAsset.path);
  store.db.prepare('DELETE FROM migrations WHERE id=?').run('baseball-life-20261024-v1');
}

test('baseball addition upgrades an existing installation once without changing other projects or resurrecting a later deletion', () => {
  const isolated = join(directory, 'baseball-addition'); let store = createPortfolioStore(isolated);
  beforeBaseballAddition(store);
  store.saveProfile({ ...store.profile(), intro: previousCareerIntro });
  const projects = store.projects(), resume = store.resume();
  store.db.close(); store = createPortfolioStore(isolated);
  for (const project of projects) assert.deepEqual(store.project(project.id), project);
  assert.deepEqual(projectInput(store.project(baseballProject.id), () => true), projectInput(baseballProject, () => true));
  assert.ok(store.publicImage(baseballProject.cover)); assert.ok(store.image(baseballProject.cover).content.length > 0);
  assert.equal(store.profile().intro, careerProfile.intro); assert.deepEqual(store.resume(), resume);
  store.saveProject({ ...store.project(baseballProject.id), title: '직접 수정한 야구게임', published: false, order: 900 }, baseballProject.id);
  const edited = store.project(baseballProject.id);
  store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.project(baseballProject.id), edited); assert.equal(store.publicImage(baseballProject.cover), false);
  store.remove(baseballProject.id); store.db.close(); store = createPortfolioStore(isolated);
  assert.equal(store.project(baseballProject.id), undefined); assert.equal(store.projects().length, projects.length); store.db.close();
});

test('baseball addition preserves an existing custom entry and manually edited home introduction', () => {
  const isolated = join(directory, 'baseball-custom'); let store = createPortfolioStore(isolated);
  beforeBaseballAddition(store);
  store.saveProject({ ...baseballProject, summary: '직접 쓴 설명', cover: '', published: false, featured: false }, baseballProject.id);
  store.saveProfile({ ...store.profile(), intro: '직접 쓴 홈 소개' });
  const project = store.project(baseballProject.id), profile = store.profile();
  store.db.close(); store = createPortfolioStore(isolated);
  assert.deepEqual(store.project(baseballProject.id), project); assert.deepEqual(store.profile(), profile); store.db.close();
});

test('baseball addition rolls back image, project and profile if its migration marker cannot be saved', () => {
  const isolated = join(directory, 'baseball-rollback'); let store = createPortfolioStore(isolated);
  beforeBaseballAddition(store);
  store.saveProfile({ ...store.profile(), intro: previousCareerIntro });
  const profile = store.profile(), projects = store.projects();
  store.db.exec("CREATE TRIGGER fail_baseball_marker BEFORE INSERT ON migrations WHEN NEW.id='baseball-life-20261024-v1' BEGIN SELECT RAISE(ABORT, 'injected baseball failure'); END");
  store.db.close(); assert.throws(() => createPortfolioStore(isolated), /injected baseball failure/);
  const db = new DatabaseSync(join(isolated, 'portfolio.sqlite'));
  assert.equal(db.prepare('SELECT 1 FROM migrations WHERE id=?').get('baseball-life-20261024-v1'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM images WHERE path=?').get(baseballAsset.path), undefined);
  assert.equal(db.prepare('SELECT 1 FROM projects WHERE id=?').get(baseballProject.id), undefined);
  assert.deepEqual(JSON.parse(db.prepare('SELECT json FROM profile WHERE id=1').get().json), profile);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM projects').get().count, projects.length);
  db.exec('DROP TRIGGER fail_baseball_marker'); db.close();
  store = createPortfolioStore(isolated); assert.ok(store.project(baseballProject.id)); store.db.close();
});

test('shared navigation assets and portfolio routes are served on the public site', async () => {
  for (const path of ['/shared/shell.css', '/shared/shell.js', '/portfolio/', '/site/editorial.css', '/site/resume.js']) assert.equal((await call(path, {}, false)).status, 200, path);
  const html = await (await call('/')).text(); assert.match(html, /data-section="home"/); assert.match(html, /href="\/resume\/"/);
});
