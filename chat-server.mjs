import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAuth } from './lib/auth.mjs';
import { assert } from './lib/validation.mjs';
import { createChatStore } from './lib/chat-store.mjs';
import { createUpstream, localEndpoint, modelContext } from './lib/chat-upstream.mjs';
import { servePwaAsset } from './lib/pwa-assets.mjs';
import { requireAccess } from './lib/access.mjs';
import { createUserStores } from './lib/user-stores.mjs';
import { createRuntimeHealth } from './lib/runtime-health.mjs';
import { createAppTts } from './lib/qwen-tts.mjs';
import { resolveChatSpeechSource } from './lib/tts-source.mjs';
import { sendSpeech } from './lib/tts-response.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtimeHealth = await createRuntimeHealth(root, 'chat');
const data = resolve(process.env.CHAT_DATA_DIR || resolve(root, 'data/chat'));
let authenticate;
try { authenticate = await loadAuth(resolve(process.env.AUTH_FILE || resolve(root, 'data/auth.json'))); }
catch (error) { console.error(error.message); process.exit(1); }
const stores = createUserStores(data, createChatStore, 'chat.sqlite');
const tts = createAppTts({ root, cacheDir: resolve(data, 'tts-cache'), namespace: 'chat' });
const upstream = createUpstream({ ollama: localEndpoint(process.env.CHAT_OLLAMA_URL || 'http://127.0.0.1:11434'), search: localEndpoint(process.env.CHAT_SEARCH_URL || 'http://127.0.0.1:8811') });
const host = process.env.CHAT_HOST || '127.0.0.1', port = Number(process.env.CHAT_PORT || 3211);
const active = new Map();
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const staticFiles = new Map([
  ['/chat/', ['index.html', 'text/html']], ['/chat/app.js', ['app.js', 'text/javascript']], ['/chat/styles.css', ['styles.css', 'text/css']],
  ['/chat/speech.js', ['../speech.js', 'text/javascript']],
  ['/shared/shell.js', ['../shared/shell.js', 'text/javascript']], ['/shared/shell.css', ['../shared/shell.css', 'text/css']]
]);

async function body(req) {
  assert((req.headers['content-type'] || '').toLowerCase().startsWith('application/json'), 'JSON 요청이 필요합니다.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; assert(size <= 65536, '요청이 너무 큽니다.', 413); chunks.push(chunk); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { assert(false, 'JSON 형식이 올바르지 않습니다.'); }
  assert(value && typeof value === 'object' && !Array.isArray(value), '객체 형식이 필요합니다.');
  return value;
}

function sameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  assert(req.headers['sec-fetch-site'] !== 'cross-site', '다른 사이트에서의 요청은 허용하지 않습니다.', 403);
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { assert(false, '요청 출처가 올바르지 않습니다.', 403); }
    assert(['https:', 'http:'].includes(origin.protocol) && origin.host === req.headers.host, '다른 사이트에서의 요청은 허용하지 않습니다.', 403);
  }
}

async function send(req, res, id, input, store, user) {
  assert(typeof input.content === 'string' && input.content.trim().length > 0 && input.content.length <= 12000, '메시지는 1~12,000자로 입력하세요.');
  assert(typeof input.model === 'string' && input.model.length <= 160, '모델을 선택하세요.');
  assert(input.search === undefined || typeof input.search === 'boolean', '검색 설정이 올바르지 않습니다.');
  assert(!active.size, '다른 답변을 작성 중입니다. 완료 후 다시 보내 주세요.', 409);
  const controller = new AbortController();
  const activeKey = `${user.id}:${id}`;
  active.set(activeKey, controller);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]);
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', disconnect);
  let assistantId, text = '', sources = [], status = 'error', heartbeat;
  const accessCheck = setInterval(() => {
    try { if (!authenticate.accounts.current(user, 'chat')) controller.abort(); }
    catch { controller.abort(); }
  }, 2000);
  const emit = event => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  try {
    const models = await upstream.models(signal);
    assert(models.some(model => model.name === input.model), '이 Mac에 설치된 대화 모델을 선택하세요.');
    signal.throwIfAborted();
    assert(authenticate.accounts.current(user, 'chat'), '계정이나 AI 대화 권한이 변경되어 답변을 중단했습니다.', 403);
    assistantId = store.begin(id, input.content.trim(), input.model);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
    emit({ type: 'start', thread: store.thread(id) });
    heartbeat = setInterval(() => emit({ type: 'ping' }), 15000);
    if (input.search) {
      emit({ type: 'status', text: '웹에서 관련 자료를 찾고 있어요…' });
      try {
        sources = await upstream.search(input.content.trim(), signal);
        emit({ type: 'sources', sources });
        if (!sources.length) emit({ type: 'warning', text: '검색 결과가 없어 모델의 지식으로 답합니다.' });
      } catch {
        signal.throwIfAborted();
        emit({ type: 'warning', text: '웹 검색에 연결하지 못했습니다. 검색 근거 없이 답합니다.' });
      }
    }
    emit({ type: 'status', text: '답변을 작성하고 있어요…' });
    for await (const item of upstream.generate(input.model, modelContext(store.messages(id), sources), signal)) {
      if (typeof item.message?.content === 'string' && item.message.content) {
        text += item.message.content;
        assert(text.length <= 200000, '답변 길이가 제한을 초과했습니다.', 502);
        emit({ type: 'delta', text: item.message.content });
      }
    }
    assert(text.trim(), '모델이 빈 답변을 반환했습니다. 다시 시도해 주세요.', 502);
    status = 'complete';
    store.finish(assistantId, text, status, sources);
    emit({ type: 'done', complete: true, messageId: assistantId });
  } catch (error) {
    status = signal.aborted ? 'interrupted' : 'error';
    if (assistantId) store.finish(assistantId, text, status, sources);
    const message = signal.aborted ? '답변이 중단되었거나 제한 시간(5분)을 초과했습니다.' : error.status ? error.message : '답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    if (res.headersSent) emit({ type: 'error', text: message });
    else if (!res.destroyed) json(res, error.status || 502, { error: message });
  } finally {
    clearInterval(heartbeat); clearInterval(accessCheck); controller.abort(); active.delete(activeKey); res.off('close', disconnect);
    if (!res.destroyed) res.end();
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if (runtimeHealth(req, res)) return;
    if (await servePwaAsset(req, res, root)) return;
    const path = new URL(req.url, 'http://localhost').pathname, method = req.method;
    if (method === 'GET' && path === '/api/chat/session') return json(res, 200, { user: await authenticate(req, res, { optional: true }) || null });
    if (!await authenticate(req, res)) return;
    sameOrigin(req);
    const sharedAsset = ['/shared/shell.js', '/shared/shell.css'].includes(path) && ['GET', 'HEAD'].includes(method);
    if (!sharedAsset && !requireAccess(req, res, 'chat')) return;
    if (path === '/chat' && ['GET', 'HEAD'].includes(method)) { res.writeHead(302, { Location: '/chat/' }); return res.end(); }
    if (staticFiles.has(path) && ['GET', 'HEAD'].includes(method)) {
      const [file, mime] = staticFiles.get(path);
      const content = await readFile(resolve(root, 'public/chat', file));
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); return res.end(method === 'HEAD' ? undefined : content);
    }
    if (path === '/api/chat/health' && method === 'GET') return json(res, 200, { ok: true });
    if (path === '/api/chat/me' && method === 'GET') return json(res, 200, { user: { id: req.user.id, username: req.user.username, permissions: req.user.permissions, isAdmin: req.user.isAdmin } });
    if (path === '/api/chat/models' && method === 'GET') return json(res, 200, { models: await upstream.models(AbortSignal.timeout(10000)) });
    if (path === '/api/chat/tts/voices' && method === 'GET') return json(res, 200, await tts.voices());
    const store = stores.get(req.user);
    if (path === '/api/chat/tts/audio' && method === 'POST') return await sendSpeech(req, res, { tts, source: resolveChatSpeechSource(store, await body(req)), accounts: authenticate.accounts, permission: 'chat' });
    if (path === '/api/chat/threads') {
      if (method === 'GET') return json(res, 200, { threads: store.list() });
      if (method === 'POST') {
        const input = await body(req);
        assert(typeof input.model === 'string' && input.model.length > 0 && input.model.length <= 160, '모델을 선택하세요.');
        return json(res, 201, { thread: store.create(input.model) });
      }
    }
    const match = path.match(/^\/api\/chat\/threads\/([a-f0-9-]{36})(\/messages)?$/);
    if (match) {
      const id = match[1], thread = store.thread(id), activeKey = `${req.user.id}:${id}`;
      assert(thread, '대화를 찾을 수 없습니다.', 404);
      if (!match[2] && method === 'GET') return json(res, 200, { thread, messages: store.messages(id), busy: active.has(activeKey) });
      if (!match[2] && method === 'DELETE') {
        assert(!active.has(activeKey), '답변을 중지한 뒤 삭제해 주세요.', 409);
        store.remove(id); return json(res, 200, { deleted: true });
      }
      if (match[2] && method === 'POST') return await send(req, res, id, await body(req), store, req.user);
    }
    json(res, 404, { error: '요청한 경로를 찾을 수 없습니다.' });
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '요청을 처리하지 못했습니다.' });
    else res.end();
  }
});
server.requestTimeout = 30000; server.headersTimeout = 10000;
server.listen(port, host, () => console.log(`Starlight Chat is running at http://${host}:${server.address().port}`));
let closing = false;
function shutdown() {
  if (closing) return; closing = true;
  for (const controller of active.values()) controller.abort();
  const closed = Promise.resolve(tts.close()).catch(() => {});
  server.close(() => { closed.finally(() => { stores.close(); authenticate.accounts.close(); process.exit(0); }); });
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 5000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
