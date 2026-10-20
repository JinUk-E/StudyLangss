import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const practiceSource = (await readFile(new URL('../public/practice.js', import.meta.url), 'utf8')).replace(/^\uFEFF?import[^\n]*\n/, '').replace('export function mountPractice', 'function mountPractice');
const chatSource = (await readFile(new URL('../public/chat/app.js', import.meta.url), 'utf8')).replace(/^\uFEFF?import[^\n]*\n/, '').split("$('#composer').onsubmit")[0];
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
class Element {
  children = []; className = ''; value = ''; disabled = false; textContent = ''; isConnected = true;
  constructor(tag = 'div') { this.tagName = tag; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.className?.split(' ').includes(selector.slice(1)) : child.tagName === selector) result.push(child);
      result.push(...(child.querySelectorAll?.(selector) || []));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function practicePage() {
  const nodes = new Map(), plays = [], ratings = [];
  const speech = { cancel() {}, voices: async () => ({ available: true, provider: 'qwen3-tts', voices: [{ id: 'stella-ja', name: 'Japanese', language: 'ja-JP' }, { id: 'stella-ko', name: 'Korean', language: 'ko-KR' }] }), async play(source) { plays.push(source); return true; } };
  const root = {
    set innerHTML(html) {
      nodes.clear(); ratings.length = 0;
      for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(`#${match[1]}`, new Element());
      for (const match of html.matchAll(/<button[^>]*data-practice-rating="([^"]+)"([^>]*)>/g)) { const node = new Element('button'); node.dataset = { practiceRating: match[1] }; node.disabled = match[2].includes('disabled'); ratings.push(node); }
    },
    querySelector(selector) { return nodes.get(selector) || null; },
    querySelectorAll(selector) { return selector === '[data-practice-rating]' ? ratings : []; },
  };
  const data = { summary: { total: 1, dueCount: 0, newCount: 1 }, items: [{ id: 'entry-1', word: '空', reading: 'そら', meaning: '하늘', example: '空は青いです。', translation: '하늘은 파랗습니다.', source: '연습' }] };
  const context = vm.createContext({ createJapaneseSpeech: () => speech, AbortController, crypto: { randomUUID: () => 'attempt-id' }, fetch: async () => ({ ok: true, json: async () => data }) });
  vm.runInContext(practiceSource, context); const dispose = context.mountPractice(root, { level: 'N5', kind: 'listening' });
  return { nodes, plays, ratings, dispose };
}

test('Korean meaning playback cannot satisfy the Japanese listening completion gate', async () => {
  const page = practicePage(); await settle();
  assert.equal(page.nodes.has('#practice-meaning'), false);
  page.nodes.get('#practice-reveal').onclick(); assert.equal(page.ratings.every(button => button.disabled), true);
  page.nodes.get('#practice-meaning').onclick(); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(page.plays.at(-1))), { entryId: 'entry-1', part: 'meaning' });
  assert.equal(page.ratings.every(button => button.disabled), true);
  await page.nodes.get('#practice-play').onclick(); assert.equal(page.ratings.every(button => !button.disabled), true);
  page.dispose();
});

test('chat reading controls require a stored complete assistant and never start automatically', () => {
  const plays = []; let cancelled = 0;
  const document = { createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'), createTextNode: text => { const node = new Element('text'); node.textContent = text; return node; } };
  const context = vm.createContext({ document, createSpeech: () => ({ cancel() { cancelled++; }, play(source) { plays.push(source); } }) });
  vm.runInContext(chatSource, context);
  for (const input of [{ role: 'user', status: 'complete', id: 'm1' }, { role: 'assistant', status: 'interrupted', id: 'm1' }, { role: 'assistant', status: 'error', id: 'm1' }, { role: 'assistant', status: 'complete' }]) {
    assert.equal(context.messageElement({ content: '내용', ...input }).querySelector('.message-speech'), null);
  }
  const article = context.messageElement({ role: 'assistant', status: 'complete', id: 'm1', content: '안녕하세요.' });
  const controls = article.querySelector('.message-speech'), language = controls.querySelector('select');
  assert.ok(controls); assert.equal(plays.length, 0);
  language.value = 'ja'; language.onchange(); assert.equal(cancelled, 1);
  controls.querySelectorAll('button')[0].onclick(); assert.deepEqual(JSON.parse(JSON.stringify(plays[0])), { messageId: 'm1', language: 'ja' });
  controls.querySelectorAll('button')[1].onclick(); assert.equal(cancelled, 2);
  context.addSpeechControls(article, { role: 'assistant', status: 'complete', id: 'm1' }); assert.equal(article.querySelectorAll('.message-speech').length, 1);
});
