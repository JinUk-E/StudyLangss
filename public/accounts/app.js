const $ = selector => document.querySelector(selector);
const list = $('#accounts-list'), createForm = $('#create-account');
const state = { accounts: [], busy: true, authorized: false };
const cards = new Map();
function node(tag, text, className) { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; }
function status(target, text, error = false) { target.textContent = text; target.dataset.error = String(error); }
function setBusy(busy) {
  state.busy = busy; $('#create-fields').disabled = busy || !state.authorized || state.accounts.length >= 30;
  $('#reload-accounts').disabled = busy || !state.authorized;
  for (const control of list.querySelectorAll('button,input')) control.disabled = busy || !state.authorized;
}
async function api(path, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/portfolio' + path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
    let data; try { data = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 로그인과 서버 상태를 확인하세요.'); }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : response.status === 403 ? '계정 관리는 관리자만 사용할 수 있습니다.' : '요청을 완료하지 못했습니다. 로그인 상태를 확인하세요.');
    return data;
  } catch (error) { if (error.name === 'AbortError') throw new Error('서버 응답이 지연되고 있습니다. 목록을 새로고침해 결과를 확인한 뒤 다시 시도하세요.'); throw error; }
  finally { clearTimeout(timer); }
}
function checkbox(name, label, checked = false) { const wrapper = node('label', undefined, 'check'), input = node('input'); input.type = 'checkbox'; input.name = name; input.checked = checked; wrapper.append(input, document.createTextNode(label)); return wrapper; }
function permissions(form) { return ['study', 'chat'].filter(key => form.elements.namedItem(key).checked); }
function passwordInput(label, name) { const wrapper = node('label', label), input = node('input'); input.type = 'password'; input.name = name; input.autocomplete = 'new-password'; input.minLength = 12; input.maxLength = 256; input.required = true; wrapper.append(input); return wrapper; }
function validatePassword(form) {
  const password = form.elements.namedItem('password').value, confirm = form.elements.namedItem('confirmPassword').value;
  if (password.length < 12 || password.length > 256) throw new Error('비밀번호는 12~256자로 입력하세요.');
  if (password !== confirm) throw new Error('비밀번호 확인이 일치하지 않습니다.');
  return password;
}
function clearPasswords(form) { for (const name of ['password', 'confirmPassword']) form.elements.namedItem(name).value = ''; }
function updateCount() { $('#account-count').textContent = `${state.accounts.length} / 30개`; }
function upsert(account) {
  const index = state.accounts.findIndex(item => item.id === account.id);
  if (index >= 0) state.accounts[index] = account; else state.accounts.push(account);
  const card = renderAccount(account), previous = cards.get(account.id);
  if (previous) previous.replaceWith(card); else list.append(card);
  cards.set(account.id, card); updateCount();
  return card;
}
async function changeAccount(account, changes, output) {
  const result = await api(`/accounts/${encodeURIComponent(account.id)}`, { method: 'PATCH', body: JSON.stringify(changes) });
  const card = upsert(result.account);
  status(card.querySelector('[data-account-status]'), output);
}
function renderAccount(account) {
  const card = node('article', undefined, 'account-card'); card.dataset.accountId = account.id;
  const heading = node('div', undefined, 'account-heading'), title = node('h3', account.username, 'account-title'), flags = node('div', undefined, 'account-flags');
  if (account.isAdmin) flags.append(node('span', '고정 관리자', 'account-flag'));
  flags.append(node('span', account.enabled ? '사용 중' : '중지됨', `account-flag${account.enabled ? '' : ' paused'}`));
  heading.append(title, flags); card.append(heading);
  if (account.isAdmin) { card.append(node('p', '모든 기능을 사용할 수 있습니다. 고정 관리자는 이 화면에서 수정하거나 중지할 수 없습니다.', 'help')); return card; }
  const output = node('p'); output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite'); output.dataset.accountStatus = '';
  const form = node('form', undefined, 'permission-form'), group = node('div', undefined, 'permission-group'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', `${account.username} 사용 권한`);
  group.append(node('span', '사용 권한'), checkbox('study', '학습', account.permissions.includes('study')), checkbox('chat', 'AI 대화', account.permissions.includes('chat')));
  const save = node('button', '권한 저장'); save.type = 'submit'; form.append(group, save);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy) return;
    const value = permissions(form);
    if (!value.length) return status(output, '학습 또는 AI 대화 권한을 하나 이상 선택하세요.', true);
    setBusy(true); status(output, '권한을 저장하고 있습니다.');
    try { await changeAccount(account, { permissions: value }, '권한을 저장했습니다. 다음 요청부터 적용됩니다.'); }
    catch (error) { status(output, error.message, true); }
    finally { setBusy(false); }
  });
  const toggle = node('button', account.enabled ? '계정 사용 중지' : '계정 사용 재개', 'secondary'); toggle.type = 'button';
  toggle.addEventListener('click', async () => {
    if (state.busy) return; setBusy(true); status(output, '사용 상태를 변경하고 있습니다.');
    try { await changeAccount(account, { enabled: !account.enabled }, account.enabled ? '계정을 중지했습니다. 기록은 보존됩니다.' : '계정 사용을 재개했습니다.'); }
    catch (error) { status(output, error.message, true); }
    finally { setBusy(false); }
  });
  const toggleRow = node('div', undefined, 'form-actions'); toggleRow.append(toggle);
  const details = node('details', undefined, 'password-reset'), summary = node('summary', '비밀번호 재설정'), reset = node('form'), grid = node('div', undefined, 'input-grid');
  grid.append(passwordInput('새 비밀번호', 'password'), passwordInput('새 비밀번호 확인', 'confirmPassword'));
  const resetButton = node('button', '비밀번호 재설정'); resetButton.type = 'submit'; const actions = node('div', undefined, 'form-actions'); actions.append(resetButton);
  reset.append(grid, node('p', '12~256자. 저장하면 기존 비밀번호로는 새 요청을 할 수 없습니다.', 'help'), actions);
  reset.addEventListener('submit', async event => {
    event.preventDefault(); if (state.busy) return;
    let password;
    try { password = validatePassword(reset); } catch (error) { status(output, error.message, true); return; }
    setBusy(true); status(output, '비밀번호를 재설정하고 있습니다.');
    try { await changeAccount(account, { password }, '비밀번호를 재설정했습니다. 새 비밀번호를 사용자에게 직접 전달하세요.'); clearPasswords(reset); }
    catch (error) { status(output, error.message, true); }
    finally { setBusy(false); }
  });
  details.append(summary, reset); card.append(form, toggleRow, details, output); return card;
}
createForm.addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy || !state.authorized) return;
  const output = $('#create-status');
  let password, selected;
  try { password = validatePassword(createForm); selected = permissions(createForm); if (!selected.length) throw new Error('학습 또는 AI 대화 권한을 하나 이상 선택하세요.'); }
  catch (error) { status(output, error.message, true); return; }
  setBusy(true); status(output, '계정을 추가하고 있습니다.');
  try {
    const username = createForm.elements.namedItem('username').value;
    const result = await api('/accounts', { method: 'POST', body: JSON.stringify({ username, password, permissions: selected, enabled: createForm.elements.namedItem('enabled').checked }) });
    upsert(result.account); createForm.reset(); clearPasswords(createForm); status(output, `${result.account.username} 계정을 추가했습니다. 아이디와 비밀번호는 사용자에게 직접 전달하세요.`);
  } catch (error) { status(output, error.message, true); }
  finally { setBusy(false); }
});
async function load() {
  if (state.busy && state.authorized) return;
  state.authorized = false;
  setBusy(true);
  try {
    const { user } = await api('/me');
    if (!user?.isAdmin) throw new Error('계정 관리는 관리자만 사용할 수 있습니다.');
    state.authorized = true;
    const data = await api('/accounts'); state.accounts = []; cards.clear(); list.replaceChildren();
    for (const account of data.accounts) upsert(account);
    updateCount(); status($('#account-status'), '계정의 사용 권한과 상태를 관리할 수 있습니다.');
  } catch (error) { status($('#account-status'), error.message, true); }
  finally { setBusy(false); }
}
$('#reload-accounts').addEventListener('click', load);
load();
