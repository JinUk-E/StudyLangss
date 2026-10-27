import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const load = async name => (await readFile(new URL(`../public/site/${name}.js`, import.meta.url), 'utf8')).replace(/^\uFEFF?import[^\n]*\n/, '');
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
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get firstChild() { return this.children[0]; }
  querySelectorAll(selector) { const result = []; for (const child of this.children) { if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const profile = { name: '사용자 이름', tagline: '직접 입력한 소개', intro: '사용하며 다듬는 도구', bio: '본문 <script>는 글자입니다.', role: '개발자', email: 'owner@example.com', githubUrl: 'https://github.com/example', contactUrl: '' };
const project = (id, patch = {}) => ({ id, title: `프로젝트 ${id}`, category: '웹', summary: '실제 프로젝트 소개', year: '2026', tags: ['JavaScript'], cover: '', featured: false, ...patch });
async function page(source, data, pathname = '/') {
  const nodes = new Map(), events = {}, changes = [], document = { title: '', querySelectorAll: () => [] };
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  const el = (tag, text, className = '') => { const result = new Element(tag); if (text !== undefined) result.textContent = text; result.className = className; return result; };
  node('#work-title').append(el('text', '만들어 온 것들 '));
  const location = { pathname }, history = { pushState(_, __, href) { changes.push(href); location.pathname = new URL(href, 'https://fixture.test').pathname; }, replaceState(_, __, href) { changes.push(href); location.pathname = new URL(href, 'https://fixture.test').pathname; } };
  const context = vm.createContext({ $: node, el, api: async () => data, external: (label, href, className) => { const link = el('a', label, className); link.href = href; return link; }, image: (src, alt) => { const img = el('img'); img.src = src; img.alt = alt; return img; }, projectDetails: value => el('div', value.title), document, location, history, window: { addEventListener: (type, handler) => { events[type] = handler; }, print() { changes.push('print'); } } });
  await vm.runInContext(`(async () => {${source}\n})()`, context);
  return { node, changes, events, location, document };
}

test('home spotlight prefers an actual featured cover while all projects, filters and modal links remain available', async () => {
  const projects = [project('a', { cover: '/media/a.png' }), project('b', { cover: '/media/b.png', featured: true }), project('c', { category: '게임' })];
  const p = await page(appSource, { profile, projects });
  assert.equal(p.node('#spotlight-project').children[0].href, '/projects/b');
  assert.equal(p.node('#spotlight-project').querySelector('img').src, '/media/b.png');
  assert.equal(p.node('#projects').children.length, 3); assert.equal(p.node('#work-count').textContent, '03');
  assert.equal(p.node('#intro-github').querySelector('a').href, profile.githubUrl);
  assert.equal(p.node('#bio').textContent, profile.bio);
  const filters = p.node('#filters').children; assert.equal(filters.length, 3); filters[2].onclick();
  assert.equal(p.node('#projects').children.length, 1); assert.equal(p.node('#projects').children[0].href, '/projects/c');
  const card = p.node('#projects').children[0]; let prevented = false;
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
  const context = vm.createContext({ URL, document: { createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment') } });
  vm.runInContext(`${source}\nthis.details = projectDetails;`, context);
  const value = { ...project('f'), description: '실제 게임 설명', role: '개발', gallery: [], link: 'https://github.com/JinUk-E/StudyLangss/releases/download/projectf-windows-0.1.0-preview/ProjectF-Windows-0.1.0-preview.zip' };
  const details = context.details(value), anchor = details.querySelector('a');
  assert.match(anchor.textContent, /Windows 빌드 다운로드/); assert.equal(anchor.href, value.link);
  assert.equal(anchor.target, '_blank'); assert.equal(anchor.rel, 'noopener noreferrer'); assert.match(details.textContent, /ZIP을 모두 푼 뒤/);
  assert.equal(context.details({ ...value, link: 'https://example.com/project' }).querySelector('a').textContent, '프로젝트 방문 ↗');
});
