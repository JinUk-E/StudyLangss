import { createJapaneseSpeech } from './speech.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = value => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
const labels = { words: '단어 암기', sentences: '문장 연습', listening: '듣기 연습' };
const ratings = { again: '다시 공부', hard: '어려웠어요', good: '기억했어요', easy: '쉬웠어요' };
const dueLabel = value => new Date(value).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export function mountPractice(root, { level, kind }) {
  const speech = createJapaneseSpeech();
  const voiceRequest = new AbortController();
  let active = true, version = 0, data, index = 0, revealed = false, played = false, answer = '', saved = null, saving = false, started = 0, completed = 0, requestId, queue = 'recommended', speed = 1, repeats = 1, voiceURI = '', serverVoices = [], voiceHint = 'Mac 서버 음성을 확인하고 있습니다.';
  const $ = selector => root.querySelector(selector);
  const voiceOptions = () => `<option value="">기본 일본어 음성</option>${serverVoices.filter(voice => !voice.language || /^ja(?:-|$)/i.test(voice.language)).map(voice => `<option value="${esc(voice.id)}" ${voice.id === voiceURI ? 'selected' : ''}>${esc(voice.name)}</option>`).join('')}`;
  speech.voices({ signal: voiceRequest.signal }).then(result => {
    if (!active) return;
    serverVoices = result.voices;
    voiceHint = result.available ? (/^qwen/i.test(result.provider || '') ? '스텔라 · 차분하고 부드러운 합성 음성입니다. 실제 시험 음원은 아닙니다.' : 'Mac 서버에서 합성한 음성입니다. 실제 시험 음원은 아닙니다.') : result.error || (result.state === 'loading' ? 'Mac에서 음성 모델을 준비 중입니다. 잠시 후 재생을 눌러 주세요.' : 'Mac 서버에서 일본어 음성을 사용할 수 없습니다. 서버의 음성 설정을 확인해 주세요.');
    if ($('#practice-voice')) $('#practice-voice').innerHTML = voiceOptions();
    if ($('#server-voice-note')) $('#server-voice-note').textContent = voiceHint;
  });
  const message = text => { if (active && $('#practice-status')) $('#practice-status').textContent = text; };
  async function call(path, body) {
    const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '학습 자료를 불러오지 못했습니다.'); return result;
  }
  async function load(nextQueue = queue) {
    queue = nextQueue; const token = ++version; speech.cancel(); root.innerHTML = '<p class="help" role="status">학습 자료를 불러오고 있습니다.</p>';
    try {
      const loaded = await call(`/api/practice?level=${level}&kind=${kind}&queue=${queue}&limit=50`);
      if (!active || token !== version) return; data = loaded; index = 0; completed = 0; begin();
    } catch (error) { if (active && token === version) { root.innerHTML = `<p class="error">${esc(error.message)}</p><button class="btn secondary" id="retry-practice">다시 시도</button>`; $('#retry-practice').onclick = () => load(); } }
  }
  function begin() { speech.cancel(); revealed = false; played = false; answer = ''; saved = null; saving = false; started = Date.now(); requestId = crypto.randomUUID(); render(); }
  function render() {
    if (!active || !data) return;
    const item = data.items[index], summary = data.summary;
    const toolbar = `<div class="practice-controls"><label>학습 범위<select id="practice-queue"><option value="recommended" ${queue === 'recommended' ? 'selected' : ''}>추천 순서</option><option value="review" ${queue === 'review' ? 'selected' : ''}>복습할 항목만</option><option value="all" ${queue === 'all' ? 'selected' : ''}>전체 자료</option></select></label><span class="help">${level} · ${summary.total}개 자료 · 복습 예정 ${summary.dueCount}개 · 처음 배우는 항목 ${summary.newCount}개</span></div>`;
    if (!item) {
      root.innerHTML = `${toolbar}<section class="panel practice-finish"><h2>${data.items.length ? '이번 연습을 마쳤습니다.' : '지금 학습할 항목이 없습니다.'}</h2><p>${data.items.length ? `${completed}개 항목의 기억 정도와 다음 복습 일정을 저장했습니다.` : '추천 목록은 복습 시간이 된 항목과 새 항목으로 구성합니다.'}</p><p class="help">전체 자료를 선택하면 복습 예정인 항목도 추가로 연습할 수 있습니다.</p><button class="btn secondary" id="practice-all">전체 자료 보기</button> <a class="btn secondary" href="#home">오늘의 학습으로</a></section>`;
      bindQueue(); $('#practice-all').onclick = () => load('all'); return;
    }
    const listening = kind === 'listening', sentence = kind === 'sentences';
    let face;
    if (kind === 'words') face = `<p class="practice-instruction">읽는 법과 뜻을 먼저 떠올려 보세요.</p><h2 class="practice-word" lang="ja">${esc(item.word)}</h2>${revealed ? `<p class="practice-reading" lang="ja">${esc(item.reading)}</p><p class="practice-meaning">${esc(item.meaning)}</p><div class="practice-example"><p lang="ja">${esc(item.example)}</p><p>${esc(item.translation)}</p></div>` : '<p class="help">뜻을 보기 전에 기억을 꺼내는 시간이 중요합니다.</p>'}`;
    else if (sentence) face = `<p class="practice-instruction">해석을 읽고 빈칸에 들어갈 표현을 써 보세요.</p><p class="practice-sentence" lang="ja">${esc(revealed ? item.example : item.example.replace(item.target, '（　　　）'))}</p><p class="practice-translation">${esc(item.translation)}</p><label class="practice-answer-label" for="practice-answer">빈칸 답안 (선택)</label><input id="practice-answer" class="practice-answer" lang="ja" maxlength="2000" autocomplete="off" value="${esc(answer)}" ${revealed ? 'disabled' : ''}>${revealed ? `<div class="practice-example"><p><strong lang="ja">${esc(item.target)}</strong> · ${esc(item.meaning)}</p><p class="help">${answer.trim() ? ([item.target, ...(item.target === item.word ? [item.reading] : [])].some(v => normalize(v) === normalize(answer)) ? '참고 표기와 일치합니다.' : '입력한 표기와 다릅니다. 활용형·한자를 확인해 보세요.') : '빈칸의 표현과 문장 전체를 함께 읽어 보세요.'} 표기 비교는 공식 채점이 아닙니다.</p></div>` : ''}`;
    else face = `<p class="practice-instruction">음성을 듣고 문장을 받아 적어 보세요.</p><div class="listening-placeholder" aria-hidden="true">문장 듣기</div><label class="practice-answer-label" for="practice-answer">받아쓰기 (선택)</label><textarea id="practice-answer" class="practice-answer" lang="ja" rows="3" maxlength="2000" autocomplete="off" placeholder="들은 내용을 일본어로 적어 보세요." ${revealed ? 'disabled' : ''}>${esc(answer)}</textarea>${revealed ? `<div class="practice-example"><p class="practice-sentence" lang="ja">${esc(item.example)}</p><p>${esc(item.translation)}</p><p class="help">${answer.trim() ? (normalize(answer) === normalize(item.example) ? '공백·문장부호를 제외한 표기가 일치합니다.' : '입력한 표기와 대본을 비교해 보세요. 한자·가나 표기 차이는 오답을 뜻하지 않습니다.') : '재생한 음성과 대본을 비교하며 한 번 더 읽어 보세요.'}</p></div>` : ''}`;
    const audio = `<div class="practice-audio"><div class="practice-audio-options"><label>속도<select id="practice-speed">${[.65, .8, 1, 1.15].map(value => `<option value="${value}" ${speed === value ? 'selected' : ''}>${value}배</option>`).join('')}</select></label><label>반복<select id="practice-repeat">${[1, 2, 3].map(value => `<option value="${value}" ${repeats === value ? 'selected' : ''}>${value}회</option>`).join('')}</select></label><label>일본어 음성<select id="practice-voice">${voiceOptions()}</select></label></div><div class="practice-audio-buttons"><button class="btn secondary" id="practice-play">${kind === 'words' && !revealed ? '단어 발음 듣기' : '문장 듣기'}</button>${revealed ? '<button class="btn secondary" id="practice-meaning">한국어 뜻 듣기</button>' : ''}<button class="btn ghost" id="practice-stop">재생 중지</button></div><p id="speech-status" class="help" role="status"></p><p id="server-voice-note" class="help" role="status">${esc(voiceHint)}</p></div>`;
    root.innerHTML = `${toolbar}<div class="practice-layout"><section class="panel practice-card"><div class="practice-card-top"><span class="tag">日本語 · ${level} · ${labels[kind]}</span><span>${index + 1} / ${data.items.length}</span></div><p class="practice-reason">${esc(item.recommendation)}</p>${face}${audio}<div class="practice-actions">${!revealed ? `<button class="btn" id="practice-reveal">${kind === 'words' ? '읽기·뜻 보기' : sentence ? '정답·해석 확인' : '대본·해석 확인'}</button>` : `<p class="help" id="practice-rating-note">${listening && !played ? '음성을 끝까지 재생한 뒤 듣기 복습 기록을 저장할 수 있습니다.' : '기억 정도를 선택하면 다음 복습 일정이 저장됩니다.'}</p><div class="practice-ratings">${Object.entries(ratings).map(([rating, label]) => `<button class="btn ${rating === 'good' ? '' : 'secondary'}" data-practice-rating="${rating}" ${saving || saved || listening && !played ? 'disabled' : ''}>${label}</button>`).join('')}</div>`}${saved ? `<p class="practice-saved" role="status">저장했습니다. 다음 복습: ${esc(dueLabel(saved.dueAt))}</p><button class="btn" id="practice-next">${index + 1 === data.items.length ? '연습 마치기' : '다음 항목'} →</button>` : `<button class="btn ghost" id="practice-skip" ${saving ? 'disabled' : ''}>기록하지 않고 다음으로</button>`}<p id="practice-status" class="help" role="status"></p></div><p class="help">${esc(item.source)}</p></section><aside class="panel practice-guide"><h2>학습 방법</h2><ol><li>${kind === 'words' ? '뜻과 읽기를 떠올립니다.' : sentence ? '해석과 문맥을 보고 표현을 떠올립니다.' : '대본을 보지 않고 음성을 듣습니다.'}</li><li>${kind === 'words' ? '뜻·예문으로 기억을 확인합니다.' : sentence ? '정답과 활용형을 확인합니다.' : '받아쓴 내용과 대본을 비교합니다.'}</li><li>기억 정도를 선택해 복습을 예약합니다.</li></ol><p class="help">단어·문장·듣기 기록은 각각 저장합니다. 다시 공부는 약 10분 뒤, 기억한 항목은 더 긴 간격으로 복습합니다.</p><p class="help">추천은 목표 급수와 복습 일정으로 계산합니다. 영어·중국어는 일본어 기능 확인 후 추가할 예정입니다.</p></aside></div>`;
    bindQueue();
    if ($('#practice-answer')) $('#practice-answer').oninput = event => { answer = event.target.value; };
    if ($('#practice-reveal')) $('#practice-reveal').onclick = () => { speech.cancel(); revealed = true; render(); };
    if ($('#practice-skip')) $('#practice-skip').onclick = () => { index++; begin(); };
    if ($('#practice-next')) $('#practice-next').onclick = () => { index++; begin(); };
    $('#practice-speed').onchange = event => { speed = Number(event.target.value); speech.cancel(); };
    $('#practice-repeat').onchange = event => { repeats = Number(event.target.value); speech.cancel(); };
    $('#practice-voice').onchange = event => { voiceURI = event.target.value; speech.cancel(); };
    $('#practice-stop').onclick = () => { speech.cancel(); $('#speech-status').textContent = '재생을 중지했습니다.'; };
    if ($('#practice-meaning')) $('#practice-meaning').onclick = () => {
      const currentVersion = version, currentIndex = index;
      // Korean meanings never satisfy the Japanese listening completion gate.
      speech.play({ entryId: item.id, part: 'meaning' }, { rate: speed, status: text => { if (active && currentIndex === index && currentVersion === version && $('#speech-status')) $('#speech-status').textContent = text; } });
    };
    $('#practice-play').onclick = async () => {
      const currentVersion = version, currentIndex = index;
      const success = await speech.play({ entryId: item.id, part: kind === 'words' && !revealed ? 'word' : 'sentence' }, { rate: speed, repeats, voiceURI, status: text => { if (active && currentIndex === index && currentVersion === version && $('#speech-status')) $('#speech-status').textContent = text; } });
      if (success && active && currentIndex === index && currentVersion === version) {
        played = true;
        if (revealed && listening) {
          root.querySelectorAll('[data-practice-rating]').forEach(button => { button.disabled = saving || Boolean(saved); });
          if ($('#practice-rating-note')) $('#practice-rating-note').textContent = '기억 정도를 선택하면 다음 복습 일정이 저장됩니다.';
        }
      }
    };
    root.querySelectorAll('[data-practice-rating]').forEach(button => { button.onclick = () => grade(button.dataset.practiceRating); });
  }
  function bindQueue() { $('#practice-queue').disabled = saving; $('#practice-queue').onchange = event => load(event.target.value); }
  async function grade(rating) {
    if (!active || saving || saved || !revealed || kind === 'listening' && !played) return;
    const token = version, currentIndex = index, item = data.items[index]; saving = true; speech.cancel(); render();
    try {
      const result = await call('/api/practice/grade', { requestId, entryId: item.id, kind, rating, durationMs: Math.min(86400000, Math.max(0, Date.now() - started)), answer, listened: played });
      if (!active || token !== version || currentIndex !== index) return;
      saved = result; completed++;
      if (!result.duplicate) {
        data.summary.reviewsToday++;
        if (!item.progress) { data.summary.seen++; data.summary.newCount--; }
        if (item.priority === 0) data.summary.dueCount--;
      }
    } catch (error) { if (active && token === version) { saving = false; render(); message(error.message); return; } }
    if (active && token === version) { saving = false; render(); }
  }
  load();
  return () => { active = false; version++; voiceRequest.abort(); speech.cancel(); };
}
