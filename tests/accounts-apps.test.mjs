import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentials, loadAuth } from '../lib/auth.mjs';
import { createStore } from '../lib/store.mjs';
import { createChatStore } from '../lib/chat-store.mjs';
import { questions } from '../content/questions.mjs';

let directory, authenticate, accounts, alice, bob, upstream, upstreamUrl, ownerThread;
let study, chat, slowClosed = false;
const children = new Set();
const passwords = { owner: 'owner-test-password-2026', alice: 'alice-test-password-2026', bob: 'bob-test-password-2026' };
const auth = name => `Basic ${Buffer.from(`${name}:${passwords[name]}`).toString('base64')}`;
const privateQuestion = { ...questions.find(q => q.area === 'listening'), id: 'owner-private-listening', level: 'N2' };
const call = (base, name, path, method = 'GET', value) => fetch(base + path, {
  method, headers: { Authorization: auth(name), 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value)
});
const data = async (...args) => { const response = await call(...args); assert.equal(response.status, 200); return response.json(); };

async function start(script) {
  const child = spawn(process.execPath, [script], {
    cwd: new URL('..', import.meta.url), env: {
      ...process.env, AUTH_FILE: join(directory, 'auth.json'), AUTH_USERS_FILE: join(directory, 'accounts.sqlite'),
      DATA_DIR: join(directory, 'study'), CHAT_DATA_DIR: join(directory, 'chat'),
      PORT: '0', HOST: '127.0.0.1', CHAT_PORT: '0', CHAT_HOST: '127.0.0.1',
      CHAT_OLLAMA_URL: upstreamUrl, CHAT_SEARCH_URL: upstreamUrl
    }, stdio: ['ignore', 'pipe', 'pipe']
  });
  children.add(child);
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Account app startup timeout: ${errors}`)), 15000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Account app exited ${code}: ${errors}`)); });
    child.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127.0.0.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  return { child, base };
}
async function stop(service) {
  if (service?.child.exitCode === null) { const ended = once(service.child, 'exit'); service.child.kill('SIGTERM'); await ended; }
  if (service) children.delete(service.child);
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stella-account-apps-'));
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials('owner', passwords.owner)), { mode: 0o600 });
  const previous = process.env.AUTH_USERS_FILE;
  process.env.AUTH_USERS_FILE = join(directory, 'accounts.sqlite');
  try { authenticate = await loadAuth(join(directory, 'auth.json')); }
  finally { if (previous === undefined) delete process.env.AUTH_USERS_FILE; else process.env.AUTH_USERS_FILE = previous; }
  accounts = authenticate.accounts;
  alice = await accounts.create({ username: 'alice', password: passwords.alice, permissions: ['study', 'chat'] });
  bob = await accounts.create({ username: 'bob', password: passwords.bob, permissions: ['study', 'chat'] });
  upstream = createServer(async (req, res) => {
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'test-model', capabilities: ['completion'] }] }));
    if (req.url.startsWith('/search/web')) return res.end(JSON.stringify({ results: [] }));
    if (req.url === '/api/chat') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      if (!input.stream) return res.end(JSON.stringify({ message: { content: '학습 해설' } }));
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      if (input.messages.at(-1).content === 'slow-revoke') {
        res.write(JSON.stringify({ message: { content: '작성 중' } }) + '\n');
        const timer = setTimeout(() => res.end(JSON.stringify({ message: { content: '완료' }, done: true }) + '\n'), 12000);
        res.on('close', () => { slowClosed = true; clearTimeout(timer); }); return;
      }
      return res.end(JSON.stringify({ message: { content: '개인 답변' }, done: true }) + '\n');
    }
    res.writeHead(404); res.end();
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const ownerStudy = createStore(join(directory, 'study'), questions);
  ownerStudy.setSettings({ ...ownerStudy.getSettings(), level: 'N2', ollamaUrl: upstreamUrl, ollamaModel: 'test-model' });
  ownerStudy.importQuestions([privateQuestion]); ownerStudy.attempt({ questionId: privateQuestion.id, answerIndex: privateQuestion.answerIndex, durationMs: 1000 }); ownerStudy.db.close();
  const ownerChat = createChatStore(join(directory, 'chat'));
  ownerThread = ownerChat.create('test-model');
  const answer = ownerChat.begin(ownerThread.id, '기존 owner 대화', 'test-model'); ownerChat.finish(answer, '기존 답변', 'complete', []); ownerChat.db.close();
  study = await start('server.mjs'); chat = await start('chat-server.mjs');
});
after(async () => {
  await stop(study); await stop(chat);
  for (const child of children) if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
  accounts?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('study stores isolate attempts, custom material, practice, backup and TTS source lookup', async () => {
  const owner = await data(study.base, 'owner', '/api/state');
  assert.equal(owner.settings.level, 'N2'); assert.equal(owner.stats.totalAnswered, 1);
  for (const name of ['alice', 'bob']) {
    const state = await data(study.base, name, '/api/state?userId=owner');
    assert.equal(state.stats.totalAnswered, 0); assert.equal(state.settings.level, 'N5'); assert.equal(state.user.isAdmin, false);
    assert.equal((await call(study.base, name, `/api/questions/${privateQuestion.id}`)).status, 404);
    assert.equal((await call(study.base, name, '/api/tts/audio', 'POST', { questionId: privateQuestion.id, part: 'passage' })).status, 404);
  }
  const q = { ...privateQuestion, id: 'alice-private-listening' };
  assert.equal((await call(study.base, 'alice', '/api/questions/import?userId=owner', 'POST', { userId: 'owner', questions: [q] })).status, 200);
  assert.equal((await call(study.base, 'alice', '/api/attempts', 'POST', { userId: 'owner', questionId: q.id, answerIndex: q.answerIndex, durationMs: 1234 })).status, 201);
  assert.equal((await call(study.base, 'bob', `/api/questions/${q.id}`)).status, 404);
  assert.equal((await call(study.base, 'owner', `/api/questions/${q.id}`)).status, 404);
  const bank = await data(study.base, 'alice', '/api/practice');
  await data(study.base, 'alice', '/api/practice/grade', 'POST', { entryId: bank.items[0].id, kind: 'words', rating: 'good', durationMs: 100, requestId: 'alice-practice-private-001', userId: 'owner' });
  assert.equal((await data(study.base, 'alice', '/api/state')).practice.words.seen, 1);
  assert.equal((await data(study.base, 'bob', '/api/state')).practice.words.seen, 0);
  const backup = await data(study.base, 'alice', '/api/backup');
  assert.equal(backup.attempts.length, 1); assert.equal(backup.attempts[0].questionId, q.id);
  assert.ok(!backup.questions.some(value => value.id === privateQuestion.id));
  assert.equal((await data(study.base, 'owner', '/api/backup')).attempts[0].questionId, privateQuestion.id);
});

test('guest settings and restored URLs cannot change the actual owner-controlled AI connection', async () => {
  const settings = await data(study.base, 'alice', '/api/settings');
  assert.equal(settings.ollamaUrl, upstreamUrl);
  assert.equal((await call(study.base, 'alice', '/api/settings', 'PUT', { ...settings, ollamaUrl: 'http://127.0.0.1:9' })).status, 403);
  await data(study.base, 'alice', '/api/settings', 'PUT', { ...settings, level: 'N3', ollamaModel: 'test-model' });
  const backup = await data(study.base, 'alice', '/api/backup');
  backup.settings.ollamaUrl = 'http://127.0.0.1:9';
  await data(study.base, 'alice', '/api/restore', 'POST', backup);
  assert.equal((await data(study.base, 'alice', '/api/settings')).ollamaUrl, upstreamUrl);
  assert.equal((await data(study.base, 'alice', '/api/ollama/models')).available, true);
  const answer = await data(study.base, 'alice', '/api/ai/explain', 'POST', { questionId: 'alice-private-listening' });
  assert.equal(answer.text, '학습 해설');
  assert.equal((await data(study.base, 'owner', '/api/settings')).level, 'N2');
  assert.equal((await data(study.base, 'bob', '/api/settings')).level, 'N5');
});

test('chat thread identifiers and histories cannot cross users and survive both server restarts', async () => {
  assert.equal((await data(chat.base, 'owner', `/api/chat/threads/${ownerThread.id}`)).messages[0].content, '기존 owner 대화');
  assert.equal((await data(chat.base, 'alice', '/api/chat/threads')).threads.length, 0);
  assert.equal((await call(chat.base, 'bob', `/api/chat/threads/${ownerThread.id}`)).status, 404);
  const created = await call(chat.base, 'alice', '/api/chat/threads', 'POST', { model: 'test-model', userId: 'owner' });
  assert.equal(created.status, 201); const thread = (await created.json()).thread;
  const answer = await call(chat.base, 'alice', `/api/chat/threads/${thread.id}/messages`, 'POST', { content: '나의 대화', model: 'test-model', userId: 'owner' });
  assert.equal(answer.status, 200); assert.match(await answer.text(), /"type":"done"/);
  for (const name of ['owner', 'bob']) {
    assert.equal((await call(chat.base, name, `/api/chat/threads/${thread.id}`)).status, 404);
    assert.equal((await call(chat.base, name, `/api/chat/threads/${thread.id}`, 'DELETE')).status, 404);
  }
  await stop(study); await stop(chat); study = await start('server.mjs'); chat = await start('chat-server.mjs');
  assert.equal((await data(chat.base, 'alice', `/api/chat/threads/${thread.id}`)).messages[0].content, '나의 대화');
  assert.equal((await data(chat.base, 'owner', '/api/chat/threads')).threads.length, 1);
  assert.equal((await data(chat.base, 'bob', '/api/chat/threads')).threads.length, 0);
  assert.equal((await data(study.base, 'alice', '/api/state')).settings.level, 'N3');
  assert.equal((await data(study.base, 'bob', '/api/state')).stats.totalAnswered, 0);
  for (const [path, filename] of [['study', 'jlpt.sqlite'], ['chat', 'chat.sqlite']]) {
    assert.ok((await stat(join(directory, path, filename))).isFile());
    assert.ok((await stat(join(directory, path, 'users', alice.id, filename))).isFile());
  }
});

test('capability revocation gates assets and APIs across live servers and cancels a running chat', async () => {
  await accounts.update(bob.id, { permissions: ['chat'] });
  for (const path of ['/', '/app.js', '/api/state', '/api/backup', '/api/tts/voices']) assert.equal((await call(study.base, 'bob', path)).status, 403, path);
  assert.equal((await call(study.base, 'bob', '/manifest.webmanifest')).status, 200);
  assert.equal((await call(chat.base, 'bob', '/chat/')).status, 200);
  const made = await call(chat.base, 'bob', '/api/chat/threads', 'POST', { model: 'test-model' });
  const thread = (await made.json()).thread;
  const response = await call(chat.base, 'bob', `/api/chat/threads/${thread.id}/messages`, 'POST', { content: 'slow-revoke', model: 'test-model' });
  assert.equal(response.status, 200);
  const ended = response.text(), began = Date.now();
  await accounts.update(bob.id, { permissions: ['study'] });
  const events = await ended;
  assert.ok(Date.now() - began < 5000, 'revocation must stop generation within five seconds');
  assert.ok(slowClosed); assert.match(events, /"type":"error"/); assert.ok(!events.includes('"type":"done"'));
  for (const path of ['/chat/', '/chat/app.js', '/api/chat/threads', '/api/chat/models']) assert.equal((await call(chat.base, 'bob', path)).status, 403, path);
  assert.equal((await call(study.base, 'bob', '/api/state')).status, 200);
  await accounts.update(bob.id, { enabled: false });
  assert.equal((await call(study.base, 'bob', '/api/state')).status, 401);
  assert.equal((await call(chat.base, 'bob', '/api/chat/threads')).status, 401);
});
