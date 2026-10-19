import { $, el, api, external } from './shared.js';
$('#print-resume').onclick = () => window.print();
try {
  const { resume, profile, projects } = await api('/resume');
  const document = $('#resume-document'); document.replaceChildren();
  if (!resume.published) document.append(el('p', '비공개 이력서 · 로그인한 사용자에게만 표시됩니다.', 'privacy-note no-print'));
  const header = el('header', undefined, 'resume-header');
  header.append(el('p', profile.name, 'eyebrow'), el('h1', resume.headline), el('p', resume.summary, 'intro-copy'));
  const contact = el('div', undefined, 'resume-links');
  if (profile.email) { const a = el('a', profile.email, 'text-link'); a.href = `mailto:${encodeURIComponent(profile.email)}`; contact.append(a); }
  if (profile.githubUrl) contact.append(external('GitHub →', profile.githubUrl));
  if (profile.contactUrl) contact.append(external('연락처 →', profile.contactUrl));
  header.append(contact); document.append(header);
  const section = title => { const node = el('section', undefined, 'resume-section'); node.append(el('h2', title)); document.append(node); return node; };
  if (resume.skills.length) { const row = section('프로젝트에서 사용한 기술'), tags = el('div', undefined, 'tags'); resume.skills.forEach(skill => tags.append(el('span', skill))); row.append(tags); }
  for (const [title, items] of [['경력', resume.experience], ['학력 · 교육', resume.education]]) {
    if (!items.length) continue;
    const parent = section(title);
    for (const item of items) { const entry = el('article', undefined, 'resume-entry'); entry.append(el('h3', item.title), el('small', [item.organization, item.period].filter(Boolean).join(' · ')), el('p', item.description)); parent.append(entry); }
  }
  if (projects.length) {
    const parent = section('프로젝트');
    for (const project of projects) { const entry = el('article', undefined, 'resume-entry'), a = el('a', project.title); a.href = `/projects/${project.id}`; const h3 = el('h3'); h3.append(a); entry.append(h3, el('small', [project.year, project.role].filter(Boolean).join(' · ')), el('p', project.summary)); parent.append(entry); }
  }
} catch (error) { $('#resume-document').replaceChildren(el('p', error.message, 'privacy-note')); $('#print-resume').disabled = true; }
