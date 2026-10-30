import { $, el, api, external, image, projectDetails } from './shared.js';
import { webGameForProject } from './web-games.mjs';
import { portfolioGroups, projectGroup } from './portfolio-groups.mjs';
let projects = [], selectedGroup = 'all';
const expandedGroups = new Set(), previewLimit = 6;
function projectCard(project, index, spotlight = false) {
  const card = el('a', undefined, `project-card${project.cover ? ' has-cover' : ''}${spotlight ? ' spotlight-card' : ''}`); card.href = `/projects/${project.id}`;
  const art = el('div', undefined, `project-cover tone-${index % 3}`);
  if (project.cover) { const cover = image(project.cover, `${project.title} 프로젝트 화면`); if (spotlight) cover.loading = 'eager'; art.append(cover); }
  else art.append(el('span', project.title, 'cover-title'), el('span', project.category, 'cover-caption'));
  const content = el('div', undefined, 'project-content');
  const meta = el('div', undefined, 'project-meta'); meta.append(el('span', spotlight && project.featured ? '대표 프로젝트' : project.category), el('span', project.year));
  if (webGameForProject(project.id)) meta.append(el('span', '웹 플레이 가능', 'project-web-badge'));
  const heading = el('div', undefined, 'project-heading'); const arrow = el('span', '↗', 'project-arrow'); arrow.setAttribute('aria-hidden', 'true'); heading.append(el(spotlight ? 'h2' : 'h4', project.title), arrow);
  const tags = el('div', undefined, 'tags'); project.tags.forEach(tag => tags.append(el('span', tag)));
  content.append(meta, heading, el('p', project.summary, 'project-summary'), tags); card.append(art, content);
  card.onclick = event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); history.pushState(null, '', card.href); open(project); };
  return card;
}
function render() {
  const list = $('#projects'); list.replaceChildren();
  list.classList.toggle('single-group', selectedGroup !== 'all');
  if (!projects.length) {
    const empty = el('div', undefined, 'empty-work'); empty.append(el('span', '✧'), el('h3', '새로운 작업을 준비하고 있어요.'), el('p', '완성된 이야기를 이곳에 차곡차곡 모아둘게요.')); list.append(empty); return;
  }
  for (const [index, group] of portfolioGroups.entries()) {
    if (selectedGroup !== 'all' && selectedGroup !== group.id) continue;
    const items = projects.filter(project => projectGroup(project) === group.id);
    if (!items.length) continue;
    const section = el('section', undefined, `work-group group-${group.id}`);
    const heading = el('div', undefined, 'work-group-heading');
    const title = el('h3', group.label); title.id = `group-title-${group.id}`;
    title.append(el('span', String(items.length).padStart(2, '0'), 'work-group-count'));
    section.setAttribute('aria-labelledby', title.id);
    heading.append(el('span', String(index + 1).padStart(2, '0'), 'work-group-index'), title, el('p', group.description));
    const grid = el('div', undefined, 'work-group-items');
    const shown = expandedGroups.has(group.id) ? items : items.slice(0, previewLimit);
    for (const [itemIndex, project] of shown.entries()) grid.append(projectCard(project, itemIndex));
    section.append(heading, grid);
    if (shown.length < items.length) {
      const more = el('button', `${items.length - shown.length}개 더 보기 →`, 'work-more'); more.type = 'button';
      more.setAttribute('aria-label', `${group.label} ${items.length - shown.length}개 더 보기`);
      more.onclick = () => {
        expandedGroups.add(group.id); render();
        Array.from($('#projects').querySelectorAll('.project-card')).find(card => card.href.endsWith(`/projects/${items[previewLimit].id}`))?.focus();
      };
      section.append(more);
    }
    list.append(section);
  }
}
function open(project) { $('#project-detail').replaceChildren(projectDetails(project)); if (!$('#project-dialog').open) $('#project-dialog').showModal(); document.title = `${project.title} · 별빛공방`; }
const listingPath = location.pathname.startsWith('/portfolio') || location.pathname.startsWith('/projects/') ? '/portfolio/' : '/';
function close() { $('#project-dialog').close(); if (location.pathname.startsWith('/projects/')) history.replaceState(null, '', `${listingPath}#work`); document.title = '포트폴리오 · 별빛공방'; }
$('#close-detail').onclick = close;
$('#project-dialog').addEventListener('cancel', event => { event.preventDefault(); close(); });
window.addEventListener('popstate', () => { const project = projects.find(p => location.pathname === `/projects/${p.id}`); if (project) open(project); else $('#project-dialog').close(); });
try {
  const data = await api('/public'); projects = data.projects.filter(project => project.published);
  for (const node of document.querySelectorAll('[data-site-name]')) node.textContent = data.profile.name;
  $('#tagline').textContent = data.profile.tagline || data.profile.name; $('#bio').textContent = data.profile.bio;
  $('#intro-copy').textContent = data.profile.intro || data.profile.bio;
  const spotlight = projects.find(project => project.featured && project.cover) || projects.find(project => project.cover);
  if (spotlight) $('#spotlight-project').replaceChildren(projectCard(spotlight, projects.indexOf(spotlight), true));
  if (data.profile.githubUrl) $('#intro-github').append(external('GitHub ↗', data.profile.githubUrl, 'button quiet'));
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
  const availableGroups = portfolioGroups.map(group => ({ ...group, count: projects.filter(project => projectGroup(project) === group.id).length })).filter(group => group.count);
  if (projects.length) for (const group of [{ id: 'all', label: '전체', count: projects.length }, ...availableGroups]) {
    const button = el('button', `${group.label} ${group.count}`, group.id === selectedGroup ? 'filter active' : 'filter');
    button.type = 'button'; button.setAttribute('aria-pressed', String(group.id === selectedGroup)); button.setAttribute('aria-controls', 'projects');
    button.onclick = () => { selectedGroup = group.id; for (const node of $('#filters').children) { const active = node === button; node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active)); } render(); };
    $('#filters').append(button);
  }
  render(); const project = projects.find(p => location.pathname === `/projects/${p.id}`); if (project) open(project);
} catch { $('#load-status').textContent = '작업 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'; }
