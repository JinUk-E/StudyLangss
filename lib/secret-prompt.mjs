import { emitKeypressEvents } from 'node:readline';

/** Read a password on the local terminal with echo disabled. Never accepts CLI arguments. */
export function promptSecret(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('비밀번호 입력은 대화형 터미널에서 실행하세요.');
  return new Promise((resolve, reject) => {
    const input = process.stdin, wasRaw = Boolean(input.isRaw);
    let value = '';
    emitKeypressEvents(input);
    try { input.setRawMode(true); }
    catch { reject(new Error('이 터미널은 비밀번호 숨김 입력을 지원하지 않습니다. Mac의 터미널 앱에서 실행하세요.')); return; }
    process.stdout.write(label); input.resume();
    const finish = (error) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(wasRaw); input.pause(); process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === 'c') return finish(new Error('입력을 취소했습니다.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    }
    input.on('keypress', onKey);
  });
}
