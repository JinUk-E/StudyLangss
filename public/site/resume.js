import { $, el, api, external } from './shared.js';
$('#print-resume').onclick = () => window.print();
function appendDescription(parent, description) {
  let paragraph = [], list;
  const flush = () => { if (paragraph.length) { parent.append(el('p', paragraph.join('\n'))); paragraph = []; } };
  for (const line of String(description || '').split(/\r?\n/)) {
    const bullet = line.match(/^\s*(?:[-*]\s+|•\s*)(.+)$/);
    if (bullet) { flush(); if (!list) { list = el('ul', undefined, 'resume-bullets'); parent.append(list); } list.append(el('li', bullet[1])); }
    else { list = undefined; if (!line.trim()) flush(); else paragraph.push(line); }
  }
  flush();
}
try {
  const { resume, profile, projects } = await api('/resume');
  const document = $('#resume-document'); document.replaceChildren();
  if (!resume.published) document.append(el('p', '비공개 이력서 · 로그인한 사용자에게만 표시됩니다.', 'privacy-note no-print'));
  const header = el('header', undefined, 'resume-header');
  header.append(el('p', '경험과 기술 · RESUME', 'eyebrow'), el('p', profile.name, 'resume-name'), el('h1', resume.headline), el('p', resume.summary, 'intro-copy'));
  const contact = el('div', undefined, 'resume-links');
  if (profile.email) { const a = el('a', profile.email, 'text-link'); a.href = `mailto:${encodeURIComponent(profile.email)}`; contact.append(a); }
  if (profile.githubUrl) contact.append(external('GitHub →', profile.githubUrl));
  if (profile.contactUrl) contact.append(external('연락처 →', profile.contactUrl));
  header.append(contact); document.append(header);
  const layout = el('div', undefined, 'resume-layout'), primary = el('div', undefined, 'resume-primary'), aside = el('aside', undefined, 'resume-aside'); aside.setAttribute('aria-label', '기술과 학력');
  layout.append(primary, aside); document.append(layout);
  const section = (title, parent = primary, extraClass = '') => { const node = el('section', undefined, `resume-section ${extraClass}`.trim()); node.append(el('h2', title)); parent.append(node); return node; };
  if (resume.skills.length) { const row = section('주요 기술', aside, 'resume-skills'), tags = el('div', undefined, 'tags'); resume.skills.forEach(skill => tags.append(el('span', skill))); row.append(tags); }
  for (const [title, items, column, style] of [['경력', resume.experience, primary, 'resume-experience'], ['학력 · 교육', resume.education, aside, 'resume-education']]) {
    if (!items.length) continue;
    const parent = section(title, column, style), timeline = el('div', undefined, 'resume-timeline'); parent.append(timeline);
    for (const item of items) {
      const entry = el('article', undefined, 'resume-entry'); entry.append(el('h3', item.title));
      const meta = el('div', undefined, 'resume-entry-meta');
      if (item.organization) meta.append(el('span', item.organization, 'resume-organization'));
      if (item.period) meta.append(el('span', item.period, 'resume-period'));
      entry.append(meta); appendDescription(entry, item.description); timeline.append(entry);
    }
  }
  if (projects.length) {
    const parent = section('프로젝트', primary, 'resume-projects');
    for (const project of projects) { const entry = el('article', undefined, 'resume-entry'), a = el('a', project.title); a.href = `/projects/${project.id}`; const h3 = el('h3'); h3.append(a); entry.append(h3, el('small', [project.year, project.role].filter(Boolean).join(' · ')), el('p', project.summary)); if (project.tags.length) { const tags = el('div', undefined, 'tags'); project.tags.forEach(tag => tags.append(el('span', tag))); entry.append(tags); } parent.append(entry); }
  }
  if (!aside.children.length) { aside.hidden = true; layout.classList.add('resume-layout-single'); }
} catch (error) { $('#resume-document').replaceChildren(el('p', error.message, 'privacy-note')); $('#print-resume').disabled = true; }
