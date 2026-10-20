import '/pwa/register.js';

const section = document.body.dataset.section || 'home';
const top = document.createElement('header'); top.className = 'global-header';
top.innerHTML = `<a class="global-brand" href="/"><span class="brand-monogram">SF</span><span><span data-site-name>별빛공방</span><small>개인 작업실</small></span></a><nav class="global-tabs" aria-label="주 영역"><a href="/" data-section-tab="home">홈</a><a href="/chat/" data-section-tab="chat">AI 대화</a><a href="/study/" data-section-tab="study">학습</a></nav><div class="account-summary" aria-label="현재 계정"><span class="account-identity" role="status">계정 확인 중</span><a class="account-entry" href="/app/" hidden>로그인</a></div>`;
document.body.prepend(top);
top.querySelector(`[data-section-tab="${section}"]`)?.setAttribute('aria-current', 'page');
fetch('/api/portfolio/public').then(response => response.ok ? response.json() : null).then(data => {
  if (typeof data?.profile?.name === 'string') top.querySelector('[data-site-name]').textContent = data.profile.name;
}).catch(() => {});
const isEditor = location.pathname.startsWith('/admin') && !location.pathname.startsWith('/admin/system');
const isPrivate = /^\/(?:app|accounts|admin|chat|study)(?:\/|$)/.test(location.pathname) || section === 'chat' || section === 'study';
let sidebar;
function homeMenu(user) {
  if (section !== 'home') return;
  if (!sidebar) { sidebar = document.createElement('aside'); sidebar.className = 'section-sidebar'; document.body.insertBefore(sidebar, top.nextSibling); }
  sidebar.replaceChildren();
  const title = document.createElement('p'); title.className = 'sidebar-heading'; title.textContent = isEditor ? '홈 · 콘텐츠 편집' : '홈';
  const nav = document.createElement('nav'); nav.setAttribute('aria-label', '홈 하위 메뉴');
  const querySection = new URLSearchParams(location.search).get('section');
  const selected = ['profile', 'projects', 'resume'].includes(querySection) ? querySection : 'profile';
  const menus = isEditor && user?.isAdmin ? [['소개 편집', '/admin/?section=profile'], ['포트폴리오 편집', '/admin/?section=projects'], ['이력서 편집', '/admin/?section=resume'], ['계정 관리', '/accounts/'], ['사이트 업데이트', '/admin/system/'], ['앱 설치·알림', '/app/'], ['사이트로 돌아가기', '/']] : [['소개', '/'], ['포트폴리오', '/portfolio/'], ['이력서', '/resume/'], ['앱 설치·알림', '/app/']];
  if (!isEditor && user?.isAdmin) menus.push(['콘텐츠 편집', '/admin/'], ['계정 관리', '/accounts/'], ['사이트 업데이트', '/admin/system/']);
  for (const [label, href] of menus) {
    const anchor = document.createElement('a'); anchor.href = href; anchor.textContent = label;
    const active = isEditor ? href.includes(`section=${selected}`) : href === location.pathname || (href === '/portfolio/' && location.pathname.startsWith('/projects/'));
    if (active) anchor.setAttribute('aria-current', 'page'); nav.append(anchor);
  }
  const note = document.createElement('p'); note.className = 'sidebar-bottom'; note.textContent = isEditor ? '변경한 내용은 저장 후 반영됩니다.' : '작은 시도와 꾸준한 기록.';
  sidebar.append(title, nav, note);
}
function applyUser(user) {
  document.body.dataset.accountRole = user?.isAdmin ? 'admin' : user ? 'member' : 'guest';
  document.body.dataset.accountStudy = String(Boolean(user?.isAdmin || user?.permissions?.includes('study')));
  document.body.dataset.accountChat = String(Boolean(user?.isAdmin || user?.permissions?.includes('chat')));
  const identity = top.querySelector('.account-identity'), entry = top.querySelector('.account-entry');
  if (user) {
    const permissions = user.isAdmin ? '관리자' : [user.permissions?.includes('study') && '학습', user.permissions?.includes('chat') && 'AI 대화'].filter(Boolean).join(' · ') || '권한 없음';
    identity.textContent = `${user.username} · ${permissions}`; identity.title = `${user.username} · ${permissions}`; entry.hidden = true;
  } else { identity.textContent = '공개 페이지'; entry.hidden = false; }
  homeMenu(user);
  window.dispatchEvent(new CustomEvent('starlight:session', { detail: { user } }));
}
homeMenu(null);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10000);
const sessionPath = section === 'study' ? '/api/me' : section === 'chat' ? '/api/chat/me' : isPrivate ? '/api/portfolio/me' : '/api/portfolio/session';
fetch(sessionPath, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
  .then(async response => {
    if (!response.ok) throw new Error('계정 확인 실패');
    const data = await response.json(); applyUser(data.user || null);
  }).catch(() => {
    applyUser(null);
    top.querySelector('.account-identity').textContent = '계정 확인 필요';
    top.querySelector('.account-entry').textContent = '로그인 확인';
  }).finally(() => clearTimeout(timer));
