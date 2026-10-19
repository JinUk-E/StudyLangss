const $ = selector => document.querySelector(selector);
const state = { id: null, busy: false, models: [], controller: null, messages: [] };
const preference = {
  get(key) { try { return localStorage.getItem(`starlight.${key}`); } catch { return null; } },
  set(key, value) { try { if (value === null) localStorage.removeItem(`starlight.${key}`); else localStorage.setItem(`starlight.${key}`, value); } catch {} }
};
const notice = text => { $('#notice').textContent = text; };
async function api(path, options = {}) {
  const response = await fetch(`/api/chat${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `요청을 처리하지 못했습니다 (${response.status}).`);
  return data;
}
function element(tag, text, className) {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el;
}
function inline(target, text) {
  // Render a small Markdown subset with DOM text nodes; model HTML never executes.
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g; let end = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(end, match.index)));
    const code = match[0].startsWith('`');
    target.append(element(code ? 'code' : 'strong', match[0].slice(code ? 1 : 2, code ? -1 : -2)));
    end = match.index + match[0].length;
  }
  target.append(document.createTextNode(text.slice(end)));
}
function markdown(target, text) {
  const fragment = document.createDocumentFragment();
  const sections = text.split(/```/);
  sections.forEach((part, index) => {
    if (index % 2) {
      const newline = part.indexOf('\n'), language = newline < 0 ? '' : part.slice(0, newline), content = newline < 0 ? part : part.slice(newline + 1);
      const block = element('div', undefined, 'code-block'), label = element('div', undefined, 'code-label');
      label.append(element('span', language.slice(0, 30) || 'code'));
      const copy = element('button', '복사'); copy.type = 'button';
      copy.onclick = async () => { try { await navigator.clipboard.writeText(content); copy.textContent = '복사됨'; } catch { notice('코드를 선택해 복사해 주세요.'); } };
      label.append(copy); const pre = element('pre'); pre.append(element('code', content)); block.append(label, pre); fragment.append(block);
    } else {
      for (const paragraph of part.split(/\n\s*\n/)) {
        if (!paragraph.trim()) continue;
        const lines = paragraph.trim().split('\n');
        if (lines.every(line => /^\s*[-*] /.test(line))) {
          const list = element('ul'); for (const line of lines) { const item = element('li'); inline(item, line.replace(/^\s*[-*] /, '')); list.append(item); } fragment.append(list);
        } else if (lines.every(line => /^\s*\d+[.)] /.test(line))) {
          const list = element('ol'); for (const line of lines) { const item = element('li'); inline(item, line.replace(/^\s*\d+[.)] /, '')); list.append(item); } fragment.append(list);
        } else {
          const heading = /^#{1,6}\s/.test(paragraph.trim());
          const p = element(heading ? 'h3' : 'p'); inline(p, paragraph.trim().replace(/^#{1,6}\s/, '')); fragment.append(p);
        }
      }
    }
  });
  target.replaceChildren(fragment);
}
function sourceCards(sources) {
  const list = element('div', undefined, 'sources');
  sources.forEach((source, i) => {
    try {
      const url = new URL(source.url); if (!['http:', 'https:'].includes(url.protocol)) return;
      const a = element('a', undefined, 'source'); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = source.snippet;
      a.append(element('strong', `[${i + 1}] ${source.title}`), element('small', url.hostname)); list.append(a);
    } catch {}
  });
  return list;
}
function messageElement(message) {
  const article = element('article', undefined, `message ${message.role}`);
  const head = element('div', undefined, 'message-head');
  head.append(element('span', message.role === 'user' ? '나' : '✦', 'avatar'), element('span', message.role === 'user' ? '나' : (message.model || '별빛공방')));
  const body = element('div', undefined, 'message-body');
  if (message.role === 'user') { const p = element('p', message.content); body.append(p); }
  else markdown(body, message.content);
  article.append(head, body, sourceCards(message.sources || []));
  if (['error', 'interrupted'].includes(message.status)) article.append(element('div', message.status === 'interrupted' ? '중단된 답변입니다.' : '완료되지 않은 답변입니다. 다시 질문해 주세요.', 'message-status'));
  return article;
}
function bottom(force = false) {
  const view = $('#conversation'); if (force || view.scrollHeight - view.scrollTop - view.clientHeight < 200) view.scrollTop = view.scrollHeight;
}
function setBusy(value) {
  state.busy = value; $('#stop').hidden = !value; $('#send').hidden = value;
  $('#send').disabled = value || !state.models.length || !$('#prompt').value.trim();
  for (const selector of ['#model', '#new-chat', '#delete-chat', '#web-search', '#refresh-models']) $(selector).disabled = value;
  document.querySelectorAll('.thread').forEach(button => { button.disabled = value; });
}
async function loadModels() {
  $('#refresh-models').disabled = true;
  try {
    const data = await api('/models'), previous = $('#model').value || preference.get('model');
    state.models = data.models; $('#model').replaceChildren();
    for (const model of data.models) { const option = element('option', model.name); option.value = model.name; $('#model').append(option); }
    if (data.models.some(m => m.name === previous)) $('#model').value = previous;
    if (!data.models.length) { const option = element('option', '사용 가능한 모델 없음'); option.value = ''; $('#model').append(option); notice('설치된 대화 모델이 없습니다.'); }
    else notice('');
  } catch (error) { notice(error.message); }
  finally { setBusy(state.busy); }
}
async function loadThreads() {
  const { threads } = await api('/threads'); $('#threads').replaceChildren(); $('#thread-count').textContent = threads.length || '';
  if (!threads.length) $('#threads').append(element('p', '첫 대화를 시작해 보세요.', 'muted'));
  for (const thread of threads) {
    const button = element('button', thread.title, `thread${thread.id === state.id ? ' active' : ''}`);
    button.disabled = state.busy; button.title = thread.title; button.onclick = () => openThread(thread.id).catch(e => notice(e.message)); $('#threads').append(button);
  }
}
function closeMenu() { document.body.classList.remove('menu-open'); $('#menu').setAttribute('aria-expanded', 'false'); }
async function openThread(id) {
  if (state.busy) return;
  const data = await api(`/threads/${id}`); state.id = id; state.messages = data.messages;
  preference.set('thread', id); $('#thread-title').textContent = data.thread.title;
  $('#delete-chat').hidden = false; $('#welcome').hidden = data.messages.length > 0;
  $('#messages').replaceChildren(...data.messages.map(messageElement));
  if (state.models.some(m => m.name === data.thread.model)) $('#model').value = data.thread.model;
  notice(data.busy ? '이 대화에서 답변을 작성 중입니다. 잠시 후 다시 열어 주세요.' : '');
  closeMenu(); await loadThreads(); bottom(true);
}
function newChat() {
  if (state.busy) return;
  state.id = null; state.messages = []; preference.set('thread', null);
  $('#messages').replaceChildren(); $('#welcome').hidden = false; $('#delete-chat').hidden = true;
  $('#thread-title').textContent = '새로운 생각을 시작해 볼까요?'; notice(''); closeMenu();
  document.querySelectorAll('.thread').forEach(button => button.classList.remove('active')); $('#prompt').focus();
}

async function submit(event) {
  event.preventDefault();
  const content = $('#prompt').value.trim(), model = $('#model').value;
  if (state.busy || !content || !model) return;
  setBusy(true); notice(''); preference.set('model', model);
  const controller = new AbortController(); state.controller = controller;
  let bodyEl, output = '', sourceList = [], warning = '', errorText = '', completed = false, frame;
  const draw = () => { if (bodyEl) { markdown(bodyEl, output); bottom(); } };
  try {
    if (!state.id) {
      const data = await api('/threads', { method: 'POST', body: JSON.stringify({ model }), signal: controller.signal });
      state.id = data.thread.id; preference.set('thread', state.id);
    }
    $('#welcome').hidden = true; $('#delete-chat').hidden = false; $('#prompt').value = ''; $('#prompt').style.height = '';
    $('#messages').append(messageElement({ role: 'user', content }));
    const assistant = messageElement({ role: 'assistant', content: '', model }); $('#messages').append(assistant);
    bodyEl = assistant.querySelector('.message-body'); bodyEl.classList.add('typing'); bottom(true);
    const response = await fetch(`/api/chat/threads/${state.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ content, model, search: $('#web-search').checked })
    });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || '메시지를 보내지 못했습니다.'); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    const consume = line => {
      if (!line.trim()) return;
      const item = JSON.parse(line);
      if (item.type === 'start') { $('#thread-title').textContent = item.thread.title; loadThreads().catch(() => {}); }
      if (item.type === 'delta') { output += item.text; if (!frame) frame = setTimeout(() => { frame = null; draw(); }, 60); }
      if (item.type === 'status') notice(warning || item.text);
      if (item.type === 'warning') { warning = item.text; notice(warning); }
      if (item.type === 'sources') { sourceList = item.sources; assistant.querySelector('.sources').replaceWith(sourceCards(sourceList)); }
      if (item.type === 'error') { errorText = item.text; notice(item.text); }
      if (item.type === 'done') completed = true;
    };
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index; while ((index = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    consume(buffer + decoder.decode());
    if (!completed && !errorText) errorText = '연결이 끊겼습니다. 대화 기록에서 저장된 내용을 확인해 주세요.';
    notice(errorText || warning);
    if (errorText) assistant.append(element('div', errorText, 'message-status'));
  } catch (error) {
    errorText = controller.signal.aborted ? '답변을 중지했습니다.' : error.message; notice(errorText);
    if (!output) $('#prompt').value = content;
    if (bodyEl) bodyEl.parentElement.append(element('div', errorText, 'message-status'));
  } finally {
    clearTimeout(frame); draw(); bodyEl?.classList.remove('typing'); state.controller = null; setBusy(false);
    loadThreads().catch(() => {}); $('#prompt').focus();
  }
}

$('#composer').onsubmit = submit;
$('#prompt').oninput = () => { $('#prompt').style.height = 'auto'; $('#prompt').style.height = `${Math.min(160, $('#prompt').scrollHeight)}px`; setBusy(state.busy); };
$('#prompt').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } };
$('#new-chat').onclick = newChat;
$('#stop').onclick = () => state.controller?.abort();
$('#refresh-models').onclick = loadModels;
$('#model').onchange = () => preference.set('model', $('#model').value);
$('#web-search').checked = preference.get('search') === 'true';
$('#web-search').onchange = () => preference.set('search', String($('#web-search').checked));
$('#menu').onclick = () => { const open = document.body.classList.toggle('menu-open'); $('#menu').setAttribute('aria-expanded', String(open)); };
document.addEventListener('click', event => { if (document.body.classList.contains('menu-open') && !event.target.closest('#sidebar, #menu')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
$('#delete-chat').onclick = async () => {
  if (!state.id || state.busy || !confirm('이 대화와 메시지를 삭제할까요?')) return;
  try { await api(`/threads/${state.id}`, { method: 'DELETE' }); newChat(); await loadThreads(); } catch (error) { notice(error.message); }
};
document.querySelectorAll('[data-prompt]').forEach(button => { button.onclick = () => {
  $('#prompt').value = button.dataset.prompt;
  if (button.dataset.search) { $('#web-search').checked = true; preference.set('search', 'true'); }
  setBusy(false); $('#prompt').focus();
}; });
await loadModels();
try {
  await loadThreads(); const id = preference.get('thread');
  if (id) await openThread(id).catch(() => { preference.set('thread', null); });
} catch (error) { notice(error.message); }
