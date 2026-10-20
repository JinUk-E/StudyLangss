import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.mjs';
import { assert, LEVELS, AREAS, publicQuestion } from './lib/validation.mjs';
import { questions as seeds } from './content/questions.mjs';
import { loadAuth } from './lib/auth.mjs';
import { createTts } from './lib/tts.mjs';
import { resolveSpeechSource } from './lib/tts-source.mjs';
import { STELLA_LESSON_INSTRUCTIONS } from './lib/persona.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(root, 'public');
const dataDirectory = resolve(process.env.DATA_DIR || resolve(root, 'data'));
let authenticate;
try { authenticate = await loadAuth(resolve(process.env.AUTH_FILE || resolve(dataDirectory, 'auth.json'))); }
catch (error) { console.error(error.message); process.exit(1); }
const store = createStore(dataDirectory, seeds);
const tts = createTts({ cacheDir: resolve(dataDirectory, 'tts-cache') });
const PORT = Number(process.env.PORT || 3210), HOST = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
/** Parse a bounded JSON request without buffering unlimited user input. */
async function body(req) {
  assert((req.headers['content-type'] || '').toLowerCase().startsWith('application/json'), 'JSON 형식으로 보내 주세요.', 415);
  const limitMb = req.url?.split('?')[0] === '/api/restore' ? 32 : req.url?.split('?')[0] === '/api/questions/import' ? 5 : 1;
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; assert(size <= limitMb * 1024 * 1024, `요청은 ${limitMb}MB 이하여야 합니다.`, 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert(value && typeof value === 'object' && !Array.isArray(value), '객체 형식으로 보내 주세요.'); return value; } catch (error) { if (error.status) throw error; assert(false, 'JSON 형식을 확인해 주세요.'); }
}
const day = stamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp));
/** Read state for the selected level, using Seoul calendar days consistently. */
function state() {
  const settings = store.getSettings(), qs = new Map(store.questions().map(q => [q.id, q]));
  const attempts = store.attempts().filter(a => qs.get(a.questionId)?.level === settings.level);
  const now = new Date(), today = day(now), todays = attempts.filter(a => day(a.createdAt) === today);
  const reviewItems = store.reviews().filter(r => qs.get(r.questionId)?.level === settings.level).map(r => ({ ...r, prompt: qs.get(r.questionId).prompt, level: qs.get(r.questionId).level, area: qs.get(r.questionId).area }));
  const days = new Set(attempts.map(a => day(a.createdAt)));
  let streak = 0, cursor = new Date(now); if (!days.has(day(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(day(cursor))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return { settings, practice: store.practice.summary(settings.level), stats: { todayAnswered: todays.length, todayCorrect: todays.filter(a => a.correct).length, totalAnswered: attempts.length, accuracy: attempts.length ? Math.round(attempts.filter(a => a.correct).length / attempts.length * 100) : 0, dueCount: reviewItems.filter(r => r.dueAt <= now.toISOString()).length, streak }, areas: AREAS.map(area => ({ area, answered: attempts.filter(a => qs.get(a.questionId).area === area).length, correct: attempts.filter(a => qs.get(a.questionId).area === area && a.correct).length })), recentAttempts: attempts.slice(-30).reverse().map(a => ({ ...a, prompt: qs.get(a.questionId).prompt, area: qs.get(a.questionId).area, level: qs.get(a.questionId).level })), reviewItems };
}
let aiBusy = false;
async function ollama(path, options = {}) {
  const settings = store.getSettings();
  const response = await fetch(`${settings.ollamaUrl}${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(options.method ? 90000 : 5000) });
  assert(response.ok, `Ollama 응답 오류 (${response.status})`, 502);
  return response.json();
}
/** Route API requests. Correct answers are disclosed only by submitting an attempt. */
async function api(req, res, url) {
  const path = url.pathname, method = req.method;
  if (method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
  if (method === 'GET' && path === '/api/state') return json(res, 200, state());
  if (method === 'GET' && path === '/api/tts/voices') return json(res, 200, await tts.voices());
  if (method === 'POST' && path === '/api/tts/audio') {
    const { text, voice } = resolveSpeechSource(store, await body(req));
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnected);
    try {
      const audio = await tts.synthesize(text, { voice, signal: controller.signal });
      if (controller.signal.aborted || res.destroyed) return;
      res.writeHead(200, { 'Content-Type': audio.contentType, 'Content-Length': audio.buffer.length, 'Cache-Control': 'private, no-store' });
      res.end(audio.buffer);
    } finally { res.removeListener('close', disconnected); }
    return;
  }
  if (method === 'GET' && path === '/api/practice') {
    assert(!url.searchParams.has('language') || url.searchParams.get('language') === 'ja', '현재 일본어 연습만 지원합니다.');
    const level = url.searchParams.get('level') || store.getSettings().level;
    const kind = url.searchParams.get('kind') || 'words', queue = url.searchParams.get('queue') || 'recommended';
    const limit = Number(url.searchParams.get('limit') || 10);
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 50, '학습량은 1~50개입니다.');
    return json(res, 200, store.practice.list(level, kind, queue, limit));
  }
  if (method === 'GET' && path === '/api/practice/summary') return json(res, 200, { language: 'ja', level: store.getSettings().level, summary: store.practice.summary(store.getSettings().level) });
  if (method === 'POST' && path === '/api/practice/grade') { const input = await body(req); return json(res, 200, store.transaction(() => store.practice.grade(input))); }
  if (method === 'GET' && path === '/api/settings') return json(res, 200, store.getSettings());
  if (method === 'PUT' && path === '/api/settings') return json(res, 200, store.setSettings({ ...store.getSettings(), ...await body(req) }));
  if (method === 'GET' && path === '/api/questions') {
    const level = url.searchParams.get('level') || store.getSettings().level, mode = url.searchParams.get('mode') || 'study', area = url.searchParams.get('area') || 'all';
    assert(LEVELS.includes(level) && ['study', 'review'].includes(mode) && ['all', ...AREAS].includes(area), '학습 필터를 확인해 주세요.');
    const due = new Set(store.reviews().filter(r => r.dueAt <= new Date().toISOString()).map(r => r.questionId));
    let qs = store.questions().filter(q => q.level === level && (area === 'all' || q.area === area) && (mode !== 'review' || due.has(q.id)));
    if (mode === 'study') { const counts = new Map(); for (const a of store.attempts()) counts.set(a.questionId, (counts.get(a.questionId) || 0) + 1); qs.sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0)); }
    return json(res, 200, { questions: qs.map(publicQuestion), total: qs.length });
  }
  if (method === 'POST' && path === '/api/questions/import') return json(res, 200, store.importQuestions((await body(req)).questions));
  if (method === 'GET' && /^\/api\/questions\/[^/]+$/.test(path)) return json(res, 200, publicQuestion(store.question(decodeURIComponent(path.split('/').pop()))));
  if (method === 'POST' && path === '/api/attempts') return json(res, 201, store.attempt(await body(req)));
  if (method === 'GET' && path === '/api/reviews') {
    const level = url.searchParams.get('level') || store.getSettings().level;
    assert(LEVELS.includes(level), '목표 급수를 확인해 주세요.');
    return json(res, 200, { items: store.reviews().map(r => ({ ...publicQuestion(store.question(r.questionId)), ...r })).filter(q => q.level === level) });
  }
  if (method === 'POST' && /^\/api\/reviews\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop());
    assert(store.attempts().some(a => a.questionId === id), '먼저 문제를 풀어 주세요.', 409);
    return json(res, 200, store.review(id, (await body(req)).rating));
  }
  if (method === 'GET' && path === '/api/ollama/models') {
    try { const data = await ollama('/api/tags'); return json(res, 200, { available: true, models: (data.models || []).map(m => ({ name: m.name })) }); }
    catch { return json(res, 200, { available: false, models: [], error: 'Ollama에 연결하지 못했습니다. 실행 여부와 주소를 확인해 주세요.' }); }
  }
  if (method === 'POST' && path === '/api/ai/explain') {
    const input = await body(req), q = store.question(input.questionId);
    assert(store.attempts().some(a => a.questionId === q.id), '답안을 제출한 뒤 AI 설명을 요청할 수 있습니다.', 409);
    assert(input.question === undefined || (typeof input.question === 'string' && input.question.length <= 2000), '질문은 2000자 이하여야 합니다.');
    const settings = store.getSettings(); assert(settings.ollamaModel, '설정에서 Ollama 모델을 선택해 주세요.', 409);
    const cacheKey = createHash('sha256').update(JSON.stringify([STELLA_LESSON_INSTRUCTIONS, q, input.question || '', settings.ollamaUrl, settings.ollamaModel])).digest('hex');
    const cached = store.db.prepare('SELECT text FROM ai_cache WHERE key=?').get(cacheKey);
    if (cached) return json(res, 200, { text: cached.text, cached: true });
    assert(!aiBusy, 'AI가 설명을 작성 중입니다. 잠시 후 다시 시도해 주세요.', 429); aiBusy = true;
    try {
      const result = await ollama('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: settings.ollamaModel, stream: false, messages: [{ role: 'system', content: STELLA_LESSON_INSTRUCTIONS }, { role: 'user', content: JSON.stringify({ level: q.level, prompt: q.prompt, passage: q.passage, choices: q.choices, answer: q.choices[q.answerIndex], explanation: q.explanation, learnerQuestion: input.question || '이 문제를 이해하기 쉽게 설명해 주세요.' }) }], options: { temperature: 0.3, num_predict: 1200, num_ctx: 8192 } }) });
      assert(typeof result.message?.content === 'string' && result.message.content.trim(), 'AI가 비어 있는 응답을 반환했습니다.', 502); store.db.prepare('INSERT OR REPLACE INTO ai_cache VALUES (?,?)').run(cacheKey, result.message.content); return json(res, 200, { text: result.message.content });
    } finally { aiBusy = false; }
  }
  if (method === 'GET' && path === '/api/backup') { res.setHeader('Content-Disposition', `attachment; filename="jlpt-backup-${new Date().toISOString().slice(0, 10)}.json"`); return json(res, 200, store.backup()); }
  if (method === 'POST' && path === '/api/restore') return json(res, 200, store.restore(await body(req)));
  return json(res, 404, { error: '요청한 API를 찾을 수 없습니다.' });
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
  try {
    if (!await authenticate(req, res)) return;
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      assert(req.headers['sec-fetch-site'] !== 'cross-site', '다른 사이트에서의 요청은 허용하지 않습니다.', 403);
      if (req.headers.origin) { let origin; try { origin = new URL(req.headers.origin); } catch { assert(false, '요청 출처를 확인할 수 없습니다.', 403); } assert(origin.host === req.headers.host && ['http:', 'https:'].includes(origin.protocol), '다른 사이트에서의 요청은 허용하지 않습니다.', 403); }
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    assert(req.method === 'GET' || req.method === 'HEAD', '허용하지 않는 요청입니다.', 405);
    const pathname = decodeURIComponent(url.pathname), filename = resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
    assert(filename.startsWith(publicDir + sep), '허용하지 않는 경로입니다.', 403);
    const data = await readFile(filename);
    res.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : ['TimeoutError', 'AbortError'].includes(error.name) ? 504 : error instanceof URIError ? 400 : 500);
    if (status >= 500) console.error(JSON.stringify({ event: 'request_error', path: req.url, message: error.message }));
    if (!res.headersSent) json(res, status, { error: error.status ? error.message : status === 404 ? '파일을 찾을 수 없습니다.' : status === 504 ? 'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.' : '요청을 처리하지 못했습니다. 서버 상태를 확인해 주세요.' }); else res.end();
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 10000;
server.listen(PORT, HOST, () => console.log(`JLPT Study is running at http://${HOST}:${server.address().port}`));
let stopping = false;
function shutdown() {
  if (stopping) return; stopping = true;
  const closed = Promise.resolve(tts.close()).catch(() => {});
  server.close(async () => { await closed; store.db.close(); process.exit(0); });
  server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); store.db.close(); process.exit(0); }, 5000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
