export const $ = selector => document.querySelector(selector);
export function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
export async function api(path, options = {}) {
  const response = await fetch(`/api/portfolio${path}`, { ...options, headers: { ...(options.body instanceof File ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || '요청을 처리하지 못했습니다.'); return value;
}
export function external(label, url, className = 'text-link') {
  const node = el('a', label, className); const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid URL');
  node.href = parsed.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
}
export function image(path, alt, className = '') { const node = el('img', undefined, className); node.src = path; node.alt = alt; node.loading = 'lazy'; return node; }
export function projectDetails(project) {
  const fragment = document.createDocumentFragment();
  fragment.append(el('p', project.category, 'eyebrow'), el('h2', project.title), el('p', project.summary, 'detail-summary'));
  const metadata = el('div', undefined, 'detail-meta');
  for (const [label, value] of [['기간', project.year], ['역할', project.role], ['기술', project.tags.join(' · ')]]) if (value) { const row = el('div'); row.append(el('small', label), el('span', value)); metadata.append(row); }
  fragment.append(metadata);
  if (project.cover) fragment.append(image(project.cover, `${project.title} 대표 이미지`, 'detail-image'));
  fragment.append(el('p', project.description, 'detail-description'));
  const links = el('div', undefined, 'detail-links');
  const downloadPath = project.link ? new URL(project.link).pathname : '';
  const zip = /\.zip$/i.test(downloadPath);
  if (project.link) {
    let label = '프로젝트 방문 ↗';
    if (zip) label = /-windows-/i.test(downloadPath) ? 'Windows 빌드 다운로드 (.zip) ↗' : '빌드 다운로드 (.zip) ↗';
    links.append(external(label, project.link, 'button dark'));
  }
  if (project.repository) links.append(external('소스 코드 ↗', project.repository, 'button light'));
  fragment.append(links);
  if (zip) fragment.append(el('p', 'ZIP을 모두 푼 뒤 폴더 안의 실행 안내를 확인해 주세요.', 'detail-summary'));
  for (const path of project.gallery) fragment.append(image(path, `${project.title} 추가 이미지`, 'detail-image'));
  return fragment;
}
