/** Japanese speech with voice discovery, bounded repeats, and route-safe cancellation. */
export function createJapaneseSpeech(host = globalThis) {
  const synth = host.speechSynthesis;
  let generation = 0, timer, settle;
  const voices = () => synth?.getVoices().filter(voice => /^ja(?:-|$)/i.test(voice.lang)) || [];
  function cancel() { generation++; clearTimeout(timer); synth?.cancel(); settle?.(false); settle = undefined; }
  async function play(text, { rate = 1, repeats = 1, voiceURI = '', status = () => {} } = {}) {
    cancel(); const token = generation;
    if (!synth || !host.SpeechSynthesisUtterance) { status('이 브라우저는 음성 합성을 지원하지 않습니다.', 'error'); return false; }
    if (!voices().length) await new Promise(resolve => {
      const done = () => { if (!voices().length) return; clearTimeout(timeout); synth.removeEventListener?.('voiceschanged', done); resolve(); };
      const timeout = setTimeout(() => { synth.removeEventListener?.('voiceschanged', done); resolve(); }, 1200);
      synth.addEventListener?.('voiceschanged', done);
    });
    if (token !== generation) return false;
    const available = voices(), voice = available.find(v => v.voiceURI === voiceURI) || available.find(v => v.localService) || available[0];
    if (!voice) { status('일본어 음성이 없습니다. Mac·기기의 일본어 음성을 설치한 뒤 다시 재생하세요. 대본 확인과 문장 연습은 사용할 수 있습니다.', 'error'); return false; }
    if (!Number.isFinite(rate) || rate < .5 || rate > 1.5 || !Number.isInteger(repeats) || repeats < 1 || repeats > 3 || typeof text !== 'string' || text.length > 2000) return false;
    return new Promise(resolve => {
      settle = resolve; let count = 0;
      const finish = result => { if (token !== generation) return; settle = undefined; resolve(result); };
      const say = () => {
        if (token !== generation) return;
        const utterance = new host.SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP'; utterance.voice = voice; utterance.rate = rate;
        utterance.onstart = () => { if (token === generation) status(`${count + 1}/${repeats}회 재생 중 · ${voice.name}${voice.localService ? '' : ' (브라우저 온라인 음성)'}`, 'playing'); };
        utterance.onerror = () => { if (token === generation) { status('음성을 재생하지 못했습니다. 음성 설정을 확인하고 다시 시도하세요.', 'error'); finish(false); } };
        utterance.onend = () => {
          if (token !== generation) return; count++;
          if (count < repeats) timer = setTimeout(say, 350);
          else { status('음성 재생을 마쳤습니다.', 'done'); finish(true); }
        };
        try { synth.speak(utterance); } catch { status('음성을 재생하지 못했습니다.', 'error'); finish(false); }
      };
      say();
    });
  }
  return { play, cancel, voices };
}
