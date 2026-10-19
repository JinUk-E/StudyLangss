import { mountPractice } from './practice.js';
const $ = (s, root = document) => root.querySelector(s);
const main = $('#main');
const areaNames = { vocabulary: '어휘 · 한자', grammar: '문법', reading: '독해', listening: '청해' };
const areaIcons = { vocabulary: '語', grammar: '文', reading: '読', listening: '聴' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state, route = '', session, selected = null, result = null, questionStarted = 0, busy = false, pageToken = 0, readingVisible = false;
let disposePractice;
const dateLabel = date => new Date(date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const reviewLabel = date => new Date(date).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const pendingAttempts = new WeakSet();
const todayLabel = () => new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `요청을 처리하지 못했어요 (${response.status})`);
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 3500); }
function shell(title, subtitle, content, eyebrow = 'MY JAPANESE JOURNEY') {
  main.innerHTML = `<div class="topbar"><span>${esc(todayLabel())}</span><a class="level" href="#settings">JLPT ${esc(state.settings.level)} <span aria-hidden="true">↗</span></a></div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p>${content}`;
}
function statsHtml() {
  const s = state.stats;
  return `<div class="stats"><div class="stat"><span class="label">오늘 푼 문제</span><strong>${s.todayAnswered}<small>문제</small></strong><span class="hint">오늘도 한 걸음씩</span></div><div class="stat"><span class="label">현재 급수 정답률</span><strong>${Math.round(s.accuracy || 0)}<small>%</small></strong><span class="hint">누적 ${s.totalAnswered}문제 기준</span></div><div class="stat"><span class="label">복습할 문제</span><strong>${s.dueCount}<small>문제</small></strong><span class="hint">지금 다시 기억할 시간</span></div><div class="stat"><span class="label">연속 학습</span><strong>${s.streak}<small>일</small></strong><span class="hint">나만의 꾸준한 리듬</span></div></div>`;
}
function practiceLinks() {
  return `<div class="practice-shortcuts">${[['words', '단어 암기', '뜻을 떠올리고 예문으로 확인'], ['sentences', '문장 연습', '빈칸 표현과 문장 구조 연습'], ['listening', '듣기 연습', '반복 재생과 받아쓰기']].map(([key, title, caption]) => `<a href="#${key}"><strong>${title} →</strong><small>${caption}<br>복습할 항목 ${state.practice?.[key]?.dueCount || 0}개 · 오늘 기록 ${state.practice?.[key]?.reviewsToday || 0}회</small></a>`).join('')}</div>`;
}
function activityHtml(attempts) {
  return attempts.length ? attempts.slice(0, 10).map(a => `<div class="activity"><span class="result-dot ${a.correct ? '' : 'wrong'}">${a.correct ? '✓' : '↺'}</span><div><p lang="ja">${esc(a.prompt)}</p><small>${esc(a.level)} · ${esc(areaNames[a.area] || a.area)} · ${esc(dateLabel(a.createdAt))}</small></div></div>`).join('') : `<div class="empty"><span class="empty-icon">✎</span>아직 학습 기록이 없어요.<br>첫 번째 문제로 오늘을 시작해 보세요.</div>`;
}
function areasHtml() {
  return Object.entries(areaNames).map(([key, name]) => {
    const a = (state.areas || []).find(a => a.area === key) || { answered: 0, correct: 0 };
    const percent = a.answered ? Math.round(a.correct / a.answered * 100) : 0;
    return `<div class="area-row"><div class="area-icon">${areaIcons[key]}</div><div class="area-meta"><div class="area-title"><span>${name}</span><small>${a.answered ? `${percent}% · ${a.answered}문제` : '학습 전'}</small></div><div class="bar"><span style="width:${percent}%"></span></div></div></div>`;
  }).join('');
}
function home() {
  shell('하루의 작은 공부,<br>일본어가 되는 시간.', '오늘도 나의 속도로, 하나씩 쌓아가요.', `<section class="hero"><div><p class="eyebrow">TODAY’S STUDY</p><h2>오늘의 ${state.settings.level} 학습을<br>시작해 볼까요?</h2><p>목표는 하루 ${state.settings.dailyMinutes}분. 짧은 문제 풀이와 복습으로<br>어제보다 조금 더 익숙한 일본어를 만나세요.</p><a class="btn" href="#study">${hasSavedSession() ? '이어서 학습하기' : '학습 시작하기'} <span>↗</span></a></div><div class="hero-art" aria-hidden="true"><span class="hero-kanji">日々</span><small>ONE DAY AT A TIME</small></div></section>${practiceLinks()}${statsHtml()}<div class="grid-two"><section class="panel"><div class="panel-head"><h2>영역별 학습</h2><span class="text-link">현재 급수 누적</span></div>${areasHtml()}</section><section class="panel"><div class="panel-head"><h2>최근의 발자취</h2><a href="#records" class="text-link">전체 보기 ↗</a></div>${activityHtml((state.recentAttempts || []).slice(0, 3))}</section></div><p class="footer-note">작은 반복이 만드는 큰 변화 · HARU</p>`);
}
function hasSavedSession() { try { const s = JSON.parse(localStorage.getItem('haru-session')); return s?.level === state.settings.level && s?.index < s?.ids?.length; } catch { return false; } }
function saveSession(value = session) {
  if (!value) return;
  try { localStorage.setItem('haru-session', JSON.stringify({ ...value, questions: undefined, ids: value.questions.map(q => q.id) })); }
  catch { toast('이 브라우저에 이어하기를 저장하지 못했어요. 제출한 학습 기록은 서버에 보관됩니다.'); }
}
function clearSavedSession() { try { localStorage.removeItem('haru-session'); } catch { /* Server settings and records remain available without browser storage. */ } }
async function startStudy(mode = 'study', area, fresh = false) {
  const token = ++pageToken;
  if (area === undefined) {
    area = 'all';
    if (!fresh && mode === 'study') {
      try {
        const saved = JSON.parse(localStorage.getItem('haru-session'));
        if (saved?.level === state.settings.level && saved?.mode === mode && saved.index < saved.ids?.length && ['all', ...Object.keys(areaNames)].includes(saved.area)) area = saved.area;
      } catch { /* Start a normal session if browser storage is unavailable. */ }
    }
  }
  shell(mode === 'review' ? '기억을 단단하게.' : '오늘도, 한 문제씩.', mode === 'review' ? '다시 만날 시간이 된 문제를 복습해요.' : '정답보다 중요한 건, 조금 더 이해하는 순간이에요.', '<div class="loading">문제를 가져오고 있어요…</div>');
  try {
    const data = await api(`/api/questions?level=${state.settings.level}&mode=${mode}&area=${area}`);
    if (token !== pageToken) return;
    let saved;
    if (!fresh && mode === 'study') { try { saved = JSON.parse(localStorage.getItem('haru-session')); } catch {} }
    let questions = data.questions || [];
    if (saved?.level === state.settings.level && saved?.mode === mode && saved?.area === area && saved.index < saved.ids.length) {
      const byId = new Map(questions.map(q => [q.id, q]));
      if (saved.ids.every(id => byId.has(id))) session = { ...saved, questions: saved.ids.map(id => byId.get(id)) };
      else session = null;
    } else session = null;
    if (!session) session = { level: state.settings.level, mode, area, questions, index: 0, answered: 0, correct: 0 };
    selected = null; result = null; busy = false; questionStarted = Date.now();
    if (mode === 'study') saveSession();
    renderQuestion();
  } catch (error) { if (token === pageToken) { shell('학습실', '잠시 후 다시 시도해 주세요.', `<div class="error">${esc(error.message)}</div><button class="btn" id="retry">다시 시도</button>`); $('#retry').onclick = () => startStudy(mode, area, fresh); } }
}
function renderQuestion() {
  const s = session, q = s.questions[s.index];
  const isReview = s.mode === 'review';
  const toolbar = `<div class="toolbar"><span class="section-caption">${isReview ? '복습' : '학습'} · ${esc(s.level)} <span class="tag">${s.questions.length}문제</span></span>${!isReview ? `<label class="sr-only" for="area-filter">학습 영역</label><select id="area-filter" class="filter"><option value="all">모든 영역</option>${Object.entries(areaNames).map(([k, v]) => `<option value="${k}" ${s.area === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ''}</div>`;
  if (!q) {
    const complete = s.questions.length > 0;
    shell(complete ? '오늘의 한 걸음, 완료.' : '천천히 시작해 볼까요?', complete ? '오늘 쌓은 작은 경험이 내일의 실력이 돼요.' : '지금 선택한 조건에 해당하는 문제가 없어요.', `${toolbar}<section class="panel session-complete"><div class="big-icon">${complete ? '✳' : '◌'}</div><h2>${complete ? `${s.answered}문제를 학습했어요` : isReview ? '지금 복습할 문제가 없어요' : '준비된 문제가 없어요'}</h2><p class="subtitle">${complete ? `이번 학습의 정답 ${s.correct}문제 · 정답률 ${s.answered ? Math.round(s.correct / s.answered * 100) : 0}%` : isReview ? '학습을 마치면 복습 일정에 맞춰 문제가 나타나요.' : '영역을 바꾸거나 설정에서 학습 자료를 추가해 주세요.'}</p><a href="#home" class="btn">오늘 화면으로</a> <button class="btn secondary" id="restart">${isReview ? '일반 학습 시작' : '새로 학습하기'}</button></section>`);
    $('#restart').onclick = () => { if (isReview) location.hash = '#study'; else startStudy('study', s.area, true); };
    bindFilter(); return;
  }
  const feedback = result ? `<section class="feedback ${result.correct ? '' : 'wrong'}" aria-live="polite"><h3>${result.correct ? '잘했어요! 정답이에요.' : '괜찮아요. 함께 기억해 봐요.'}</h3><p>${esc(result.explanation)}</p><small class="section-caption">다음 복습: ${esc(reviewLabel(result.reviewDueAt))}</small>${isReview ? '<div class="rating" aria-label="체감 난이도"><button data-rating="again">다시 공부</button><button data-rating="hard">어려웠어요</button><button data-rating="good">기억했어요</button><button data-rating="easy">쉬웠어요</button></div>' : ''}<div class="ai-box"><div class="field" style="margin-bottom:12px"><label for="ai-question">궁금한 점 (선택)</label><input id="ai-question" maxlength="2000" placeholder="예: 다른 선택지는 왜 틀렸나요?"></div><button id="ai-explain" class="btn secondary">AI에게 더 물어보기 ↗</button><p class="help">설정에 연결한 Ollama로 설명을 요청해요. AI가 생성한 설명에는 오류가 있을 수 있으니 기본 해설과 함께 확인하세요.</p><div id="ai-response" class="ai-text" aria-live="polite"></div></div></section>` : '';
  shell(isReview ? '기억을 단단하게.' : '오늘도, 한 문제씩.', '작은 이해가 쌓여, 자연스러운 일본어가 돼요.', `${toolbar}<section class="panel question-card"><div class="question-top"><span>${esc(areaNames[q.area])} <span class="tag">${esc(q.level)}</span></span><span>${s.index + 1} / ${s.questions.length}</span></div><div class="progress"><span style="width:${(s.index + (result ? 1 : 0)) / s.questions.length * 100}%"></span></div>${q.area === 'listening' ? '<div class="inline-row"><button class="btn secondary" id="listen">▷ 합성 음성 연습</button><span class="help">시험 음원이 아닌 기기 합성 음성이에요.</span></div><div id="voice-note" class="help" role="status"></div>' : ''}${q.passage && (q.area !== 'listening' || result) ? `<div class="passage" lang="ja">${esc(q.passage)}</div>` : ''}<h2 class="question-prompt" lang="ja">${esc(q.prompt)}</h2>${q.reading ? `<label class="checkbox"><input type="checkbox" id="reading-toggle" ${readingVisible ? 'checked' : ''}> 읽기 표시</label><p id="reading" lang="ja" class="help" ${readingVisible ? '' : 'hidden'}>${esc(q.reading)}</p>` : ''}<div class="choices" role="group" aria-label="정답 선택">${q.choices.map((choice, index) => `<button class="choice ${selected === index ? 'selected' : ''} ${result && result.answerIndex === index ? 'correct' : ''} ${result && !result.correct && selected === index ? 'incorrect' : ''}" data-choice="${index}" aria-pressed="${selected === index}" ${result || busy ? 'disabled' : ''}><span class="number">${index + 1}</span><span lang="ja">${esc(choice)}</span>${result && result.answerIndex === index ? '<span aria-label="정답">✓</span>' : ''}</button>`).join('')}</div>${feedback}<div id="question-error" role="alert"></div><div class="question-actions"><span class="help">${esc(q.source || 'HARU 자체 연습 문제')} · 연습용 문항</span><button class="btn" id="answer" ${!result && selected === null || busy ? 'disabled' : ''}>${busy ? '확인 중…' : result ? s.index + 1 === s.questions.length ? '학습 마치기 →' : '다음 문제 →' : '정답 확인'}</button></div></section>`);
  bindFilter();
  document.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => { selected = Number(b.dataset.choice); renderQuestion(); });
  $('#answer').onclick = submitAnswer;
  if ($('#reading-toggle')) $('#reading-toggle').onchange = e => { readingVisible = e.target.checked; $('#reading').hidden = !readingVisible; };
  if ($('#listen')) $('#listen').onclick = () => speak(q.passage || q.prompt);
  if ($('#ai-explain')) $('#ai-explain').onclick = explain;
  document.querySelectorAll('[data-rating]').forEach(b => b.onclick = async () => { try { await post(`/api/reviews/${encodeURIComponent(q.id)}`, { rating: b.dataset.rating }); document.querySelectorAll('[data-rating]').forEach(x => x.disabled = true); toast('복습 일정을 조정했어요.'); } catch (error) { toast(error.message); } });
}
function bindFilter() { if ($('#area-filter')) $('#area-filter').onchange = e => startStudy('study', e.target.value, true); }
async function submitAnswer() {
  if (busy || !session || pendingAttempts.has(session)) return;
  if (result) { session.index++; selected = null; result = null; questionStarted = Date.now(); if (session.mode === 'study') saveSession(); renderQuestion(); return; }
  if (selected === null) return;
  const activeSession = session, q = session.questions[session.index], token = pageToken, answerIndex = selected;
  const durationMs = Math.min(86400000, Math.max(0, Date.now() - questionStarted));
  const isCurrent = () => token === pageToken && session === activeSession;
  pendingAttempts.add(activeSession);
  busy = true; renderQuestion();
  let answerResult;
  try {
    answerResult = await post('/api/attempts', { questionId: q.id, answerIndex, durationMs });
    activeSession.answered++; if (answerResult.correct) activeSession.correct++;
    // Persist the next unanswered question immediately, even if the page is closed on feedback.
    if (activeSession.mode === 'study' && activeSession.level === state.settings.level && session === activeSession) saveSession({ ...activeSession, index: activeSession.index + 1 });
  } catch (error) {
    if (isCurrent()) { busy = false; renderQuestion(); $('#question-error').innerHTML = `<p class="error">${esc(error.message)}</p>`; }
    return;
  } finally { pendingAttempts.delete(activeSession); }
  if (!isCurrent()) return;
  result = answerResult; busy = false; renderQuestion();
  // The attempt is committed. A statistics refresh must never resubmit or hide its grade.
  try { const refreshed = await api('/api/state'); if (isCurrent()) state = refreshed; }
  catch { if (isCurrent()) toast('답안은 저장했지만 통계를 갱신하지 못했어요. 화면을 이동하면 다시 불러옵니다.'); }
}
async function explain() {
  const q = session.questions[session.index], button = $('#ai-explain'), output = $('#ai-response'); button.disabled = true; output.textContent = 'AI가 설명을 준비하고 있어요…';
  try { const data = await post('/api/ai/explain', { questionId: q.id, question: $('#ai-question')?.value.trim() || undefined }); if (output.isConnected) output.textContent = data.text; }
  catch (error) { if (output.isConnected) output.textContent = error.message; }
  finally { if (button.isConnected) button.disabled = false; }
}
function speak(text) {
  const note = $('#voice-note');
  if (!('speechSynthesis' in window)) { note.textContent = '이 브라우저는 음성 합성을 지원하지 않아요.'; return; }
  const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('ja'));
  if (!voices.length) { note.textContent = '일본어 음성을 찾지 못했어요. 기기의 일본어 음성을 설치한 뒤 다시 시도해 주세요.'; return; }
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'ja-JP'; utterance.voice = voices[0]; utterance.rate = .85; utterance.onerror = () => { if (note.isConnected) note.textContent = '음성을 재생하지 못했어요.'; }; note.textContent = '일본어 합성 음성을 재생해요.'; speechSynthesis.speak(utterance);
}
function reviews() {
  const items = state.reviewItems || [];
  shell('잊기 전에, 한 번 더.', '다시 만나는 문제는 더 오래 남아요.', `<div class="toolbar"><span class="section-caption">현재 급수의 복습 일정 · ${esc(state.settings.level)}</span><button class="btn" id="review-start" ${!state.stats.dueCount ? 'disabled' : ''}>지금 복습하기 ↗</button></div><div class="review-list">${items.length ? items.map(q => `<article class="review-row"><div><span class="tag">${esc(q.level)} · ${esc(areaNames[q.area])}</span><p lang="ja">${esc(q.prompt)}</p><small>${new Date(q.dueAt) <= new Date() ? '지금 복습할 시간이에요' : `${esc(reviewLabel(q.dueAt))} 복습 예정`}</small></div><span class="muted" aria-hidden="true">↺</span></article>`).join('') : '<div class="panel empty"><span class="empty-icon">↺</span>아직 복습할 문제가 없어요.<br>문제를 풀면 복습 일정이 자동으로 만들어져요.<br><br><a class="btn secondary" href="#study">학습하러 가기</a></div>'}</div>`);
  $('#review-start').onclick = () => startStudy('review', 'all', true);
}
function records() { shell('쌓여가는 나의 일본어.', '작은 발자취를 돌아보며, 다음 한 걸음을 준비해요.', `${practiceLinks()}${statsHtml()}<div class="grid-two"><section class="panel"><div class="panel-head"><h2>영역별 이해도</h2><span class="text-link">현재 급수 누적</span></div>${areasHtml()}<p class="help">직접 풀이한 기록만 표시해요. 정답률은 공식 시험 점수와 다릅니다.</p></section><section class="panel"><div class="panel-head"><h2>최근 학습 기록</h2></div>${activityHtml(state.recentAttempts || [])}</section></div>`); }
function settings() {
  const s = state.settings;
  shell('나에게 맞는 공부방.', '목표와 공부 시간을 정하고, AI와 학습 자료를 연결하세요.', `<form id="settings-form" class="panel settings-panel"><h2>학습 목표</h2><div class="form-grid"><div class="field"><label for="level">JLPT 목표 급수</label><select id="level" name="level">${['N5', 'N4', 'N3', 'N2', 'N1'].map(level => `<option ${s.level === level ? 'selected' : ''}>${level}</option>`).join('')}</select><small>N5부터 N1까지, 언제든 목표를 바꿀 수 있어요.</small></div><div class="field"><label for="dailyMinutes">하루 목표 시간 (분)</label><input id="dailyMinutes" name="dailyMinutes" type="number" min="5" max="180" required value="${s.dailyMinutes}"><small>학습량을 정하는 개인 목표예요.</small></div></div><h2 style="margin-top:35px">로컬 AI 연결</h2><p class="section-caption">Mac Studio에서 실행하는 Ollama에 연결합니다. 기본 정답과 해설은 AI 연결 없이도 사용할 수 있어요.</p><div class="form-grid"><div class="field"><label for="ollamaUrl">Ollama 주소</label><input id="ollamaUrl" name="ollamaUrl" type="url" required value="${esc(s.ollamaUrl)}" placeholder="http://127.0.0.1:11434"><small>앱 서버의 localhost 또는 127.0.0.1 주소를 입력하세요.</small></div><div class="field"><label for="ollamaModel">사용할 모델</label><input id="ollamaModel" name="ollamaModel" list="model-options" value="${esc(s.ollamaModel)}" placeholder="설치한 모델 이름"><datalist id="model-options"></datalist><small>Ollama에 설치한 정확한 모델 태그를 입력하세요.</small></div></div><div class="actions"><button class="btn" type="submit">설정 저장</button><button id="models-refresh" class="btn ghost" type="button">모델 목록 확인</button></div><div id="settings-status" class="help" role="status"></div></form><section class="panel settings-panel"><h2>나의 데이터</h2><p class="section-caption">설정과 학습 기록을 JSON 파일로 보관하고 복원할 수 있어요.<br>문제 가져오기는 정해진 JSON 형식의 학습 자료를 추가합니다.</p><div class="actions"><a href="/api/backup" download class="btn secondary">백업 내려받기 ↓</a><button class="btn ghost" id="restore">백업 복원</button><button class="btn ghost" id="import">문제 가져오기</button></div><input type="file" accept=".json,application/json" id="restore-file" hidden><input type="file" accept=".json,application/json" id="import-file" hidden><div id="data-status" class="help" role="status"></div><details style="margin-top:20px"><summary class="help">문제 JSON 형식 보기</summary><pre class="help" style="overflow:auto">${esc(JSON.stringify({ questions: [{ id: 'my-n5-001', level: 'N5', area: 'vocabulary', prompt: '「山」の読み方は？', choices: ['やま', 'かわ', 'うみ', 'そら'], answerIndex: 0, explanation: '山은 やま로 읽습니다.', tags: ['한자'], source: '직접 만든 연습 문제' }] }, null, 2))}</pre></details></section>`);
  $('#settings-form').onsubmit = async e => { e.preventDefault(); const button = e.submitter; button.disabled = true; try { const values = Object.fromEntries(new FormData(e.target)); values.dailyMinutes = Number(values.dailyMinutes); await api('/api/settings', { method: 'PUT', body: JSON.stringify(values) }); if (s.level !== values.level) { clearSavedSession(); session = null; } state = await api('/api/state'); toast('설정을 저장했어요.'); settings(); } catch (error) { $('#settings-status').textContent = error.message; } finally { button.disabled = false; } };
  $('#models-refresh').onclick = async e => { e.target.disabled = true; const output = $('#settings-status'); output.textContent = '저장된 Ollama 주소에서 모델을 확인하고 있어요…'; try { const data = await api('/api/ollama/models'); $('#model-options').innerHTML = (data.models || []).map(m => `<option value="${esc(m.name)}"></option>`).join(''); output.textContent = data.available ? `${data.models.length}개의 모델을 찾았어요. 모델 입력란에서 선택하세요.` : data.error || 'Ollama에 연결하지 못했어요. 주소를 저장하고 Ollama 실행 상태를 확인해 주세요.'; } catch (error) { output.textContent = error.message; } finally { e.target.disabled = false; } };
  $('#restore').onclick = () => $('#restore-file').click(); $('#import').onclick = () => $('#import-file').click();
  $('#restore-file').onchange = e => loadFile(e, true); $('#import-file').onchange = e => loadFile(e, false);
}
async function loadFile(event, restore) {
  const file = event.target.files[0]; if (!file) return;
  try { const data = JSON.parse(await file.text()); if (restore && !confirm('현재 학습 기록과 설정을 선택한 백업으로 덮어씁니다. 복원할까요?')) return; await post(restore ? '/api/restore' : '/api/questions/import', data); if (restore) clearSavedSession(); session = null; state = await api('/api/state'); settings(); toast(restore ? '백업을 복원했어요.' : '학습 문제를 가져왔어요.'); } catch (error) { $('#data-status').textContent = error.message; } finally { event.target.value = ''; }
}
async function navigate() {
  disposePractice?.(); disposePractice = undefined;
  const token = ++pageToken; route = location.hash.slice(1) || 'home'; if (!['home', 'study', 'reviews', 'records', 'settings', 'words', 'sentences', 'listening'].includes(route)) route = 'home';
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  document.querySelectorAll('[data-route]').forEach(a => { a.classList.toggle('active', a.dataset.route === route); if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  try {
    state = await api('/api/state'); if (token !== pageToken) return;
    if (['words', 'sentences', 'listening'].includes(route)) {
      const headings = { words: ['한 단어씩, 오래 기억하기.', '뜻을 떠올리고 예문으로 확인하며 나만의 복습 간격을 만드세요.'], sentences: ['문장 속에서 익히는 표현.', '빈칸을 채우고 활용형과 문장 구조를 함께 살펴보세요.'], listening: ['듣고, 쓰고, 다시 듣기.', '일본어 합성 음성을 반복해서 듣고 대본과 비교해 보세요.'] };
      shell(...headings[route], '<div id="practice-root"></div>');
      disposePractice = mountPractice($('#practice-root'), { level: state.settings.level, kind: route });
    } else if (route === 'home') home(); else if (route === 'study') await startStudy(); else if (route === 'reviews') reviews(); else if (route === 'records') records(); else settings();
    window.scrollTo({ top: 0 }); main.focus({ preventScroll: true });
  }
  catch (error) { main.innerHTML = `<section class="panel"><h1>공부방에 연결하지 못했어요.</h1><p class="error">${esc(error.message)}</p><button class="btn" id="reconnect">다시 연결</button></section>`; $('#reconnect').onclick = navigate; }
}
window.addEventListener('hashchange', navigate);
navigate();
