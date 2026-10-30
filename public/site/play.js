import { $, el, api } from './shared.js';
import { webGameForSlug } from './web-games.mjs';

const game = webGameForSlug(/^\/play\/([a-z0-9-]+)\/$/.exec(location.pathname)?.[1]);
let frame = null, starting = false;
const status = text => { $('#play-status').textContent = text; };

function stop() {
  frame?.remove(); frame = null;
  $('#game-launch').hidden = false; $('#start-game').disabled = false;
  $('#stop-game').disabled = true; $('#fullscreen-game').disabled = true;
  if (document.fullscreenElement === $('#player-shell')) document.exitFullscreen().catch(() => {});
  status('플레이를 종료했습니다. 다시 시작할 수 있어요.');
}
async function start() {
  if (starting || frame || !game) return;
  starting = true; $('#start-game').disabled = true;
  try {
    const data = await api('/public');
    if (!data.projects.some(project => project.id === game.projectId && project.published)) throw new Error('현재 공개되지 않은 게임입니다.');
    const next = document.createElement('iframe');
    next.title = `${game.title} 웹 게임`; next.src = game.url; next.referrerPolicy = 'no-referrer';
    next.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-downloads');
    next.setAttribute('allow', 'fullscreen; autoplay'); next.allowFullscreen = true;
    next.addEventListener('load', () => { if (frame === next) status('화면 안에서 게임을 시작해 주세요. 보이지 않으면 새 탭에서 열어 주세요.'); });
    next.addEventListener('error', () => { if (frame === next) status('게임 화면에 연결하지 못했어요. 새 탭에서 열기를 이용해 주세요.'); });
    frame = next; $('#game-frame-slot').append(next); $('#game-launch').hidden = true;
    $('#stop-game').disabled = false; $('#fullscreen-game').disabled = false;
    status('게임을 불러오고 있어요. 첫 실행에는 시간이 걸릴 수 있어요.');
  } catch {
    status('게임을 열 수 없어요. 공개 상태를 확인하거나 새 탭에서 열어 주세요.'); $('#start-game').disabled = false;
  } finally { starting = false; }
}
async function fullscreen() {
  if (!frame) return;
  try { await $('#player-shell').requestFullscreen(); }
  catch { status('이 브라우저에서는 전체화면을 열 수 없어요. 새 탭에서 플레이할 수 있습니다.'); }
}

$('#start-game').onclick = start; $('#stop-game').onclick = stop; $('#fullscreen-game').onclick = fullscreen;
try {
  if (!game) throw new Error('Unknown game');
  const data = await api('/public'), project = data.projects.find(project => project.id === game.projectId && project.published);
  if (!project) throw new Error('Unpublished game');
  document.title = `${game.title} 플레이 · 별빛공방`;
  $('#game-title').textContent = game.title; $('#game-subtitle').textContent = game.subtitle;
  $('#game-summary').textContent = game.summary; $('#game-note').textContent = game.note; $('#game-save').textContent = game.saveNote;
  $('#player-label').textContent = game.title;
  $('#game-meta').append(el('span', '● 웹 플레이'), el('span', game.device), el('span', game.mode));
  for (const control of game.controls) $('#game-controls').append(el('li', control));
  if (project.cover) { $('#game-cover').src = project.cover; $('#game-cover').hidden = false; }
  $('#project-notes').href = `/projects/${game.projectId}`;
  $('#open-game').href = game.url; $('#open-game').hidden = false; $('#start-game').disabled = false;
} catch {
  $('#game-title').textContent = '지금은 플레이할 수 없어요.';
  $('#game-summary').textContent = '공개된 프로젝트인지 확인한 뒤 다시 방문해 주세요.';
  status('포트폴리오에서 공개된 프로젝트를 선택해 주세요.');
}
