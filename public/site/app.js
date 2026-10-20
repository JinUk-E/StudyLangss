import { $, el, api, external, image, projectDetails } from './shared.js';
let projects = [], category = '전체';
function render() {
  const list = $('#projects'); list.replaceChildren();
  const filtered = projects.filter(p => category === '전체' || p.category === category);
  if (!filtered.length) {
    const empty = el('div', undefined, 'empty-work'); empty.append(el('span', '✧'), el('h3', '새로운 작업을 준비하고 있어요.'), el('p', '완성된 이야기를 이곳에 차곡차곡 모아둘게요.')); list.append(empty); return;
  }
  for (const [index, project] of filtered.entries()) {
    const card = el('a', undefined, `project-card${project.cover ? ' has-cover' : ''}`); card.href = `/projects/${project.id}`;
    const art = el('div', undefined, `project-cover tone-${index % 3}`);
    if (project.cover) art.append(image(project.cover, project.title)); else art.append(el('span', String(index + 1).padStart(2, '0'), 'cover-index'), el('span', project.category, 'cover-caption'));
    const meta = el('div', undefined, 'project-meta'); meta.append(el('span', project.category), el('span', project.year));
    const heading = el('div', undefined, 'project-heading'); heading.append(el('h3', project.title), el('span', '↗'));
    const tags = el('div', undefined, 'tags'); project.tags.forEach(tag => tags.append(el('span', tag)));
    card.append(art, meta, heading, el('p', project.summary), tags);
    card.onclick = event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); history.pushState(null, '', card.href); open(project); };
    list.append(card);
  }
}
function open(project) { $('#project-detail').replaceChildren(projectDetails(project)); if (!$('#project-dialog').open) $('#project-dialog').showModal(); document.title = `${project.title} · 별빛공방`; }
const listingPath = location.pathname.startsWith('/portfolio') || location.pathname.startsWith('/projects/') ? '/portfolio/' : '/';
function close() { $('#project-dialog').close(); if (location.pathname.startsWith('/projects/')) history.replaceState(null, '', `${listingPath}#work`); document.title = '포트폴리오 · 별빛공방'; }
$('#close-detail').onclick = close;
$('#project-dialog').addEventListener('cancel', event => { event.preventDefault(); close(); });
window.addEventListener('popstate', () => { const project = projects.find(p => location.pathname === `/projects/${p.id}`); if (project) open(project); else $('#project-dialog').close(); });
try {
  const data = await api('/public'); projects = data.projects;
  for (const node of document.querySelectorAll('[data-site-name]')) node.textContent = data.profile.name;
  $('#tagline').textContent = data.profile.tagline || data.profile.name; $('#bio').textContent = data.profile.bio;
  $('#intro-copy').textContent = data.profile.intro || data.profile.bio;
  if (listingPath === '/portfolio/') {
    $('#intro').hidden = true; $('#about').hidden = true;
    $('#work-title').firstChild.textContent = '포트폴리오 ';
    document.title = '포트폴리오 · 별빛공방';
  }
  $('#profile-role').textContent = data.profile.role; $('#work-count').textContent = String(projects.length).padStart(2, '0');
  const contact = $('#contact');
  if (data.profile.email) { const mail = el('a', '메일 보내기 ↗', 'text-link'); mail.href = `mailto:${encodeURIComponent(data.profile.email)}`; contact.append(mail); }
  if (data.profile.githubUrl) contact.append(external('GitHub ↗', data.profile.githubUrl));
  if (data.profile.contactUrl) contact.append(external('더 알아보기 ↗', data.profile.contactUrl));
  if (projects.length) for (const value of ['전체', ...new Set(projects.map(p => p.category))]) {
    const button = el('button', value, value === category ? 'filter active' : 'filter'); button.setAttribute('aria-pressed', String(value === category));
    button.onclick = () => { category = value; for (const node of $('#filters').children) { const active = node === button; node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active)); } render(); };
    $('#filters').append(button);
  }
  render(); const project = projects.find(p => location.pathname === `/projects/${p.id}`); if (project) open(project);
} catch { $('#load-status').textContent = '작업 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'; }
