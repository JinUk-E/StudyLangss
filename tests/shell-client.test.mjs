import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../public/shared/shell.js', import.meta.url), 'utf8')).replace(/^\uFEFF?import[^\n]*\n/, '');
const hintKey = 'starlight.session-area';
const owner = { id: 'owner', username: 'owner', isAdmin: true, permissions: ['study', 'chat'] };
const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
class Element {
  children = []; dataset = {}; attributes = {}; className = ''; textContent = ''; hidden = false;
  listeners = new Map();
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  constructor(tag = 'div') { this.tagName = tag; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  insertBefore(child, next) { child.parent = this; const position = this.children.indexOf(next); this.children.splice(position < 0 ? this.children.length : position, 0, child); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
  set innerHTML(html) {
    if (!html.includes('global-brand')) return;
    const brand = new Element('a'); brand.className = 'global-brand'; this.append(brand);
    for (const section of ['home', 'chat', 'study']) { const anchor = new Element('a'); anchor.dataset.sectionTab = section; this.append(anchor); }
    for (const className of ['account-identity', 'account-entry']) { const node = new Element('span'); node.className = className; this.append(node); }
    const name = new Element('span'); name.attributes['data-site-name'] = ''; this.append(name);
  }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : selector.startsWith('[data-section-tab=') ? node.dataset.sectionTab === selector.match(/"([^"]+)"/)[1] : selector === '[data-site-name]' ? Object.hasOwn(node.attributes, 'data-site-name') : node.tagName === selector;
    const result = [];
    for (const child of this.children) { if (matches(child)) result.push(child); result.push(...child.querySelectorAll(selector)); }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function page({ section = 'home', pathname = '/', search = '', hash = '', storage = new Map(), rejectStorage = false, omitStorage = false, respond = () => ({ user: null }) } = {}) {
  const body = new Element('body'); body.dataset.section = section;
  const requests = [], events = [], timers = new Map(); let nextTimer = 0;
  const scrolls = [];
  const context = { document: { body, createElement: tag => new Element(tag) }, location: { pathname, search, hash }, URLSearchParams, AbortController,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { dispatchEvent(event) { events.push(event); }, scrollTo(options) { scrolls.push(options); } },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    async fetch(path, options = {}) {
      requests.push({ path, ...options });
      if (path === '/api/portfolio/public') return { ok: true, json: async () => ({ profile: { name: '별빛공방' } }) };
      const result = await respond(path, options);
      return { ok: result.ok !== false, json: async () => result };
    }
  };
  if (rejectStorage) Object.defineProperty(context, 'sessionStorage', { get() { throw new Error('storage denied'); } });
  else if (!omitStorage) context.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  vm.runInNewContext(source, context);
  return { body, requests, events, timers, storage, scrolls, top: body.children[0],
    clickBrand(options = {}) { const event = { button: 0, ...options, preventDefault() { this.defaultPrevented = true; } }; body.children[0].querySelector('.global-brand').listeners.get('click')(event); return Boolean(event.defaultPrevented); },
    timer(delay) { const pending = [...timers].filter(([, value]) => value.delay === delay); for (const [id, value] of pending) { timers.delete(id); value.callback(); } },
    get user() { return events.at(-1)?.detail.user; },
    links() { return body.children.find(node => node.className === 'section-sidebar')?.querySelectorAll('a').map(node => node.href) || []; },
  };
}

test('repeated home brand clicks retain the shell without reloading or repeating session requests', async () => {
  const p = page(); await settle(); const requests = p.requests.length;
  for (let index = 0; index < 20; index++) assert.equal(p.clickBrand(), true);
  assert.equal(p.requests.length, requests); assert.equal(p.scrolls.length, 20);
  assert.ok(p.scrolls.every(scroll => scroll.top === 0));
  assert.equal(p.body.children.filter(node => node.className === 'global-header').length, 1);
  assert.ok(p.links().includes('/portfolio/'));
});

test('brand still navigates from other pages, clears URL state, and supports new tabs', async () => {
  for (const options of [{ pathname: '/portfolio/' }, { pathname: '/chat/' }, { pathname: '/admin/' }, { search: '?preview=1' }, { hash: '#work' }]) {
    const p = page(options); await settle(); assert.equal(p.clickBrand(), false); assert.equal(p.scrolls.length, 0);
  }
  const p = page(); await settle();
  for (const options of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) assert.equal(p.clickBrand(options), false);
  assert.equal(p.scrolls.length, 0);
});

test('private chat verifies me and stores only the area; public home restores server-verified tabs and admin menus', async () => {
  const storage = new Map();
  const chat = page({ section: 'chat', pathname: '/chat/', storage, respond: path => ({ user: path === '/api/chat/me' ? owner : null }) }); await settle();
  assert.equal(chat.user.id, 'owner'); assert.deepEqual([...storage], [[hintKey, 'chat']]);
  assert.deepEqual(chat.requests.filter(item => item.path !== '/api/portfolio/public').map(item => item.path), ['/api/chat/me']);
  const home = page({ storage, respond: path => ({ user: path === '/api/chat/session' ? owner : null }) }); await settle();
  assert.equal(home.body.dataset.accountRole, 'admin'); assert.equal(home.body.dataset.accountChat, 'true'); assert.equal(home.body.dataset.accountStudy, 'true');
  assert.ok(home.links().includes('/admin/')); assert.ok(home.links().includes('/accounts/')); assert.ok(home.links().includes('/admin/system/'));
  const lookups = home.requests.filter(item => item.path !== '/api/portfolio/public'); assert.equal(lookups[0].path, '/api/chat/session'); assert.equal(lookups.length, 3);
  for (const item of lookups) { assert.equal(item.credentials, 'same-origin'); assert.equal(item.cache, 'no-store'); }
  assert.equal(home.timers.size, 0);
});

test('public portfolio and resume preserve only permissions returned by study-only or chat-only accounts', async () => {
  for (const [area, pathname] of [['study', '/portfolio/'], ['chat', '/resume/'], ['study', '/projects/example']]) {
    const user = { id: 'member', username: 'learner', isAdmin: false, permissions: [area] };
    const p = page({ pathname, respond: path => ({ user: path === (area === 'study' ? '/api/session' : '/api/chat/session') ? user : null }) }); await settle();
    assert.equal(p.body.dataset.accountRole, 'member'); assert.equal(p.body.dataset.accountStudy, String(area === 'study')); assert.equal(p.body.dataset.accountChat, String(area === 'chat'));
    assert.equal(p.links().includes('/admin/'), false); assert.equal(p.links().includes('/accounts/'), false);
    assert.equal(p.storage.get(hintKey), area); assert.equal(p.user.id, 'member');
  }
});

test('anonymous responses and stale or forged storage hints cannot restore revoked privileges', async () => {
  for (const hint of ['chat', JSON.stringify(owner), 'admin']) {
    const storage = new Map([[hintKey, hint], ['starlight.role', 'admin']]);
    const p = page({ storage }); await settle();
    assert.equal(p.user, null); assert.equal(p.body.dataset.accountRole, 'guest'); assert.equal(p.body.dataset.accountChat, 'false'); assert.equal(p.body.dataset.accountStudy, 'false');
    assert.equal(p.top.querySelector('.account-identity').textContent, '공개 페이지'); assert.equal(p.top.querySelector('.account-entry').hidden, false);
    assert.equal(p.links().includes('/admin/'), false); assert.equal(storage.has(hintKey), false);
    assert.equal(p.requests.some(item => /\/me$/.test(item.path)), false);
  }
});

test('blocked or missing storage and one failed service do not prevent another verified account', async () => {
  for (const options of [{ rejectStorage: true }, { omitStorage: true }, {}]) {
    const p = page({ ...options, respond(path) { if (path === '/api/portfolio/session') throw new Error('offline'); return { user: path === '/api/chat/session' ? owner : null }; } }); await settle();
    assert.equal(p.user.id, 'owner'); assert.equal(p.body.dataset.accountRole, 'admin'); assert.equal(p.timers.size, 0);
  }
});

test('the hinted verified account wins over another service with a different cached principal', async () => {
  const member = { id: 'study-member', username: 'learner', isAdmin: false, permissions: ['study'] };
  const p = page({ storage: new Map([[hintKey, 'study']]), respond: path => ({ user: path === '/api/session' ? member : owner }) }); await settle();
  assert.equal(p.user.id, 'study-member'); assert.equal(p.body.dataset.accountRole, 'member'); assert.equal(p.body.dataset.accountChat, 'false');
  assert.equal(p.links().includes('/admin/'), false); assert.equal(p.storage.get(hintKey), 'study');
});

test('a hanging preferred service is bounded while other optional lookups start immediately', async () => {
  const storage = new Map([[hintKey, 'portfolio']]);
  const p = page({ storage, respond(path, { signal }) {
    if (path === '/api/portfolio/session') return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return { user: path === '/api/chat/session' ? owner : null };
  } }); await settle();
  assert.equal(p.requests.filter(item => item.path !== '/api/portfolio/public').length, 3); assert.equal(p.events.length, 0);
  p.timer(2500); await settle();
  assert.equal(p.user.id, 'owner'); assert.equal(p.storage.get(hintKey), 'chat'); assert.equal(p.timers.size, 0);
});

test('private lookup failures never probe optional routes or keep a locally hinted role', async () => {
  const p = page({ section: 'study', pathname: '/study/', storage: new Map([[hintKey, 'chat']]), respond: () => ({ ok: false }) }); await settle();
  assert.equal(p.user, null); assert.equal(p.body.dataset.accountRole, 'guest'); assert.equal(p.top.querySelector('.account-identity').textContent, '계정 확인 필요');
  assert.deepEqual(p.requests.filter(item => item.path !== '/api/portfolio/public').map(item => item.path), ['/api/me']);
});
