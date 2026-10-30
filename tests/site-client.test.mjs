import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webGames, webGameForProject, webPlayPath } from '../content/web-games.mjs';
import { portfolioGroups, projectGroup } from '../content/portfolio-groups.mjs';

const load = async name => (await readFile(new URL(`../public/site/${name}.js`, import.meta.url), 'utf8')).replace(/^\uFEFF?import[^\n]*\n/gm, '');
const appSource = await load('app'), resumeSource = await load('resume');
class Element {
  children = []; attributes = {}; className = ''; hidden = false; open = false; _text = '';
  constructor(tag = 'div') { this.tagName = tag; this.classList = { add: value => { this.className += ` ${value}`; }, toggle: (value, enabled) => { const classes = new Set(this.className.split(' ').filter(Boolean)); if (enabled) classes.add(value); else classes.delete(value); this.className = [...classes].join(' '); } }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this[`on${name}`] = handler; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get firstChild() { return this.children[0]; }
  querySelectorAll(selector) { const result = []; for (const child of this.children) { if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const profile = { name: '사용자 이름', tagline: '직접 입력한 소개', intro: '사용하며 다듬는 도구', bio: '본문 <script>는 글자입니다.', role: '개발자', email: 'owner@example.com', githubUrl: 'https://github.com/example', contactUrl: '' };
const project = (id, patch = {}) => ({ id, title: `프로젝트 ${id}`, category: '웹', summary: '실제 프로젝트 소개', year: '2026', tags: ['JavaScript'], cover: '', featured: false, published: true, ...patch });
async function page(source, data, pathname = '/') {
  const nodes = new Map(), events = {}, changes = [], document = { title: '', querySelectorAll: () => [] };
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  const el = (tag, text, className = '') => { const result = new Element(tag); if (text !== undefined) result.textContent = text; result.className = className; return result; };
  node('#work-title').append(el('text', '만들어 온 것들 '));
  const location = { pathname }, history = { pushState(_, __, href) { changes.push(href); location.pathname = new URL(href, 'https://fixture.test').pathname; }, replaceState(_, __, href) { changes.push(href); location.pathname = new URL(href, 'https://fixture.test').pathname; } };
  const context = vm.createContext({ portfolioGroups, projectGroup, webGameForProject, webPlayPath, $: node, el, api: async () => data, external: (label, href, className) => { const link = el('a', label, className); link.href = href; return link; }, image: (src, alt) => { const img = el('img'); img.src = src; img.alt = alt; return img; }, projectDetails: value => el('div', value.title), document, location, history, window: { addEventListener: (type, handler) => { events[type] = handler; }, print() { changes.push('print'); } } });
  await vm.runInContext(`(async () => {${source}\n})()`, context);
  return { node, changes, events, location, document };
}

test('home spotlight prefers an actual featured cover while all projects, filters and modal links remain available', async () => {
  const projects = [project('a', { cover: '/media/a.png', group: 'web' }), project('b', { cover: '/media/b.png', featured: true, group: 'web' }), project('c', { category: '전술 포격', group: 'games' })];
  const p = await page(appSource, { profile, projects });
  assert.equal(p.node('#spotlight-project').children[0].href, '/projects/b');
  assert.equal(p.node('#spotlight-project').querySelector('img').src, '/media/b.png');
  assert.equal(p.node('#projects').querySelectorAll('.project-card').length, 3); assert.equal(p.node('#work-count').textContent, '03');
  assert.equal(p.node('#intro-github').querySelector('a').href, profile.githubUrl);
  assert.equal(p.node('#bio').textContent, profile.bio);
  const filters = p.node('#filters').children; assert.equal(filters.length, 3); filters[1].onclick();
  assert.equal(p.node('#projects').querySelectorAll('.project-card').length, 1);
  const card = p.node('#projects').querySelector('.project-card'); assert.equal(card.href, '/projects/c'); let prevented = false;
  card.onclick({ ctrlKey: true, preventDefault() { prevented = true; } }); assert.equal(prevented, false); assert.equal(p.changes.length, 0);
  card.onclick({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(p.node('#project-dialog').open, true); assert.equal(p.location.pathname, '/projects/c');
  p.node('#close-detail').onclick(); assert.equal(p.node('#project-dialog').open, false); assert.equal(p.location.pathname, '/');
});

test('direct project routes retain portfolio context and do not expose an invented feature when no cover exists', async () => {
  const projects = [project('a', { featured: true })];
  const p = await page(appSource, { profile: { ...profile, githubUrl: '' }, projects }, '/projects/a');
  assert.equal(p.node('#intro').hidden, true); assert.equal(p.node('#about').hidden, true); assert.equal(p.node('#project-dialog').open, true);
  assert.equal(p.node('#spotlight-project').children.length, 0); assert.equal(p.node('#intro-github').children.length, 0);
  p.node('#close-detail').onclick(); assert.equal(p.location.pathname, '/portfolio/');
});

test('public group counts, unclassified projects, load-more focus and group state survive detail navigation', async () => {
  const projects = [
    ...Array.from({ length: 7 }, (_, index) => project(`game-${index}`, { group: 'games' })),
    project('8d47aa00-1000-4000-8000-000000000001', { title: '바뀐 학습 이름', category: '직접 쓴 장르' }),
    project('page', { group: 'web' }), project('unclassified'),
    project('private', { group: 'tools', published: false, title: '비공개 도구 이름' })
  ];
  const p = await page(appSource, { profile, projects }, '/portfolio/');
  const filters = p.node('#filters').children;
  assert.deepEqual(filters.map(button => button.textContent), ['전체 10', '게임 7', '학습 1', '웹페이지 1', '기타 1']);
  assert.equal(p.node('#work-count').textContent, '10'); assert.ok(!p.node('#projects').textContent.includes('비공개 도구 이름'));
  assert.equal(p.node('#projects').querySelectorAll('.project-card').length, 9);
  filters[1].onclick();
  assert.equal(p.node('#projects').querySelectorAll('.project-card').length, 6);
  p.node('#projects').querySelector('.work-more').onclick();
  const cards = p.node('#projects').querySelectorAll('.project-card');
  assert.deepEqual(cards.map(card => card.href), projects.slice(0, 7).map(item => `/projects/${item.id}`));
  assert.equal(cards[6].focused, true); assert.equal(p.node('#projects').querySelector('.work-more'), null);
  filters[4].onclick(); assert.equal(p.node('#projects').querySelector('.project-card').href, '/projects/unclassified');
  filters[1].onclick(); assert.equal(p.node('#projects').querySelectorAll('.project-card').length, 7);
  p.node('#projects').querySelector('.project-card').onclick({ preventDefault() {} });
  assert.equal(p.node('#project-dialog').open, true);
  p.location.pathname = '/portfolio/'; p.events.popstate(); assert.equal(p.node('#project-dialog').open, false);
  assert.equal(p.node('#projects').querySelectorAll('.project-card').length, 7);
  filters[2].onclick(); assert.ok(p.node('#projects').textContent.includes('바뀐 학습 이름'));
});

test('editor chooses the legacy group independently of genre and submits an explicit owner selection', async () => {
  const source = (await load('admin')).split("$('#new-project').onclick")[0];
  const nodes = new Map(), node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  const form = node('#project-form'); form.reset = () => {};
  form.elements = Object.fromEntries(['title', 'category', 'year', 'summary', 'description', 'role', 'link', 'repository', 'order', 'tags', 'published', 'featured', 'group'].map(name => [name, new Element('input')]));
  const context = vm.createContext({ $: node, portfolioGroups, projectGroup, el: (tag, text) => { const value = new Element(tag); if (text !== undefined) value.textContent = text; return value; }, FormData: class { constructor(value) { this.entries = Object.entries(value.elements).map(([key, field]) => [key, field.value]); } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } } });
  vm.runInContext(`${source}\nthis.edit = openEditor; this.value = projectValue;`, context);
  context.edit({ ...project(webGames[0].projectId), description: '', role: '', gallery: [], link: '', repository: '', order: 2, category: '직접 입력한 세부 장르' });
  assert.equal(form.elements.group.value, 'games'); assert.equal(form.elements.category.value, '직접 입력한 세부 장르');
  form.elements.group.value = 'tools';
  const value = context.value(); assert.equal(value.group, 'tools'); assert.equal(value.category, '직접 입력한 세부 장르');
  context.edit(); assert.equal(form.elements.group.value, 'other');
});

test('resume preserves plain paragraphs, renders only bullet lines as safe semantic lists, and retains private notice and links', async () => {
  const resume = { published: false, headline: '작성한 이력서', summary: '작성한 소개', skills: ['Unity', 'C#'], experience: [{ title: '클라이언트 개발', organization: '직접 입력한 회사', period: '2020 – 현재', description: '직접 작성한 첫 문단\n문단의 둘째 줄\n\n• 첫 작업 <script>\n- 두 번째 작업\n일반 문단으로 이어집니다.' }], education: [{ title: '학사', organization: '직접 입력한 학교', period: '2015', description: '일반 문단입니다.' }] };
  const p = await page(resumeSource, { resume, profile, projects: [project('a')] }, '/resume/');
  const document = p.node('#resume-document'), experience = document.querySelector('.resume-experience'), entry = experience.querySelector('.resume-entry');
  assert.match(document.querySelector('.privacy-note').textContent, /비공개/);
  assert.deepEqual(entry.querySelectorAll('p').map(node => node.textContent), ['직접 작성한 첫 문단\n문단의 둘째 줄', '일반 문단으로 이어집니다.']);
  assert.deepEqual(entry.querySelectorAll('li').map(node => node.textContent), ['첫 작업 <script>', '두 번째 작업']);
  assert.equal(entry.querySelectorAll('script').length, 0); assert.equal(document.querySelectorAll('.resume-skills').length, 1); assert.equal(document.querySelectorAll('.resume-education').length, 1);
  assert.equal(document.querySelector('.resume-projects').querySelector('a').href, '/projects/a');
  p.node('#print-resume').onclick(); assert.equal(p.changes.at(-1), 'print');
});

test('empty optional resume columns collapse without adding fabricated experience, skills, or education', async () => {
  const resume = { published: true, headline: '내 이력서', summary: '소개', skills: [], experience: [], education: [] };
  const p = await page(resumeSource, { resume, profile, projects: [] }, '/resume/');
  const document = p.node('#resume-document');
  assert.equal(document.querySelectorAll('.privacy-note').length, 0); assert.equal(document.querySelector('.resume-aside').hidden, true);
  assert.ok(document.querySelector('.resume-layout').className.includes('resume-layout-single')); assert.equal(document.querySelectorAll('.resume-entry').length, 0);
});

test('project details offer the Windows ZIP as a download while preserving normal website links and safe new-tab behavior', async () => {
  const source = (await load('shared')).replace(/^export /gm, '');
  const context = vm.createContext({ URL, webGameForProject, webPlayPath, document: { createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment') } });
  vm.runInContext(`${source}\nthis.details = projectDetails;`, context);
  const value = { ...project('f'), description: '실제 게임 설명', role: '개발', gallery: [], link: 'https://github.com/JinUk-E/StudyLangss/releases/download/projectf-windows-0.1.0-preview/ProjectF-Windows-0.1.0-preview.zip' };
  const details = context.details(value), anchor = details.querySelector('a');
  assert.match(anchor.textContent, /Windows 빌드 다운로드/); assert.equal(anchor.href, value.link);
  assert.equal(anchor.target, '_blank'); assert.equal(anchor.rel, 'noopener noreferrer'); assert.match(details.textContent, /ZIP을 모두 푼 뒤/);
  assert.equal(context.details({ ...value, link: 'https://example.com/project' }).querySelector('a').textContent, '프로젝트 방문 ↗');
});

test('verified games have a play badge and an internal player action while ordinary projects keep their existing flow', async () => {
  const projects = [...webGames.map(game => project(game.projectId)), project('not-published-as-web')];
  const p = await page(appSource, { profile, projects });
  assert.equal(p.node('#projects').querySelectorAll('.project-web-badge').length, 2);
  const source = (await load('shared')).replace(/^export /gm, '');
  const context = vm.createContext({ URL, webGameForProject, webPlayPath, document: { createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment') } });
  vm.runInContext(`${source}\nthis.details = projectDetails;`, context);
  for (const game of webGames) {
    const details = context.details({ ...project(game.projectId), description: '원래 소개', gallery: [], link: 'https://example.com/owner-link' });
    const play = details.querySelector('.project-play-callout'); assert.ok(play);
    assert.equal(play.querySelector('a').href, webPlayPath(game));
    assert.equal(play.querySelectorAll('a')[1].href, game.url); assert.equal(play.querySelectorAll('a')[1].rel, 'noopener noreferrer');
    assert.ok(details.querySelectorAll('a').some(link => link.href === 'https://example.com/owner-link'));
  }
  assert.equal(context.details({ ...project('ordinary'), description: '', gallery: [], link: '' }).querySelector('.project-play-callout'), null);
});
