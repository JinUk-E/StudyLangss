import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/accounts/app.js', import.meta.url), 'utf8');
const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
class Element {
  children = []; dataset = {}; value = ''; checked = false; disabled = false; textContent = ''; events = new Map();
  constructor(tag = 'div') { this.tagName = tag; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  replaceWith(next) { const position = this.parent.children.indexOf(this); next.parent = this.parent; this.parent.children.splice(position, 1, next); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.events.set(name, handler); }
  querySelectorAll(selector) {
    const result = [], matches = element => selector.split(',').some(part => part === '[data-account-status]' ? Object.hasOwn(element.dataset, 'accountStatus') : part.startsWith('.') ? element.className?.split(' ').includes(part.slice(1)) : element.tagName === part);
    const walk = element => { for (const child of element.children) { if (matches(child)) result.push(child); walk(child); } }; walk(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get elements() { return { namedItem: name => this.querySelectorAll('input').find(input => input.name === name) }; }
  reset() { for (const input of this.querySelectorAll('input')) { input.value = ''; input.checked = input.name === 'enabled'; } }
  submit() { return this.events.get('submit')?.({ preventDefault() {} }); }
  click() { return this.events.get('click')?.(); }
}
const owner = { id: 'owner', username: 'owner', isAdmin: true, enabled: true, permissions: ['study', 'chat'] };
const member = { id: 'member-1', username: 'learner', isAdmin: false, enabled: true, permissions: ['study'] };
function page(options = {}) {
  const nodes = new Map(), requests = [];
  const element = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  const form = element('#create-account'); form.tagName = 'form';
  const fields = element('#create-fields'); fields.tagName = 'fieldset'; form.append(fields);
  for (const name of ['username', 'password', 'confirmPassword', 'study', 'chat', 'enabled']) { const input = new Element('input'); input.name = name; input.checked = name === 'enabled'; fields.append(input); }
  const accounts = [structuredClone(owner), structuredClone(member)];
  vm.runInNewContext(source, { document: { querySelector: element, createElement: tag => new Element(tag), createTextNode: text => { const child = new Element('#text'); child.textContent = text; return child; } }, AbortController, setTimeout, clearTimeout,
    async fetch(url, init = {}) {
      const path = url.replace('/api/portfolio', ''); requests.push({ path, ...init });
      const custom = options.respond?.(path, init);
      if (custom) return { ok: custom.ok ?? true, status: custom.status || 200, async json() { return custom.data; } };
      let data;
      if (path === '/me') data = { user: options.notAdmin ? member : owner };
      else if (path === '/accounts' && init.method === 'POST') { const input = JSON.parse(init.body); const account = { id: 'new-member', username: input.username, permissions: input.permissions, enabled: input.enabled, isAdmin: false }; accounts.push(account); data = { account }; }
      else if (path === '/accounts') data = { accounts: structuredClone(accounts) };
      else { const changes = JSON.parse(init.body); const account = accounts.find(item => item.id === path.split('/').at(-1)); Object.assign(account, Object.fromEntries(Object.entries(changes).filter(([key]) => key !== 'password'))); data = { account: structuredClone(account) }; }
      return { ok: true, status: 200, async json() { return data; } };
    }
  });
  return { element, requests, form, field: name => form.elements.namedItem(name), list: element('#accounts-list') };
}
test('account page gates management on strict administrator lookup and fixed owner has no edit controls', async () => {
  const denied = page({ notAdmin: true }); await settle(); assert.equal(denied.element('#create-fields').disabled, true); assert.equal(denied.requests.some(request => request.path === '/accounts'), false); assert.match(denied.element('#account-status').textContent, /관리자만/);
  const p = page(); await settle(); assert.equal(p.list.children[0].dataset.accountId, 'owner'); assert.equal(p.list.children[0].querySelectorAll('button,input').length, 0); assert.equal(p.list.children[1].querySelectorAll('button,input').length > 0, true);
});
test('create validates confirmation and permission before saving, then clears plaintext fields', async () => {
  const p = page(); await settle();
  p.field('username').value = 'new-user'; p.field('password').value = 'unique-secret-123'; p.field('confirmPassword').value = 'different-secret';
  await p.form.submit(); assert.match(p.element('#create-status').textContent, /일치/); assert.equal(p.requests.filter(request => request.method === 'POST').length, 0);
  p.field('confirmPassword').value = p.field('password').value; await p.form.submit(); assert.match(p.element('#create-status').textContent, /하나 이상/);
  p.field('study').checked = true; await p.form.submit();
  assert.equal(p.requests.filter(request => request.method === 'POST').length, 1); assert.equal(p.field('password').value, ''); assert.equal(p.field('confirmPassword').value, ''); assert.equal(p.list.children.length, 3); assert.equal(p.element('#create-status').textContent.includes('unique-secret'), false);
});
test('create errors preserve failure state without adding an account or claiming success', async () => {
  const p = page({ respond(path, init) { if (path === '/accounts' && init.method === 'POST') return { ok: false, status: 409, data: { error: '이미 사용한 아이디입니다.' } }; } }); await settle();
  p.field('username').value = 'owner'; p.field('password').value = p.field('confirmPassword').value = 'unique-secret-123'; p.field('chat').checked = true;
  await p.form.submit(); assert.equal(p.element('#create-status').textContent, '이미 사용한 아이디입니다.'); assert.equal(p.element('#create-status').dataset.error, 'true'); assert.equal(p.list.children.length, 2);
});
test('password reset sends only a confirmed password and replaces the card with empty fields', async () => {
  const p = page(); await settle(); const card = p.list.children[1]; const reset = card.querySelector('.password-reset').querySelector('form');
  reset.elements.namedItem('password').value = 'new-private-secret'; reset.elements.namedItem('confirmPassword').value = 'different-private';
  await reset.submit(); assert.equal(p.requests.some(request => request.method === 'PATCH'), false);
  reset.elements.namedItem('confirmPassword').value = 'new-private-secret'; await reset.submit();
  const change = p.requests.find(request => request.method === 'PATCH'); assert.deepEqual(JSON.parse(change.body), { password: 'new-private-secret' });
  assert.equal(reset.elements.namedItem('password').value, ''); const updated = p.list.children[1]; assert.notEqual(updated, card); assert.equal(updated.querySelector('.password-reset').querySelector('form').elements.namedItem('password').value, ''); assert.equal(updated.querySelector('[data-account-status]').textContent.includes('new-private-secret'), false);
});
test('failed permission save preserves an error and account state; pause only changes enabled', async () => {
  const p = page({ respond(path, init) { if (init.method === 'PATCH' && JSON.parse(init.body).permissions) return { ok: false, status: 403, data: { error: '권한 변경 실패' } }; } }); await settle();
  const card = p.list.children[1], permissions = card.querySelector('.permission-form'); permissions.elements.namedItem('chat').checked = true;
  await permissions.submit(); assert.equal(card.querySelector('[data-account-status]').textContent, '권한 변경 실패');
  const toggle = card.children.find(child => child.className === 'form-actions').querySelector('button'); await toggle.click();
  assert.deepEqual(JSON.parse(p.requests.filter(request => request.method === 'PATCH').at(-1).body), { enabled: false }); assert.match(p.list.children[1].querySelector('[data-account-status]').textContent, /중지/);
});
