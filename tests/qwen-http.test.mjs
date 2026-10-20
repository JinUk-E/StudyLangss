import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentials, loadAuth } from '../lib/auth.mjs';
import { createStore } from '../lib/store.mjs';
import { createChatStore } from '../lib/chat-store.mjs';
import { questions } from '../content/questions.mjs';

const manifest = {
  protocolVersion: 1, modelId: 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit',
  modelRevision: '1c6c0ff58c43afa8df571facde2efa077efd85e2',
  styleVersion: 'stella-calm-v1', segmentationVersion: 'ko-ja-v1'
};
const token = randomBytes(32).toString('hex');
const names = ['owner', 'alice', 'bob', 'studyOnly', 'chatOnly', 'revokedStudy', 'revokedChat'];
const passwords = Object.fromEntries(names.map(name => [name, `${name}-qwen-test-password-2026`]));
const credentials = name => `Basic ${Buffer.from(`${name}:${passwords[name]}`).toString('base64')}`;
const children = new Set(), calls = [], answers = {};
let directory, manager, study, chat, fake, practice, privateQuestion, holdText, holdStarted, heldClosed = false, corruptText;

function wav() {
  const value = Buffer.alloc(48);
  value.write('RIFF'); value.writeUInt32LE(40, 4); value.write('WAVEfmt ', 8); value.writeUInt32LE(16, 16);
  value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22); value.writeUInt32LE(24000, 24); value.writeUInt32LE(48000, 28);
  value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34); value.write('data', 36); value.writeUInt32LE(4, 40);
  return value;
}
const request = (base, name, path, body, options = {}) => fetch(base + path, {
  method: body === undefined ? 'GET' : 'POST', ...options,
  headers: { ...(name ? { Authorization: credentials(name) } : {}), 'Content-Type': 'application/json', ...options.headers },
  body: body === undefined ? undefined : JSON.stringify(body)
});
async function audio(base, name, path, body) {
  const response = await request(base, name, path, body);
  assert.equal(response.status, 200, await (response.status === 200 ? Promise.resolve('') : response.clone().text()));
  assert.match(response.headers.get('content-type'), /^audio\/wav/);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav());
  return response;
}
async function start(script) {
  const child = spawn(process.execPath, [script], {
    cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, AUTH_FILE: join(directory, 'auth.json'), AUTH_USERS_FILE: join(directory, 'accounts.sqlite'),
      DATA_DIR: join(directory, 'study'), CHAT_DATA_DIR: join(directory, 'chat'),
      PORT: '0', HOST: '127.0.0.1', CHAT_PORT: '0', CHAT_HOST: '127.0.0.1',
      TTS_ENGINE: 'qwen', TTS_CONFIG_FILE: join(directory, 'qwen.json'),
      PUSH_VAPID_FILE: join(directory, 'unused-vapid.json'), PUSH_DB_FILE: join(directory, 'unused-push.sqlite'),
      CHAT_OLLAMA_URL: 'http://127.0.0.1:9', CHAT_SEARCH_URL: 'http://127.0.0.1:9'
    }
  });
  children.add(child);
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TTS app startup timeout: ${errors}`)), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`TTS app exited ${code}: ${errors}`)); });
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  return { child, base };
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stella-qwen-http-'));
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials('owner', passwords.owner)), { mode: 0o600 });
  await writeFile(join(directory, 'qwen.json'), JSON.stringify({ version: 1, token, port: 8877, ...manifest }), { mode: 0o600 });
  const previous = process.env.AUTH_USERS_FILE;
  process.env.AUTH_USERS_FILE = join(directory, 'accounts.sqlite');
  try { manager = (await loadAuth(join(directory, 'auth.json'))).accounts; }
  finally { if (previous === undefined) delete process.env.AUTH_USERS_FILE; else process.env.AUTH_USERS_FILE = previous; }
  for (const name of names.slice(1)) {
    const permissions = name === 'studyOnly' ? ['study'] : name === 'chatOnly' ? ['chat'] : ['study', 'chat'];
    await manager.create({ username: name, password: passwords[name], permissions });
  }
  for (const account of manager.list()) {
    const studyPath = account.isAdmin ? join(directory, 'study') : join(directory, 'study', 'users', account.id);
    const store = createStore(studyPath, questions);
    if (account.isAdmin) {
      practice = store.practice.list('N5', 'words', 'all').items[0];
      privateQuestion = { ...questions.find(value => value.area === 'listening'), id: 'owner-only-audio-question', passage: '所有者だけの文章です。' };
      store.importQuestions([privateQuestion]);
    }
    store.db.close();
    const chatPath = account.isAdmin ? join(directory, 'chat') : join(directory, 'chat', 'users', account.id);
    const chatStore = createChatStore(chatPath), thread = chatStore.create('test-model');
    const complete = chatStore.begin(thread.id, '사용자가 보낸 메시지', 'test-model');
    chatStore.finish(complete, account.username.startsWith('revoked') ? `권한 회수 대기 ${account.username}` : `안녕하세요 ${account.username}. 静かな声です。`, 'complete', []);
    const user = chatStore.messages(thread.id).find(value => value.role === 'user').id;
    const interrupted = chatStore.begin(thread.id, '두 번째 사용자 메시지', 'test-model');
    chatStore.finish(interrupted, '미완성 답변', 'interrupted', []);
    const oversized = chatStore.begin(thread.id, '긴 답변 요청', 'test-model');
    chatStore.finish(oversized, '가'.repeat(2001), 'complete', []);
    const shared = chatStore.begin(thread.id, '공유 문자열', 'test-model');
    chatStore.finish(shared, practice.word, 'complete', []);
    const corrupt = chatStore.begin(thread.id, '손상된 오디오', 'test-model');
    chatStore.finish(corrupt, '손상 오디오를 검증하는 문장', 'complete', []);
    answers[account.username] = { complete, user, interrupted, oversized, shared, corrupt };
    chatStore.db.close();
  }
  fake = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...manifest, ready: true, state: 'ready', languages: ['ko', 'ja'], speakers: { ko: 'Sohee', ja: 'Ono_Anna' } }));
    }
    if (req.url !== '/synthesize' || req.method !== 'POST') { res.writeHead(404); return res.end(); }
    let text = ''; for await (const chunk of req) text += chunk;
    const input = JSON.parse(text);
    assert.deepEqual(Object.keys(input).sort(), ['language', 'text']);
    assert.ok(['ko', 'ja', 'auto'].includes(input.language));
    calls.push(input);
    const respond = () => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(input.text === corruptText ? Buffer.from('broken WAV') : wav());
    };
    if (input.text === holdText) {
      heldClosed = false;
      const timer = setTimeout(respond, 12000);
      res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) heldClosed = true; });
      holdStarted?.();
    } else respond();
  });
  fake.listen(8877, '127.0.0.1'); await once(fake, 'listening');
  study = await start('server.mjs'); chat = await start('chat-server.mjs');
});
after(async () => {
  for (const child of children) if (child.exitCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended;
  }
  if (fake) { fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve)); }
  manager?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('Qwen voice discovery preserves login and study/chat capability gates without exposing configuration', async () => {
  const page = await request(chat.base, 'owner', '/chat/');
  assert.match(page.headers.get('content-security-policy'), /media-src 'self' blob:/);
  for (const [base, path, granted, denied] of [
    [study.base, '/api/tts/voices', 'studyOnly', 'chatOnly'],
    [chat.base, '/api/chat/tts/voices', 'chatOnly', 'studyOnly']
  ]) {
    assert.equal((await request(base, undefined, path)).status, 401);
    assert.equal((await request(base, denied, path)).status, 403);
    const response = await request(base, granted, path), value = await response.json();
    assert.equal(response.status, 200); assert.equal(value.available, true);
    assert.deepEqual(value.voices.map(voice => voice.id).sort(), ['stella-ja', 'stella-ko']);
    assert.ok(!JSON.stringify(value).includes(token));
    assert.ok(!JSON.stringify(value).includes(directory));
  }
});

test('study uses saved sources and selects Korean meanings/explanations while protecting unanswered explanations', async () => {
  const requestAudio = input => audio(study.base, 'owner', '/api/tts/audio', input);
  for (const [part, expected, language] of [['word', practice.word, 'ja'], ['sentence', practice.example, 'ja'], ['meaning', practice.meaning, 'ko']]) {
    await requestAudio({ entryId: practice.id, part });
    assert.deepEqual(calls.at(-1), { text: expected, language });
  }
  await requestAudio({ questionId: privateQuestion.id, part: 'passage' });
  assert.deepEqual(calls.at(-1), { text: privateQuestion.passage, language: 'ja' });
  const explanation = { questionId: 'n5-v01', part: 'explanation' };
  const before = calls.length;
  assert.equal((await request(study.base, 'alice', '/api/tts/audio', explanation)).status, 409);
  assert.equal(calls.length, before);
  assert.equal((await request(study.base, 'owner', '/api/attempts', { questionId: explanation.questionId, answerIndex: 0, durationMs: 0 })).status, 201);
  assert.equal((await request(study.base, 'alice', '/api/tts/audio', explanation)).status, 409);
  await requestAudio(explanation);
  assert.equal(calls.at(-1).language, 'ko');
  assert.equal((await request(study.base, 'alice', '/api/tts/audio', { questionId: privateQuestion.id, part: 'passage' })).status, 404);
  for (const injected of [{ text: '외부 입력' }, { entryId: practice.id, part: 'word', language: 'ko' }, { entryId: practice.id, part: 'word', instruct: '바꿔 읽기' }, { entryId: practice.id, part: 'word', voice: 'uninstalled-voice' }]) {
    assert.equal((await request(study.base, 'owner', '/api/tts/audio', injected)).status, 400);
  }
});

test('chat reads only this account completed assistant messages and rejects arbitrary text, options and oversized answers', async () => {
  for (const language of ['auto', 'ko', 'ja']) {
    await audio(chat.base, 'owner', '/api/chat/tts/audio', { messageId: answers.owner.complete, language });
    assert.equal(calls.at(-1).language, language);
  }
  assert.equal((await request(chat.base, 'alice', '/api/chat/tts/audio', { messageId: answers.owner.complete, language: 'ko' })).status, 404);
  for (const input of [
    { messageId: answers.owner.user, language: 'ko' }, { messageId: answers.owner.interrupted, language: 'ko' },
    { messageId: answers.owner.oversized, language: 'ko' }, { messageId: '../auth.json', language: 'ko' },
    { messageId: answers.owner.complete, language: 'en' }, { messageId: answers.owner.complete, language: 'ko', text: '대체 내용' },
    { messageId: answers.owner.complete, language: 'ko', voice: 'Sohee' }, { messageId: answers.owner.complete, language: 'ko', instruct: '바꿔 읽기' }
  ]) assert.ok([400, 409].includes((await request(chat.base, 'owner', '/api/chat/tts/audio', input)).status));
});

test('cached speech remains separated by account and by study versus chat service', async () => {
  const before = calls.filter(call => call.text === practice.word).length;
  await audio(chat.base, 'owner', '/api/chat/tts/audio', { messageId: answers.owner.shared, language: 'ja' });
  await audio(chat.base, 'alice', '/api/chat/tts/audio', { messageId: answers.alice.shared, language: 'ja' });
  await audio(chat.base, 'alice', '/api/chat/tts/audio', { messageId: answers.alice.shared, language: 'ja' });
  assert.equal(calls.filter(call => call.text === practice.word).length - before, 2, 'owner study cache must not satisfy either chat/account namespace');
});

test('cross-site synthesis requests are rejected before Python receives any content', async () => {
  const before = calls.length;
  for (const [base, path, input] of [
    [study.base, '/api/tts/audio', { entryId: practice.id, part: 'word' }],
    [chat.base, '/api/chat/tts/audio', { messageId: answers.owner.complete, language: 'ko' }]
  ]) assert.equal((await request(base, 'owner', path, input, { headers: { Origin: 'https://untrusted.example', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(calls.length, before);
});

test('malformed Qwen WAV is rejected without silent legacy fallback', async () => {
  corruptText = '손상 오디오를 검증하는 문장';
  const response = await request(chat.base, 'owner', '/api/chat/tts/audio', { messageId: answers.owner.corrupt, language: 'ko' });
  assert.equal(response.status, 502); assert.match(response.headers.get('content-type'), /application\/json/);
  assert.ok(!JSON.stringify(await response.json()).includes(token));
  corruptText = undefined;
});

test('live study and chat permission revocation cancels synthesis and prevents audio delivery', async () => {
  for (const kind of ['Study', 'Chat']) {
    const name = `revoked${kind}`, account = manager.list().find(value => value.username === name);
    const isStudy = kind === 'Study';
    if (isStudy) {
      const row = { ...privateQuestion, id: 'revocation-study-source', passage: '권한 회수 학습 대기' };
      assert.equal((await request(study.base, name, '/api/questions/import', { questions: [row] })).status, 200);
      holdText = row.passage;
    } else holdText = `권한 회수 대기 ${name}`;
    const started = new Promise(resolve => { holdStarted = resolve; });
    const pending = request(isStudy ? study.base : chat.base, name, isStudy ? '/api/tts/audio' : '/api/chat/tts/audio',
      isStudy ? { questionId: 'revocation-study-source', part: 'passage' } : { messageId: answers[name].complete, language: 'ko' });
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('synthesis did not start')), 5000).unref())]);
    const began = Date.now();
    await manager.update(account.id, { permissions: [isStudy ? 'chat' : 'study'] });
    const response = await pending;
    assert.notEqual(response.status, 200);
    assert.ok(!response.headers.get('content-type')?.startsWith('audio/'));
    await response.arrayBuffer();
    assert.ok(Date.now() - began < 5000, 'revocation must stop response within five seconds');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(heldClosed, true, 'Node must cancel the pending service HTTP response');
    holdText = undefined; holdStarted = undefined;
  }
});
