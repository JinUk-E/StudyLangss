const section = document.body.dataset.section || 'home';
const top = document.createElement('header'); top.className = 'global-header';
top.innerHTML = `<a class="global-brand" href="/"><span class="brand-monogram">SF</span><span><span data-site-name>별빛공방</span><small>개인 작업실</small></span></a><nav class="global-tabs" aria-label="주 영역"><a href="/" data-section-tab="home">홈</a><a href="/chat/" data-section-tab="chat">AI 대화</a><a href="/study/" data-section-tab="study">학습</a></nav><span class="global-caption">만들고, 배우고, 기록합니다.</span>`;
document.body.prepend(top);
top.querySelector(`[data-section-tab="${section}"]`)?.setAttribute('aria-current', 'page');
// The public profile supplies the same edited site name to all three areas.
fetch('/api/portfolio/public').then(response => response.ok ? response.json() : null).then(data => {
  if (typeof data?.profile?.name === 'string') top.querySelector('[data-site-name]').textContent = data.profile.name;
}).catch(() => {});
if (section === 'home') {
  const admin = location.pathname.startsWith('/admin');
  const querySection = new URLSearchParams(location.search).get('section');
  const selected = ['profile', 'projects', 'resume'].includes(querySection) ? querySection : 'profile';
  const menus = admin ? [['소개 편집', '/admin/?section=profile'], ['포트폴리오 편집', '/admin/?section=projects'], ['이력서 편집', '/admin/?section=resume'], ['사이트로 돌아가기', '/']] : [['소개', '/'], ['포트폴리오', '/portfolio/'], ['이력서', '/resume/'], ['콘텐츠 편집', '/admin/']];
  const aside = document.createElement('aside'); aside.className = 'section-sidebar';
  const title = document.createElement('p'); title.className = 'sidebar-heading'; title.textContent = admin ? '홈 · 콘텐츠 편집' : '홈'; aside.append(title);
  const nav = document.createElement('nav'); nav.setAttribute('aria-label', '홈 하위 메뉴');
  for (const [label, href] of menus) {
    const a = document.createElement('a'); a.href = href; a.textContent = label;
    const active = admin ? href.includes(`section=${selected}`) : href === location.pathname || (href === '/portfolio/' && location.pathname.startsWith('/projects/'));
    if (active) a.setAttribute('aria-current', 'page'); nav.append(a);
  }
  const note = document.createElement('p'); note.className = 'sidebar-bottom'; note.textContent = admin ? '변경한 내용은 저장 후 반영됩니다.' : '작은 시도와 꾸준한 기록.';
  aside.append(nav, note); document.body.insertBefore(aside, top.nextSibling);
}
