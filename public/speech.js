const volumeKey = 'starlight.speech-volume';
const preferences = new WeakMap();
function volumePreferences(host) {
  if (preferences.has(host)) return preferences.get(host);
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const parse = raw => raw !== null && raw !== '' && valid(Number(raw)) ? Number(raw) : 1;
  let volume = 1;
  try { volume = parse(host.localStorage?.getItem(volumeKey) ?? null); } catch { /* Storage is optional. */ }
  const listeners = new Set();
  const preference = {
    get value() { return volume; }, listeners, context: null,
    set(value, persist = true) {
      if (!valid(value)) return false;
      volume = value;
      if (persist) try { host.localStorage?.setItem(volumeKey, String(value)); } catch { /* Keep the in-memory setting. */ }
      for (const update of listeners) update();
      for (const input of host.document?.querySelectorAll('[data-speech-volume]') || []) {
        input.value = String(Math.round(value * 100));
        const label = value === 0 ? '음소거' : `${input.value}%`;
        input.setAttribute('aria-valuetext', label);
        input.parentElement.querySelector('output').textContent = label;
      }
      return true;
    },
    unlock() {
      // Create/resume during the play-button gesture, before waiting for synthesis.
      const Context = host.AudioContext || host.webkitAudioContext;
      if (!Context) return;
      try {
        if (!this.context || this.context.state === 'closed') this.context = new Context();
        if (this.context.state !== 'running') Promise.resolve(this.context.resume()).catch(() => {});
      } catch { /* Native media volume remains the fallback. */ }
    }
  };
  host.addEventListener?.('storage', event => {
    if (event.key === volumeKey || event.key === null) preference.set(event.key === null ? 1 : parse(event.newValue), false);
  });
  preferences.set(host, preference); return preference;
}

/** Fetch authenticated Mac-generated audio; only a real ended event completes listening. */
export function createSpeech(host = globalThis, { service = 'study', studyLanguage = 'ja' } = {}) {
  if (!['study', 'chat'].includes(service)) throw new Error('지원하지 않는 음성 서비스입니다.');
  if (!['ja', 'en'].includes(studyLanguage)) throw new Error('지원하지 않는 학습 언어입니다.');
  const studyHeaders = service === 'study' ? { 'X-Study-Language': studyLanguage } : {};
  const base = service === 'chat' ? '/api/chat/tts' : '/api/tts';
  const later = host.setTimeout?.bind(host) || setTimeout;
  const clear = host.clearTimeout?.bind(host) || clearTimeout;
  const volume = volumePreferences(host);
  let current;
  function applyVolume(state) {
    if (!state?.audio) return;
    state.audio.muted = volume.value === 0;
    // Web Audio also supports devices that ignore HTMLMediaElement.volume.
    if (state.gain) {
      state.gain.gain.setTargetAtTime(volume.value, state.context.currentTime, 0.015);
    } else state.audio.volume = volume.value;
  }
  function volumeControl() {
    const label = host.document.createElement('label'); label.className = 'speech-volume';
    const title = host.document.createElement('span'); title.textContent = '음량';
    const input = host.document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
    input.value = String(Math.round(volume.value * 100)); input.setAttribute('data-speech-volume', ''); input.setAttribute('aria-label', '음성 음량');
    const output = host.document.createElement('output'); output.textContent = volume.value === 0 ? '음소거' : `${input.value}%`;
    input.setAttribute('aria-valuetext', output.textContent);
    input.oninput = () => volume.set(Number(input.value) / 100);
    label.append(title, input, output); return label;
  }
  function release(state) {
    clear(state.timer); clear(state.gap); state.controller?.abort();
    volume.listeners.delete(state.updateVolume);
    state.source?.disconnect(); state.gain?.disconnect();
    if (state.audio) {
      state.audio.onended = state.audio.onerror = state.audio.onstalled = state.audio.onwaiting = state.audio.onplaying = null;
      state.audio.pause(); state.audio.removeAttribute?.('src'); state.audio.load?.();
    }
    if (state.url) host.URL.revokeObjectURL(state.url);
  }
  function cancel() {
    if (current) { const old = current; current = undefined; release(old); old.status?.('재생을 중지했습니다.', 'stopped'); old.resolve?.(false); old.resolve = undefined; }
  }
  async function voices({ signal } = {}) {
    const controller = new AbortController(), timeout = later(() => controller.abort(), 10000);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await host.fetch(`${base}/voices`, { credentials: 'same-origin', headers: studyHeaders, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `서버 음성 상태를 확인하지 못했습니다 (${response.status}).`);
      return { ...data, available: Boolean(data.available), voices: Array.isArray(data.voices) ? data.voices : [], error: data.error || '' };
    } catch (error) { return { available: false, voices: [], error: error.name === 'AbortError' ? 'Mac 서버 음성 상태 확인 시간이 초과되었습니다.' : error.message }; }
    finally { clear(timeout); signal?.removeEventListener('abort', abort); }
  }
  function play(source, { rate = 1, repeats = 1, voiceURI = '', status = () => {} } = {}) {
    const validSource = source && typeof source === 'object' && (service === 'chat'
      ? typeof source.messageId === 'string' && source.messageId.length > 0 && ['auto', 'ko', 'ja'].includes(source.language || 'auto') && Object.keys(source).every(key => ['messageId', 'language'].includes(key))
      : (typeof source.entryId === 'string' && source.entryId.length > 0 && ['word', 'sentence', 'meaning'].includes(source.part) && !source.questionId || typeof source.questionId === 'string' && source.questionId.length > 0 && ['passage', 'explanation'].includes(source.part) && !source.entryId) && Object.keys(source).every(key => ['entryId', 'questionId', 'part'].includes(key)));
    if (!validSource || !Number.isFinite(rate) || rate < .5 || rate > 1.5 || !Number.isInteger(repeats) || repeats < 1 || repeats > 3 || typeof voiceURI !== 'string') { cancel(); status('재생할 학습 자료를 확인해 주세요.', 'error'); return Promise.resolve(false); }
    volume.unlock();
    const body = service === 'chat' ? { messageId: source.messageId, language: source.language || 'auto' } : { ...(source.entryId ? { entryId: source.entryId } : { questionId: source.questionId }), part: source.part, ...(voiceURI ? { voice: voiceURI } : {}) };
    const key = JSON.stringify(body);
    // A blocked iPhone keeps the prepared player. The next click calls play before any await.
    if (current?.blocked && current.key === key) {
      const state = current; state.blocked = false; state.rate = rate; state.repeats = repeats; state.status = status; state.count = 0;
      return new Promise(resolve => { state.resolve = resolve; start(state); });
    }
    cancel();
    const state = { key, rate, repeats, status, count: 0, controller: new AbortController() };
    state.updateVolume = () => applyVolume(state); volume.listeners.add(state.updateVolume);
    current = state;
    return new Promise(resolve => {
      state.resolve = resolve;
      status('Mac 서버에서 음성을 준비하고 있습니다. 처음 생성할 때는 잠시 걸릴 수 있습니다.', 'loading');
      state.timer = later(() => { if (current === state) { state.status('Mac 서버의 음성 준비 시간이 초과되었습니다. 다시 시도해 주세요.', 'error'); finish(state, false); } }, 150000);
      (async () => {
        try {
          const response = await host.fetch(`${base}/audio`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...studyHeaders }, body: JSON.stringify(body), signal: state.controller.signal });
          if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `음성을 준비하지 못했습니다 (${response.status}).`); }
          if (!/^audio\/(?:wav|x-wav|wave)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('서버에서 올바른 음성 파일을 받지 못했습니다.');
          const blob = await response.blob();
          if (current !== state) return;
          if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error('음성 파일 크기를 확인하지 못했습니다.');
          clear(state.timer); state.url = host.URL.createObjectURL(blob); state.audio = new host.Audio(state.url); state.audio.preload = 'auto';
          if (volume.context) {
            state.context = volume.context;
            state.gain = state.context.createGain(); state.gain.gain.value = volume.value;
            state.source = state.context.createMediaElementSource(state.audio);
            state.source.connect(state.gain); state.gain.connect(state.context.destination);
          }
          applyVolume(state);
          start(state);
        } catch (error) { if (current === state) { state.status(error.name === 'AbortError' ? '음성 요청을 중지했습니다.' : error.message, 'error'); finish(state, false); } }
      })();
    });
  }
  function finish(state, success) {
    if (current !== state) return;
    current = undefined; release(state); state.resolve?.(success); state.resolve = undefined;
  }
  function start(state) {
    if (current !== state) return;
    const audio = state.audio;
    const timeout = (duration, message) => { clear(state.timer); state.timer = later(() => { if (current === state) { state.status(message, 'error'); finish(state, false); } }, duration); };
    try { audio.playbackRate = state.rate; if (audio.currentTime) audio.currentTime = 0; }
    catch { state.status('음성 재생 설정을 적용하지 못했습니다. 다시 시도해 주세요.', 'error'); finish(state, false); return; }
    audio.onplaying = () => { if (current === state) { timeout(Math.ceil(180000 / state.rate) + 15000, '음성 재생 시간이 초과되었습니다. 다시 시도해 주세요.'); state.status(`${state.count + 1}/${state.repeats}회 재생 중 · Mac 서버 음성`, 'playing'); } };
    audio.onwaiting = audio.onstalled = () => { if (current === state) timeout(15000, '음성 재생이 지연되고 있습니다. 다시 시도해 주세요.'); };
    audio.onerror = () => { if (current === state) { state.status('음성 파일을 재생하지 못했습니다. 다시 시도해 주세요.', 'error'); finish(state, false); } };
    audio.onended = () => {
      if (current !== state) return;
      clear(state.timer); state.count++;
      if (state.count < state.repeats) state.gap = later(() => start(state), 350);
      else { state.status('음성 재생을 마쳤습니다.', 'done'); finish(state, true); }
    };
    timeout(15000, '음성 재생을 시작하지 못했습니다. 다시 시도해 주세요.');
    const rejected = error => {
      if (current !== state) return;
      if (error?.name === 'NotAllowedError') {
        clear(state.timer); state.blocked = true;
        audio.pause();
        state.status('음성이 준비되었습니다. 재생 버튼을 한 번 더 눌러 주세요.', 'ready');
        state.resolve?.(false); state.resolve = undefined;
      } else { state.status('음성을 재생하지 못했습니다. 다시 시도해 주세요.', 'error'); finish(state, false); }
    };
    try {
      const playing = audio.play();
      const resumed = state.context && state.context.state !== 'running' ? state.context.resume() : undefined;
      Promise.all([playing, resumed]).then(() => {
        if (state.context && state.context.state !== 'running') rejected({ name: 'NotAllowedError' });
      }).catch(rejected);
    } catch (error) { rejected(error); }
  }
  return { play, cancel, voices, volumeControl, getVolume: () => volume.value, setVolume: value => volume.set(value) };
}

export function createJapaneseSpeech(host = globalThis, options = {}) { return createSpeech(host, options); }
