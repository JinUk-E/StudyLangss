import { $, el, api, image, projectDetails } from './shared.js';
let projects = [], editing = null, cover = '', gallery = [], uploading = false, saving = false, dirty = false;
const status = text => { $('#status').textContent = text; };
function lock(value) { saving = value; for (const fieldset of document.querySelectorAll('fieldset')) fieldset.disabled = value; for (const node of document.querySelectorAll('#new-project, #cancel-edit, .project-edit, .project-delete')) node.disabled = value; }
function projectValue() {
  const form = $('#project-form'), value = Object.fromEntries(new FormData(form));
  return { ...value, tags: value.tags.split(',').map(v => v.trim()).filter(Boolean), published: form.elements.published.checked, featured: form.elements.featured.checked, order: Number(value.order), cover, gallery };
}
function previews() {
  for (const [container, paths, type] of [[$('#cover-preview'), cover ? [cover] : [], 'cover'], [$('#gallery-preview'), gallery, 'gallery']]) {
    container.replaceChildren();
    paths.forEach((path, index) => { const box = el('div', undefined, 'image-preview'); const remove = el('button', '제외'); remove.type = 'button'; remove.onclick = () => { if (type === 'cover') cover = ''; else gallery.splice(index, 1); dirty = true; previews(); }; box.append(image(path, '등록 이미지'), remove); container.append(box); });
  }
}
function renderList() {
  $('#project-list').replaceChildren();
  if (!projects.length) { $('#project-list').append(el('p', '아직 프로젝트가 없습니다. 첫 작업을 등록해 보세요.', 'muted')); return; }
  for (const project of projects) {
    const row = el('div', undefined, 'admin-project');
    const label = el('div'); label.append(el('strong', project.title), el('small', `${project.published ? '공개 중' : '비공개 초안'} · ${project.category}${project.featured ? ' · 대표작' : ''}`));
    const controls = el('div', undefined, 'row-actions'), edit = el('button', '수정', 'button light project-edit'), remove = el('button', '삭제', 'button quiet project-delete');
    edit.onclick = () => openEditor(project); remove.onclick = async () => {
      if (saving || !confirm(`‘${project.title}’ 프로젝트를 삭제할까요?`)) return;
      lock(true); try { await api(`/projects/${project.id}`, { method: 'DELETE' }); if (editing === project.id) { $('#editor').hidden = true; dirty = false; } await load(); status('프로젝트를 삭제했습니다.'); } catch (error) { status(error.message); } finally { lock(false); }
    };
    controls.append(edit, remove); row.append(label, controls); $('#project-list').append(row);
  }
}
async function load() { const data = await api('/manage'); projects = data.projects; renderList(); return data; }
function openEditor(project = null) {
  if (saving || uploading || (dirty && !confirm('저장하지 않은 변경을 버리고 이동할까요?'))) return;
  editing = project?.id || null; cover = project?.cover || ''; gallery = [...(project?.gallery || [])];
  const form = $('#project-form'); form.reset();
  const values = project || { title: '', category: 'PROJECT', year: '', summary: '', description: '', role: '', tags: [], link: '', repository: '', order: 0, published: false, featured: false };
  for (const name of ['title', 'category', 'year', 'summary', 'description', 'role', 'link', 'repository', 'order']) form.elements[name].value = values[name];
  form.elements.tags.value = values.tags.join(', '); form.elements.published.checked = values.published; form.elements.featured.checked = values.featured;
  $('#editor-title').textContent = project ? '프로젝트 수정' : '새 프로젝트'; $('#editor').hidden = false; dirty = false; previews(); $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.title.focus();
}
$('#new-project').onclick = () => openEditor();
$('#cancel-edit').onclick = () => { if (!dirty || confirm('저장하지 않은 변경을 버릴까요?')) { $('#editor').hidden = true; dirty = false; } };
$('#project-form').oninput = () => { dirty = true; };
$('#profile-form').onsubmit = async event => {
  event.preventDefault(); if (saving) return;
  const value = Object.fromEntries(new FormData(event.target)); lock(true); status('소개를 저장하고 있어요…');
  try { await api('/profile', { method: 'PUT', body: JSON.stringify(value) }); status('소개를 저장했습니다. 메인 페이지에 반영됐습니다.'); } catch (error) { status(error.message); } finally { lock(false); }
};
$('#project-form').onsubmit = async event => {
  event.preventDefault(); if (saving || uploading) return;
  const value = projectValue(); lock(true); status('프로젝트를 저장하고 있어요…');
  try {
    const data = await api(editing ? `/projects/${editing}` : '/projects', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(value) });
    editing = data.project.id; dirty = false; await load(); status(value.published ? '저장했습니다. 포트폴리오에 공개되었습니다.' : '비공개 초안으로 저장했습니다.');
  } catch (error) { status(error.message); } finally { lock(false); }
};
async function upload(input, multiple) {
  if (saving || uploading) return;
  const files = [...input.files]; if (!files.length) return;
  if (multiple && gallery.length + files.length > 6) { status('추가 이미지는 최대 6개입니다.'); input.value = ''; return; }
  if (files.some(file => file.size > 8 * 1024 * 1024)) { status('이미지는 파일당 8MB 이하로 올려 주세요.'); input.value = ''; return; }
  uploading = true; lock(true); status('이미지를 올리고 있어요…');
  try { for (const file of files) { const result = await api('/images', { method: 'POST', body: file }); if (multiple) gallery.push(result.path); else cover = result.path; dirty = true; } status('이미지를 올렸습니다. 프로젝트를 저장하면 연결됩니다.'); }
  catch (error) { status(error.message); }
  finally { uploading = false; lock(false); input.value = ''; previews(); }
}
$('#cover-file').onchange = event => upload(event.target, false);
$('#gallery-files').onchange = event => upload(event.target, true);
$('#preview-project').onclick = () => {
  if (!$('#project-form').reportValidity()) return;
  try { $('#preview-body').replaceChildren(projectDetails(projectValue())); $('#preview-dialog').showModal(); } catch { status('프로젝트 링크와 입력 내용을 확인해 주세요.'); }
};
$('#close-preview').onclick = () => $('#preview-dialog').close();
window.addEventListener('beforeunload', event => { if (dirty || uploading) { event.preventDefault(); event.returnValue = ''; } });
try { const data = await load(); for (const [name, value] of Object.entries(data.profile)) $('#profile-form').elements[name].value = value; } catch (error) { status(error.message); }
