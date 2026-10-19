import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { questions } from '../content/questions.mjs';
import { createStore } from '../lib/store.mjs';
import { schedule } from '../lib/validation.mjs';
import { createCredentials } from '../lib/auth.mjs';

// Disposable integration-test account, never a production default.
const testUser = 'haru-test', testPassword = 'test-only-password:2026';
const authorization = `Basic ${Buffer.from(`${testUser}:${testPassword}`).toString('base64')}`;

let child, directory, base, output = '';
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'haru-integration-'));
  await writeFile(join(directory, 'auth.json'), JSON.stringify(await createCredentials(testUser, testPassword)), { mode: 0o600 });
  child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: directory, AUTH_FILE: join(directory, 'auth.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server readiness timeout: ${output}`)), 15000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && Number(match[1])) { base = match[0]; clearTimeout(timeout); resolve(); }
    });
  });
});
after(async () => {
  if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function api(path, method = 'GET', payload, headers = {}) {
  const response = await fetch(base + path, { method, headers: { Authorization: authorization, ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: payload ? JSON.stringify(payload) : undefined });
  return { status: response.status, data: await response.json() };
}

test('Japanese practice API follows target level, validates filters, and guards listening records', async () => {
  await api('/api/settings', 'PUT', { level: 'N4' });
  const bank = (await api('/api/practice?kind=words')).data;
  assert.equal(bank.level, 'N4'); assert.equal(bank.language, 'ja'); assert.equal(bank.count, 12);
  assert.ok(bank.items.every(item => item.level === 'N4' && item.language === 'ja'));
  for (const query of ['kind=unknown', 'level=N0', 'queue=invalid', 'limit=-1', 'limit=1.5', 'language=en']) assert.equal((await api(`/api/practice?${query}`)).status, 400);
  const input = { requestId: 'api-practice-0001', entryId: bank.items[0].id, kind: 'listening', rating: 'good', durationMs: 5000, answer: '' };
  assert.equal((await api('/api/practice/grade', 'POST', input)).status, 400);
  const result = await api('/api/practice/grade', 'POST', { ...input, listened: true });
  assert.equal(result.status, 200); assert.equal(result.data.match, null);
  assert.equal((await api('/api/practice/grade', 'POST', { ...input, listened: true })).data.duplicate, true);
  assert.equal((await api('/api/practice/grade', 'POST', { ...input, listened: true, rating: 'easy' })).status, 409);
  const state = (await api('/api/state')).data;
  assert.equal(state.practice.listening.reviewsToday, 1); assert.equal(state.practice.words.reviewsToday, 0);
  assert.equal(state.stats.todayAnswered, 0);
  assert.equal((await api('/api/practice/summary')).data.summary.listening.seen, 1);
  assert.equal((await api('/api/practice/grade', 'POST', { ...input, entryId: {}, listened: true })).status, 400);
  assert.equal((await api('/api/practice/grade', 'POST', { ...input, listened: true }, { Origin: 'https://untrusted.example' })).status, 403);
});

test('all five levels have original examples in every area with valid answers', () => {
  assert.equal(new Set(questions.map(q => q.id)).size, questions.length);
  for (const level of ['N5', 'N4', 'N3', 'N2', 'N1']) {
    assert.ok(questions.filter(q => q.level === level).length >= 12);
    for (const area of ['vocabulary', 'grammar', 'reading', 'listening']) assert.ok(questions.some(q => q.level === level && q.area === area));
  }
  for (const q of questions) { assert.equal(q.choices.length, 4); assert.ok(q.choices[q.answerIndex]); assert.ok(q.explanation); assert.match(q.source, /공식 기출 아님/); }
});

test('all pages and APIs require authentication, including backup, writes, and health', async () => {
  for (const path of ['/', '/app.js', '/styles.css', '/practice.js', '/speech.js', '/api/practice', '/api/practice/summary', '/api/health', '/api/state', '/api/settings', '/api/backup', '/api/questions', '/api/reviews', '/api/ollama/models']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 401, path); assert.match(response.headers.get('www-authenticate'), /Basic realm="HARU"/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const [path, method] of [['/api/practice/grade', 'POST'], ['/api/restore', 'POST'], ['/api/ai/explain', 'POST'], ['/api/attempts', 'POST'], ['/api/settings', 'PUT'], ['/api/questions/import', 'POST']]) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-User': testUser }, body: '{}' });
    assert.equal(response.status, 401, path);
  }
  for (const method of ['HEAD', 'OPTIONS']) assert.equal((await fetch(base + '/', { method })).status, 401);
  assert.equal((await fetch(base + '/', { headers: { Authorization: authorization } })).status, 200);
});

test('wrong or malformed credentials fail and forwarded identity cannot bypass authentication', async () => {
  for (const value of ['Bearer anything', 'Basic !!!', 'Basic eA==', `Basic ${Buffer.from(`${testUser}:wrong`).toString('base64')}`, `Basic ${Buffer.from(`other:${testPassword}`).toString('base64')}`]) {
    assert.equal((await fetch(base + '/api/state', { headers: { Authorization: value } })).status, 401);
  }
  assert.equal((await api('/api/health')).status, 200);
  const backup = (await api('/api/backup')).data;
  assert.equal('auth' in backup, false); assert.equal('password' in backup, false);
  assert.ok(!JSON.stringify(backup).includes(testPassword));
});

test('HTTPS reverse proxy preserves authenticated writes when original Host is forwarded', async () => {
  const throughProxy = host => new Promise((resolve, reject) => {
    const req = request(`${base}/api/settings`, { method: 'PUT', headers: { Host: host, Origin: 'https://jlpt.example.com', Authorization: authorization, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end(JSON.stringify({ level: 'N5' }));
  });
  assert.equal(await throughProxy('jlpt.example.com'), 200);
  assert.equal(await throughProxy('127.0.0.1:3210'), 403);
});

test('missing or corrupt credentials stop startup instead of allowing anonymous access', async () => {
  const missingFile = join(directory, 'missing-auth.json'), corruptFile = join(directory, 'corrupt-auth.json');
  await writeFile(corruptFile, JSON.stringify({ username: 'haru', password: 'plaintext-is-not-supported' }));
  for (const filename of [missingFile, corruptFile]) {
    const run = spawnSync(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '0', DATA_DIR: directory, AUTH_FILE: filename }, encoding: 'utf8', timeout: 5000 });
    assert.equal(run.status, 1); assert.match(run.stderr, /setup-auth/); assert.ok(!run.stdout.includes('running'));
  }
});

test('goal level is validated, persists, and filters question banks', async () => {
  for (const level of ['N1', 'N2', 'N3', 'N4', 'N5']) {
    assert.equal((await api('/api/settings', 'PUT', { level })).status, 200);
    assert.equal((await api('/api/state')).data.settings.level, level);
    const bank = await api('/api/questions');
    assert.ok(bank.data.questions.length >= 12);
    assert.ok(bank.data.questions.every(q => q.level === level));
    assert.ok(bank.data.questions.every(q => !('answerIndex' in q) && !('explanation' in q)));
  }
  assert.equal((await api('/api/settings', 'PUT', { level: 'N0' })).status, 400);
  assert.equal((await api('/api/settings')).data.level, 'N5');
  assert.equal((await api('/api/settings', 'PUT', { ollamaUrl: 'http://example.com' })).status, 400);
});

test('answer submission records real results and schedules reviews; AI requires submission', async () => {
  const q = questions.find(q => q.level === 'N5');
  assert.equal((await api('/api/ai/explain', 'POST', { questionId: q.id })).status, 409);
  const wrong = await api('/api/attempts', 'POST', { questionId: q.id, answerIndex: (q.answerIndex + 1) % 4, durationMs: 1200 });
  assert.equal(wrong.status, 201); assert.equal(wrong.data.correct, false); assert.equal(wrong.data.answerIndex, q.answerIndex); assert.ok(wrong.data.explanation);
  assert.ok(Date.parse(wrong.data.reviewDueAt) > Date.now());
  assert.ok(Date.parse(wrong.data.reviewDueAt) < Date.now() + 11 * 60000);
  const right = await api('/api/attempts', 'POST', { questionId: q.id, answerIndex: q.answerIndex, durationMs: 1400 });
  assert.equal(right.data.correct, true);
  const { stats } = (await api('/api/state')).data;
  assert.equal(stats.totalAnswered, 2); assert.equal(stats.accuracy, 50);
  assert.ok((await api('/api/reviews')).data.items.some(item => item.id === q.id));
  const saved = (await api('/api/backup')).data;
  assert.equal((await api('/api/attempts', 'POST', { questionId: q.id, answerIndex: 100, durationMs: 1 })).status, 400);
  assert.deepEqual((await api('/api/backup')).data.attempts, saved.attempts);
});

test('backup restore is atomic and round-trips settings, questions, attempts, and reviews', async () => {
  const authBefore = await readFile(join(directory, 'auth.json'), 'utf8');
  const backup = (await api('/api/backup')).data;
  assert.equal(backup.schemaVersion, 2);
  const broken = structuredClone(backup); broken.attempts[0].questionId = 'missing';
  assert.equal((await api('/api/restore', 'POST', broken)).status, 400);
  assert.deepEqual((await api('/api/backup')).data.attempts, backup.attempts);
  await api('/api/settings', 'PUT', { level: 'N2' });
  assert.equal((await api('/api/restore', 'POST', backup)).status, 200);
  const restored = (await api('/api/backup')).data;
  for (const key of ['settings', 'questions', 'attempts', 'reviews']) assert.deepEqual(restored[key], backup[key]);
  assert.equal(await readFile(join(directory, 'auth.json'), 'utf8'), authBefore);
});

test('imports validate the entire batch and cross-site writes are rejected', async () => {
  const q = { ...questions[0], id: 'custom-test-01' };
  assert.equal((await api('/api/questions/import', 'POST', { questions: [q, { ...q, id: 'custom-broken', answerIndex: 999 }] })).status, 400);
  assert.equal((await api('/api/questions/custom-test-01')).status, 404);
  assert.equal((await api('/api/questions/import', 'POST', { questions: [q] })).status, 200);
  assert.equal((await api('/api/questions/custom-test-01')).status, 200);
  assert.equal((await api('/api/settings', 'PUT', { level: 'N1' }, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await api('/api/settings')).data.level, 'N5');
});

test('Ollama integration sends stored answers server-side and caches successful explanations', async () => {
  let calls = 0;
  const mock = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'local-test-model' }] }));
    let text = ''; for await (const chunk of req) text += chunk;
    const payload = JSON.parse(text);
    assert.equal(payload.model, 'local-test-model'); assert.equal(payload.stream, false);
    assert.ok(JSON.parse(payload.messages[1].content).answer); calls++;
    res.end(JSON.stringify({ message: { content: '한국어 테스트 해설입니다.' } }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const old = (await api('/api/settings')).data;
  try {
    await api('/api/settings', 'PUT', { ollamaUrl: `http://127.0.0.1:${mock.address().port}`, ollamaModel: 'local-test-model' });
    const models = (await api('/api/ollama/models')).data;
    assert.equal(models.available, true); assert.equal(models.models[0].name, 'local-test-model');
    const input = { questionId: questions.find(q => q.level === 'N5').id, question: '선택지 차이를 알려 주세요.' };
    const first = await api('/api/ai/explain', 'POST', input), second = await api('/api/ai/explain', 'POST', input);
    assert.equal(first.status, 200); assert.equal(first.data.text, '한국어 테스트 해설입니다.');
    assert.equal(second.data.text, first.data.text); assert.equal(calls, 1);
  } finally { await api('/api/settings', 'PUT', old); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); }
});

test('SQLite data survives closing and reopening the database', async () => {
  const path = await mkdtemp(join(tmpdir(), 'haru-persistence-'));
  let store;
  try {
    store = createStore(path, questions); store.setSettings({ ...store.getSettings(), level: 'N1' });
    const q = questions[0]; store.attempt({ questionId: q.id, answerIndex: q.answerIndex, durationMs: 2000 }); store.db.close();
    store = createStore(path, questions); assert.equal(store.getSettings().level, 'N1'); assert.equal(store.attempts().length, 1); assert.equal(store.reviews().length, 1);
  } finally { store?.db.close(); await rm(path, { recursive: true, force: true }); }
});

test('review intervals expand on recall and reset on a miss', () => {
  const now = new Date('2026-10-19T00:00:00Z');
  const first = schedule(null, 'good', now), second = schedule(first, 'good', now), missed = schedule(second, 'again', now);
  assert.equal(first.intervalDays, 1); assert.equal(second.intervalDays, 2); assert.ok(missed.intervalDays < 1);
  assert.ok(schedule({ intervalDays: 179 }, 'easy', now).intervalDays <= 180);
});
