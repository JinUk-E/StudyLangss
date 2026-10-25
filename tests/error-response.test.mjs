import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentials, loadAuth } from '../lib/auth.mjs';
import { errorPage, publicErrorMessage, sendError, wantsErrorPage } from '../lib/error-response.mjs';

let directory;
const children = [], apps = [];
const password = 'error-test-password-2026';
const basic = username => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const documentHeaders = { Accept: 'text/html,application/xhtml+xml', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
const call = (app, path, { user, headers = documentHeaders, method = 'GET' } = {}) => fetch(app.base + path, { method, headers: { Connection: 'close', ...(user ? { Authorization: basic(user) } : {}), ...headers } });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'starlight-error-pages-'));
  const filename = join(directory, 'auth.json');
  await writeFile(filename, JSON.stringify(await createCredentials('error-owner', password)));
  const savedUsers = process.env.AUTH_USERS_FILE;
  process.env.AUTH_USERS_FILE = join(directory, 'accounts.sqlite');
  try {
    const auth = await loadAuth(filename);
    try {
      await auth.accounts.create({ username: 'study-only', password, permissions: ['study'] });
      await auth.accounts.create({ username: 'chat-only', password, permissions: ['chat'] });
    } finally { auth.accounts.close(); }
  } finally {
    if (savedUsers === undefined) delete process.env.AUTH_USERS_FILE; else process.env.AUTH_USERS_FILE = savedUsers;
  }
  for (const [script, port, page, api, denied] of [
    ['portfolio-server.mjs', 'PORTFOLIO_PORT', '/admin/', '/api/portfolio/manage', 'study-only'],
    ['server.mjs', 'PORT', '/', '/api/state', 'chat-only'],
    ['chat-server.mjs', 'CHAT_PORT', '/chat/', '/api/chat/threads', 'study-only']
  ]) {
    const child = spawn(process.execPath, [script], { cwd: new URL('..', import.meta.url), env: {
      ...process.env, AUTH_FILE: filename, AUTH_USERS_FILE: join(directory, 'accounts.sqlite'),
      PORTFOLIO_DATA_DIR: join(directory, 'portfolio'), DATA_DIR: join(directory, 'study'), CHAT_DATA_DIR: join(directory, 'chat'),
      PUSH_DATA_DIR: join(directory, 'push'), PUSH_CONFIG_FILE: join(directory, 'no-push.json'), TTS_CONFIG_FILE: join(directory, 'no-tts.json'), TTS_ENGINE: 'mac',
      CHAT_OLLAMA_URL: 'http://127.0.0.1:9', HOST: '127.0.0.1', CHAT_HOST: '127.0.0.1', PORTFOLIO_HOST: '127.0.0.1', [port]: '0'
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    const base = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`${script} startup timeout`)), 15000);
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`${script} exited ${code}: ${output}`)); });
      child.stderr.on('data', chunk => { output += chunk; });
      child.stdout.on('data', chunk => { const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timeout); resolve(url); } });
    });
    apps.push({ base, page, api, denied });
  }
});
after(async () => {
  for (const child of children) if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('HTML error negotiation distinguishes navigation, JSON fetches, excluded media and HEAD', () => {
  for (const headers of [{ accept: 'text/html' }, { 'sec-fetch-mode': 'navigate' }, { 'sec-fetch-dest': 'document' }]) assert.equal(wantsErrorPage({ method: 'GET', headers }), true);
  for (const accept of ['*/*', 'application/json', 'text/html;q=0,application/json', 'application/json,text/html;q=0.1']) assert.equal(wantsErrorPage({ method: 'GET', headers: { accept } }), false);
  assert.equal(wantsErrorPage({ method: 'POST', headers: { accept: 'text/html' } }), false);
  assert.equal(wantsErrorPage({ method: 'HEAD', headers: { accept: 'text/html' } }), true);
});

test('browser authentication failures retain 401 challenge, use a fixed error page and never reflect credentials or query strings', async () => {
  for (const app of apps) for (const headers of [documentHeaders, { ...documentHeaders, Authorization: basic('wrong-account') }]) {
    const response = await call(app, app.page + '?next=https://untrusted.invalid/&password=SECRET_SENTINEL', { headers });
    assert.equal(response.status, 401); assert.equal(response.redirected, false);
    assert.match(response.headers.get('www-authenticate'), /^Basic /);
    assert.match(response.headers.get('content-type'), /^text\/html/); assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text(); assert.match(html, /로그인이 필요해요/); assert.match(html, /홈으로 돌아가기/);
    assert.doesNotMatch(html, /SECRET_SENTINEL|untrusted\.invalid|wrong-account|error-test-password|"error"|<script/i);
  }
});

test('all applications render permission, missing-route and HEAD failures without redirecting or returning a success status', async () => {
  for (const app of apps) {
    const denied = await call(app, app.page, { user: app.denied });
    assert.equal(denied.status, 403); assert.match(await denied.text(), /접근 권한을 확인/);
    for (const path of ['/missing-page', '/lib/auth.mjs', '/data/auth.json', '/server.mjs']) {
      const missing = await call(app, path, { user: 'error-owner' });
      assert.equal(missing.status, 404); assert.match(missing.headers.get('content-type'), /text\/html/);
      const text = await missing.text(); assert.match(text, /페이지를 찾을 수 없어요/); assert.doesNotMatch(text, /createCredentials|loadAuth|scrypt|salt|node:|ENOENT/);
    }
    const head = await call(app, app.page, { method: 'HEAD' });
    assert.equal(head.status, 401); assert.match(head.headers.get('content-type'), /text\/html/); assert.equal(await head.text(), '');
  }
});

test('API fetches keep JSON status errors while an API opened as a browser document gets HTML', async () => {
  for (const app of apps) {
    const unauthorized = await call(app, app.api, { headers: { Accept: 'application/json' } });
    assert.equal(unauthorized.status, 401); assert.match(unauthorized.headers.get('content-type'), /application\/json/); assert.ok((await unauthorized.json()).error);
    const denied = await call(app, app.api, { user: app.denied, headers: { Accept: 'application/json' } });
    assert.equal(denied.status, 403); assert.ok((await denied.json()).error);
    const browser = await call(app, app.api); assert.equal(browser.status, 401); assert.match(browser.headers.get('content-type'), /text\/html/);
    const valid = await call(app, app.api, { user: 'error-owner', headers: { Accept: 'application/json' } });
    assert.equal(valid.status, 200); await valid.json();
  }
});

test('internal failures are generic in JSON, browser HTML and shared chat error messages', async () => {
  const app = apps[2];
  for (const headers of [documentHeaders, { Accept: 'application/json' }]) {
    const response = await call(app, '/api/chat/models', { user: 'error-owner', headers });
    assert.equal(response.status, 503);
    const text = await response.text(); assert.doesNotMatch(text, /fetch failed|ECONNREFUSED|bad port|127\.0\.0\.1|\.mjs|node:|stack/i);
  }
  const sentinel = 'SQLITE_ERROR /Users/private/auth.json node:internal SECRET_SENTINEL';
  for (const status of [500, 502, 503, 504]) {
    assert.doesNotMatch(publicErrorMessage(status, sentinel), /SQLITE|SECRET|auth\.json|node:/);
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    sendError({ method: 'GET', headers: { accept: 'text/html' }, url: sentinel }, res, status, sentinel);
    assert.equal(res.status, status); assert.doesNotMatch(res.body, /SQLITE|SECRET|auth\.json|node:/);
    assert.match(res.headers['Content-Security-Policy'], /default-src 'none'/);
  }
});

test('gateway fallback has no external resources or scripts and contains only fixed, safe copy', async () => {
  const html = await readFile(new URL('../public/errors/unavailable.html', import.meta.url), 'utf8');
  assert.match(html, /별빛공방/); assert.match(html, /홈으로 돌아가기/);
  assert.doesNotMatch(html, /<script|https?:\/\/|src=|stack|\.mjs/i);
  const data = JSON.parse(await readFile(new URL('../public/errors/unavailable.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(data), ['error']); assert.ok(data.error);
  for (const status of [401, 403, 404, 429, 500, 502, 503, 504]) assert.match(errorPage(status), new RegExp(`${status} · STARLIGHT`));
});
