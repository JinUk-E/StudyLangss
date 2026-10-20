import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentials } from '../lib/auth.mjs';
import { createChatStore } from '../lib/chat-store.mjs';
import { localEndpoint } from '../lib/chat-upstream.mjs';

const credentials = 'test-chat:chat-test-password-2026';
const authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
let directory, upstream, child, base, lastPayload, downstreamAuth, slowStarted, slowClosed;
const calls = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'starlight-chat-test-'));
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials('test-chat', 'chat-test-password-2026')), { mode: 0o600 });
  upstream = createServer(async (req, res) => {
    downstreamAuth = req.headers.authorization;
    const url = new URL(req.url, 'http://localhost'); calls.push(url.pathname);
    if (url.pathname === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'test-model', capabilities: ['completion'] }, { name: 'embedding-only', capabilities: ['embedding'] }] }));
    if (url.pathname === '/search/web') {
      if (url.searchParams.get('q').includes('search-fail')) { res.writeHead(503); return res.end(); }
      return res.end(JSON.stringify({ results: [
        { title: '<img src=x onerror=alert(1)>', url: 'https://example.org/source', snippet: 'Reference material' },
        { title: 'Unsafe', url: 'javascript:alert(1)', snippet: 'discard' }
      ] }));
    }
    if (url.pathname === '/api/chat') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      lastPayload = JSON.parse(raw);
      const content = lastPayload.messages.at(-1).content;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      if (content === 'slow') {
        slowStarted = true; res.write(JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n');
        const timer = setTimeout(() => res.end(JSON.stringify({ message: { content: ' done' }, done: true }) + '\n'), 10000);
        res.on('close', () => { clearTimeout(timer); slowClosed = true; }); return;
      }
      if (content === 'broken') return res.end(JSON.stringify({ message: { content: 'incomplete' } }) + '\n');
      const bytes = Buffer.from(JSON.stringify({ message: { content: '안녕하세요 **별빛** [1]' }, done: false }) + '\n' + JSON.stringify({ done: true }) + '\n');
      res.write(bytes.subarray(0, 27)); setTimeout(() => res.end(bytes.subarray(27)), 10); return;
    }
    res.writeHead(404); res.end();
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  child = spawn(process.execPath, ['chat-server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, CHAT_PORT: '0', CHAT_HOST: '127.0.0.1', CHAT_DATA_DIR: directory, AUTH_FILE: join(directory, 'auth.json'), AUTH_USERS_FILE: join(directory, 'accounts.sqlite'), CHAT_OLLAMA_URL: upstreamUrl, CHAT_SEARCH_URL: upstreamUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chat startup timeout')), 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chat exited ${code}`)); });
    child.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127.0.0.1:\d+/); if (match) { base = match[0]; clearTimeout(timeout); resolve(); } });
  });
});
after(async () => {
  if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
  if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
  if (directory) await rm(directory, { recursive: true, force: true });
});
const api = (path, options = {}) => fetch(base + path, { ...options, headers: { Authorization: authorization, 'Content-Type': 'application/json', ...options.headers } });
const create = async () => (await (await api('/api/chat/threads', { method: 'POST', body: JSON.stringify({ model: 'test-model' }) })).json()).thread.id;
const send = async (id, content, search = false) => {
  const response = await api(`/api/chat/threads/${id}/messages`, { method: 'POST', body: JSON.stringify({ content, search, model: 'test-model' }) });
  return { response, events: (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
};

test('chat page, history, and generation all require authentication; origin and routes are restricted', async () => {
  for (const path of ['/chat/', '/chat/app.js', '/chat/styles.css', '/api/chat/models', '/api/chat/threads', '/api/chat/health']) {
    assert.equal((await fetch(base + path)).status, 401, path);
  }
  assert.equal((await fetch(base + '/api/chat/threads', { method: 'POST' })).status, 401);
  assert.equal((await api('/api/chat/threads', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: JSON.stringify({ model: 'test-model' }) })).status, 403);
  assert.equal((await api('/api/chat/threads', { method: 'POST', body: '{broken' })).status, 400);
  assert.equal((await api('/api/chat/threads', { method: 'POST', body: JSON.stringify({ model: 'x'.repeat(70000) }) })).status, 413);
  assert.equal((await api('/api/pull', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await api('/chat/%2e%2e/auth.json')).status, 404);
  const page = await api('/chat/'); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  for (const endpoint of ['https://127.0.0.1', 'http://external.example', 'http://user:pass@localhost', 'http://localhost/path']) assert.throws(() => localEndpoint(endpoint));
});

test('streaming, search citations, conversation persistence and deletion work without leaking authentication', async () => {
  const models = await (await api('/api/chat/models')).json(); assert.deepEqual(models.models.map(m => m.name), ['test-model']);
  const id = await create();
  const result = await send(id, '안녕 <script>alert(1)</script>', true);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('x-accel-buffering'), 'no');
  assert.ok(result.events.some(e => e.type === 'done'));
  assert.equal(result.events.find(e => e.type === 'sources').sources.length, 1);
  assert.equal(result.events.find(e => e.type === 'delta').text, '안녕하세요 **별빛** [1]');
  assert.equal(downstreamAuth, undefined);
  assert.equal(lastPayload.stream, true); assert.match(lastPayload.messages[0].content, /신뢰할 수 없는/);
  assert.match(lastPayload.messages[0].content, /스텔라\(Stella\)/);
  assert.match(lastPayload.messages[0].content, /부드럽고 지적/);
  assert.match(lastPayload.messages[0].content, /꼼꼼하고 배려심/);
  assert.match(lastPayload.messages[0].content, /https:\/\/example.org\/source/);
  const saved = await (await api(`/api/chat/threads/${id}`)).json();
  assert.equal(saved.messages.length, 2); assert.equal(saved.messages[1].status, 'complete'); assert.equal(saved.messages[1].sources.length, 1);
  await send(id, '두 번째 질문'); assert.equal(lastPayload.messages.length, 4);
  assert.equal((await api(`/api/chat/threads/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/chat/threads/${id}`)).status, 404);
});

test('failed search is explicit; truncated generation is saved as an error; unknown models are rejected', async () => {
  const id = await create();
  const result = await send(id, 'search-fail', true);
  assert.ok(result.events.some(e => e.type === 'warning')); assert.ok(result.events.some(e => e.type === 'done'));
  assert.match(lastPayload.messages[0].content, /웹 검색 근거가 없습니다/);
  const broken = await send(id, 'broken'); assert.ok(broken.events.some(e => e.type === 'error')); assert.ok(!broken.events.some(e => e.type === 'done'));
  const saved = await (await api(`/api/chat/threads/${id}`)).json(); assert.equal(saved.messages.at(-1).status, 'error');
  assert.equal((await api(`/api/chat/threads/${id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'hi', model: 'not-installed' }) })).status, 400);
});

test('disconnect cancels upstream generation and concurrent sends cannot interleave', async () => {
  const id = await create(), controller = new AbortController(); slowClosed = false;
  const response = await api(`/api/chat/threads/${id}/messages`, { method: 'POST', signal: controller.signal, body: JSON.stringify({ content: 'slow', model: 'test-model' }) });
  const reader = response.body.getReader();
  for (let i = 0; i < 40 && !slowStarted; i++) await sleep(25);
  assert.equal(slowStarted, true);
  assert.equal((await api(`/api/chat/threads/${id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'race', model: 'test-model' }) })).status, 409);
  assert.equal((await api(`/api/chat/threads/${id}`, { method: 'DELETE' })).status, 409);
  controller.abort(); await reader.cancel().catch(() => {});
  for (let i = 0; i < 80 && !slowClosed; i++) await sleep(25);
  assert.equal(slowClosed, true);
  let saved;
  for (let i = 0; i < 40; i++) { saved = await (await api(`/api/chat/threads/${id}`)).json(); if (!saved.busy) break; await sleep(25); }
  assert.equal(saved.busy, false); assert.equal(saved.messages.at(-1).status, 'interrupted');
});

test('chat storage is separate and recovers incomplete answers on restart', async () => {
  const isolated = join(directory, 'persistence'); let store = createChatStore(isolated);
  const thread = store.create('test-model'); store.begin(thread.id, 'persist', 'test-model'); store.db.close();
  store = createChatStore(isolated);
  assert.equal(store.messages(thread.id)[0].content, 'persist'); assert.equal(store.messages(thread.id)[1].status, 'interrupted'); store.db.close();
});
