import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webGames, webGameForSlug } from '../content/web-games.mjs';

const source = (await readFile(new URL('../public/site/play.js', import.meta.url), 'utf8')).replace(/^import[^\n]*\n/gm, '');
class Element {
  children = []; events = {}; disabled = true; hidden = false; attributes = {};
  append(child) { this.children.push(child); child.parent = this; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}
async function page(slug = 'projectf', { failed = false } = {}) {
  const nodes = new Map(), created = [];
  const node = key => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key); };
  node('#open-game').hidden = true;
  let published = true, unavailable = failed;
  const game = webGameForSlug(slug);
  const document = { title: '', fullscreenElement: null, createElement(tag) { const result = new Element(); result.tag = tag; created.push(result); return result; }, async exitFullscreen() { document.fullscreenElement = null; } };
  node('#player-shell').requestFullscreen = async () => { document.fullscreenElement = node('#player-shell'); };
  const api = async () => { if (unavailable) throw Error('offline'); return { projects: game && published ? [{ id: game.projectId, published: true, cover: '/media/cover.png' }] : [] }; };
  const context = vm.createContext({ $: node, el: (tag, text) => Object.assign(new Element(), { tag, textContent: text }), api, webGameForSlug, document, location: { pathname: `/play/${slug}/`, search: '?url=https://untrusted.invalid/' } });
  await vm.runInContext(`(async()=>{${source}})()`, context);
  return { node, document, created, frames: () => created.filter(child => child.tag === 'iframe'), revoke() { published = false; }, disconnect() { unavailable = true; } };
}

test('web player is click-to-load and creates only the catalog iframe with restricted capabilities', async () => {
  for (const game of webGames) {
    const p = await page(game.slug);
    assert.equal(p.frames().length, 0); assert.equal(p.node('#start-game').disabled, false);
    assert.equal(p.node('#open-game').href, game.url); assert.equal(p.node('#open-game').hidden, false);
    await p.node('#start-game').onclick(); await p.node('#start-game').onclick();
    assert.equal(p.frames().length, 1); const frame = p.frames()[0];
    assert.equal(frame.src, game.url); assert.equal(frame.referrerPolicy, 'no-referrer'); assert.equal(frame.allowFullscreen, true);
    assert.equal(frame.attributes.sandbox, 'allow-scripts allow-same-origin allow-pointer-lock allow-downloads');
    assert.equal(frame.attributes.allow, 'fullscreen; autoplay'); assert.equal(p.node('#game-launch').hidden, true);
    frame.events.load(); assert.match(p.node('#play-status').textContent, /보이지 않으면 새 탭/);
    assert.doesNotMatch(p.node('#play-status').textContent, /성공|완료/);
  }
});

test('fullscreen keeps the same game instance and stopping removes the frame and exits fullscreen', async () => {
  const p = await page(); await p.node('#start-game').onclick(); const frame = p.frames()[0];
  await p.node('#fullscreen-game').onclick(); assert.equal(p.frames().length, 1); assert.equal(p.node('#game-frame-slot').children[0], frame);
  assert.equal(p.document.fullscreenElement, p.node('#player-shell'));
  p.node('#stop-game').onclick(); await Promise.resolve();
  assert.equal(p.node('#game-frame-slot').children.length, 0); assert.equal(p.document.fullscreenElement, null);
  assert.equal(p.node('#start-game').disabled, false); assert.equal(p.node('#fullscreen-game').disabled, true);
  assert.equal(p.node('#game-launch').hidden, false);
});

test('revocation or API failure before start prevents embedding, without accepting a query URL', async () => {
  for (const action of ['revoke', 'disconnect']) {
    const p = await page(); p[action](); await p.node('#start-game').onclick();
    assert.equal(p.frames().length, 0); assert.equal(p.node('#start-game').disabled, false);
    assert.match(p.node('#play-status').textContent, /게임을 열 수 없어요/);
  }
  for (const slug of ['projectrun', 'projectm', 'unknown']) {
    const p = await page(slug); assert.equal(p.frames().length, 0); assert.equal(p.node('#start-game').disabled, true); assert.equal(p.node('#open-game').hidden, true);
  }
});

test('fullscreen failures preserve progress and keep the new-tab alternative and storage guidance', async () => {
  const p = await page('dugout'); await p.node('#start-game').onclick(); const frame = p.frames()[0];
  p.node('#player-shell').requestFullscreen = async () => { throw Error('blocked'); };
  await p.node('#fullscreen-game').onclick(); assert.equal(p.node('#game-frame-slot').children[0], frame);
  assert.match(p.node('#play-status').textContent, /새 탭/); assert.equal(p.node('#open-game').href, webGames[1].url);
  assert.match(p.node('#game-save').textContent, /저장 내보내기·가져오기/);
  const offline = await page('dugout', { failed: true }); assert.equal(offline.node('#start-game').disabled, true); assert.equal(offline.frames().length, 0);
});
