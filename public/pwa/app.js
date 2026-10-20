const $ = selector => document.querySelector(selector);
const apiRoot = '/api/portfolio/push';
const state = { config: null, devices: [], subscription: null, current: null, registration: null, busy: true, installPrompt: null };
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const permissionLabels = { default: '아직 선택하지 않음', granted: '허용됨', denied: '차단됨' };
const statusLabels = { accepted: '푸시 서비스 접수', expired: '만료된 구독', rate_limited: '요청 제한', unknown: '접수 결과 불명', failed: '전달 실패' };

function message(text, error = false, element = $('#push-state')) { element.textContent = text; element.dataset.error = String(error); }
function timeout(promise, ms, text) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(text)), ms); })]).finally(() => clearTimeout(timer));
}
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiRoot + path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: controller.signal });
    let data;
    try { data = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 로그인과 서버 상태를 확인하세요.'); }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `요청을 완료하지 못했습니다 (${response.status}).`);
    return data;
  } catch (error) { if (error.name === 'AbortError') throw new Error('서버 응답을 기다리다 중단했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.'); throw error; }
  finally { clearTimeout(timer); }
}
const post = (path, value) => api(path, { method: 'POST', body: JSON.stringify(value) });
function keyBytes(value) { const base64 = value.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), char => char.charCodeAt(0)); }
function sameKey(subscription, configuredKey) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const left = new Uint8Array(current), right = keyBytes(configuredKey);
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
function configReady() { return state.config?.configured === true && state.config.origin === location.origin && typeof state.config.applicationServerKey === 'string' && state.config.applicationServerKey.length > 0; }
function renderControls() {
  const permission = 'Notification' in window ? Notification.permission : null;
  $('#permission-state').textContent = permissionLabels[permission] || '이 브라우저에서 지원하지 않음';
  $('#subscription-state').textContent = state.current ? '이 기기 연결됨' : '이 기기 등록 없음';
  const canEnable = supported && configReady() && !(ios && !standalone()) && permission !== 'denied';
  $('#enable-push').disabled = state.busy || !canEnable;
  $('#enable-push').textContent = state.current ? '이 기기 연결 갱신' : '이 기기에서 알림 켜기';
  $('#disable-push').disabled = state.busy || (!state.current && !state.subscription);
  $('#disable-push').textContent = state.subscription && !state.current ? '이 브라우저의 남은 구독 해제' : '이 기기 알림 연결 해제';
  $('#test-push').disabled = state.busy || !state.current || !configReady();
  $('#refresh-devices').disabled = state.busy;
  $('#device-label').disabled = state.busy;
  for (const button of document.querySelectorAll('[data-remove-device]')) button.disabled = state.busy;
}
function setBusy(value) { state.busy = value; renderControls(); }
function connectionMessage() {
  if (!window.isSecureContext) return message('알림을 사용하려면 HTTPS 주소로 접속하세요.', true);
  if (!supported) return message('이 브라우저는 Web Push를 지원하지 않습니다. 지원하는 브라우저나 홈 화면 앱에서 다시 확인하세요.');
  if (!state.config?.configured) return message('서버의 푸시 설정이 아직 준비되지 않았습니다. Mac에서 setup-push 설정을 확인하세요.');
  if (!configReady()) return message('푸시 설정의 사이트 주소와 현재 주소가 다릅니다. Mac의 푸시 설정을 확인하세요.', true);
  if (ios && !standalone()) return message('아이폰·아이패드는 먼저 홈 화면에 추가한 뒤, 추가된 앱 아이콘으로 열어 알림을 켜세요.');
  if (Notification.permission === 'denied') return message('브라우저 또는 OS 설정에서 알림이 차단되어 있습니다. 해당 설정에서 허용한 뒤 이 화면을 다시 열어주세요.');
  if (state.current && state.subscription && !sameKey(state.subscription, state.config.applicationServerKey)) return message('서버의 알림 키가 변경됐습니다. 연결 갱신 버튼을 눌러 이 기기를 다시 연결하세요.');
  if (state.current && Notification.permission === 'granted') return message('이 기기는 서버에 등록되어 있습니다. 테스트를 보내 실제 알림이 도착하는지 확인하세요.');
  if (state.subscription && !state.current) return message('브라우저 구독은 남아 있지만 현재 계정에는 등록되어 있지 않습니다. 다른 계정에 연결했었다면 남은 구독을 해제한 뒤 다시 연결하세요. OS 알림 권한은 별도로 유지됩니다.');
  return message('알림 켜기를 누르면 이 기기의 권한을 확인하고 서버에 등록합니다.');
}
function date(value) { if (!value) return '아직 없음'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '확인 불가' : parsed.toLocaleString('ko-KR'); }
function renderDevices() {
  const list = $('#device-list'); list.replaceChildren();
  if (!state.devices.length) { const li = document.createElement('li'); li.textContent = '등록한 기기가 없습니다.'; list.append(li); }
  for (const device of state.devices) {
    const li = document.createElement('li'), copy = document.createElement('div'), title = document.createElement('strong'), metadata = document.createElement('small'), button = document.createElement('button');
    copy.className = 'device-copy'; title.textContent = device.label || '이름 없는 기기';
    if (device.id === state.current?.id) { const badge = document.createElement('span'); badge.className = 'current-badge'; badge.textContent = '이 기기'; title.append(badge); }
    metadata.textContent = `등록 ${date(device.createdAt)} · 마지막 전송 ${date(device.lastAttemptAt)}${device.lastStatus ? ` · ${statusLabels[device.lastStatus] || '상태 확인 필요'}` : ''}`;
    copy.append(title, metadata); button.type = 'button'; button.className = 'secondary'; button.textContent = '연결 삭제'; button.dataset.removeDevice = device.id; button.setAttribute('aria-label', `${device.label || '이름 없는 기기'} 연결 삭제`);
    button.addEventListener('click', () => removeDevice(device.id)); li.append(copy, button); list.append(li);
  }
  renderControls();
}
async function registerWorker() {
  if (!supported) return null;
  if (state.registration?.active) return state.registration;
  await timeout(navigator.serviceWorker.register('/sw.js', { scope: '/' }), 10000, '알림 구성 요소를 준비하지 못했습니다. 새로고침 후 다시 시도하세요.');
  state.registration = await timeout(navigator.serviceWorker.ready, 10000, '알림 구성 요소의 준비가 지연되고 있습니다. 새로고침 후 다시 시도하세요.');
  return state.registration;
}
async function inspectCurrent() {
  state.current = null;
  if (!supported) return;
  const registration = await registerWorker();
  state.subscription = await timeout(registration.pushManager.getSubscription(), 10000, '이 기기의 구독 상태를 확인하지 못했습니다.');
  if (state.subscription) state.current = (await post('/match', { endpoint: state.subscription.endpoint })).device;
  if (state.current && !$('#device-label').value) $('#device-label').value = state.current.label || '';
}
async function refresh() {
  setBusy(true);
  try {
    const [config, devices] = await Promise.all([api('/config'), api('/devices')]);
    state.config = config; state.devices = devices.devices;
    if (config.user) accountMessage(config.user);
    await inspectCurrent(); renderDevices(); connectionMessage();
  } catch (error) { message(error.message, true); renderDevices(); }
  finally { setBusy(false); }
}
async function enablePush() {
  if (state.busy || !supported || !configReady() || (ios && !standalone())) return;
  let permissionPromise;
  // This call must happen in the original user gesture, before the first await.
  try { permissionPromise = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission); }
  catch (error) { message(error.message || '알림 권한을 요청하지 못했습니다.', true); return; }
  setBusy(true); message('알림 권한과 기기 연결을 확인하고 있습니다.');
  try {
    const permission = await permissionPromise;
    if (permission !== 'granted') { connectionMessage(); return; }
    const registration = await registerWorker();
    let subscription = await timeout(registration.pushManager.getSubscription(), 10000, '구독 상태를 확인하지 못했습니다.');
    if (subscription && !sameKey(subscription, state.config.applicationServerKey)) {
      const prior = (await post('/match', { endpoint: subscription.endpoint })).device;
      if (prior) await api(`/devices/${encodeURIComponent(prior.id)}`, { method: 'DELETE' });
      const removed = await timeout(subscription.unsubscribe(), 10000, '이전 구독 해제가 지연되고 있습니다.');
      if (!removed) throw new Error('이전 브라우저 구독을 해제하지 못했습니다. 이 화면을 새로고침하고 다시 연결하세요.');
      state.current = null; state.subscription = null; subscription = null;
    }
    if (!subscription) subscription = await timeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.config.applicationServerKey) }), 20000, '기기 구독이 지연되고 있습니다. 새로고침해 상태를 확인하세요.');
    state.subscription = subscription;
    const result = await post('/devices', { subscription: subscription.toJSON(), label: $('#device-label').value.trim() || (ios ? '내 iPhone·iPad' : '내 브라우저') });
    state.current = result.device;
    state.devices = (await api('/devices')).devices; renderDevices();
    message('이 기기를 연결했습니다. 테스트를 보내 실제 알림 도착을 확인하세요.');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
}
async function disconnectCurrent() {
  // Remove server delivery first. A failed server request must never appear disconnected.
  if (state.current) await api(`/devices/${encodeURIComponent(state.current.id)}`, { method: 'DELETE' });
  state.current = null;
  if (state.subscription) {
    const removed = await timeout(state.subscription.unsubscribe(), 10000, '브라우저 구독 해제가 지연되고 있습니다.');
    if (!removed) throw new Error('서버 연결은 삭제했지만 브라우저 구독이 남아 있습니다. 새로고침 후 다시 해제하세요.');
    state.subscription = null;
  }
}
async function disablePush() {
  if (state.busy) return;
  const hadCurrent = Boolean(state.current);
  setBusy(true);
  try { await disconnectCurrent(); state.devices = (await api('/devices')).devices; renderDevices(); message(hadCurrent ? '이 기기의 알림 연결을 해제했습니다. OS의 알림 권한은 유지됩니다. 이미 전송된 알림은 도착할 수 있습니다.' : '이 브라우저의 남은 구독을 해제했습니다. 다른 계정의 서버 등록을 삭제하거나 가져오지는 않았습니다. OS의 알림 권한은 유지됩니다.'); }
  catch (error) { renderDevices(); message(error.message, true); }
  finally { setBusy(false); }
}
async function removeDevice(id) {
  if (state.busy) return;
  if (id === state.current?.id) { await disablePush(); return; }
  setBusy(true);
  try { await api(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.devices = (await api('/devices')).devices; renderDevices(); message('선택한 기기의 서버 연결을 삭제했습니다. 해당 기기의 OS 알림 권한은 유지됩니다.', false, $('#device-state')); }
  catch (error) { message(error.message, true, $('#device-state')); }
  finally { setBusy(false); }
}
async function testPush() {
  if (state.busy || !state.current) return;
  setBusy(true); message('이 기기로 테스트 알림을 요청하고 있습니다.');
  try {
    const result = await post('/test', { id: state.current.id });
    const texts = { accepted: '푸시 서비스가 접수했습니다. 실제 알림이 보이는지 이 기기에서 확인하세요. 접수만으로 수신을 보장하지 않습니다.', expired: '이 기기의 구독이 만료되었습니다. 이 기기 알림 연결을 해제한 뒤 다시 켜세요.', rate_limited: '테스트 요청이 제한되었습니다. 잠시 뒤 다시 시도하세요.', unknown: '접수 결과를 확인하지 못했습니다. 알림이 이미 도착했을 수 있으니 기기에서 확인하세요. 자동으로 다시 보내지 않습니다.', failed: '테스트를 전달하지 못했습니다. 기기와 서버의 연결 상태를 확인하세요.' };
    message(texts[result.status] || '서버의 전달 상태를 확인하지 못했습니다.', result.status !== 'accepted');
    state.devices = (await api('/devices')).devices;
    if (!state.devices.some(device => device.id === state.current?.id)) state.current = null;
    renderDevices();
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
}
function renderInstall() {
  $('#install-state').textContent = standalone() ? '현재 홈 화면 앱 형태로 실행 중입니다.' : state.installPrompt ? '이 브라우저에서 설치할 수 있습니다. 아래 버튼을 눌러 진행하세요.' : '브라우저 메뉴에서 홈 화면에 추가 또는 앱 설치를 확인하세요. 이 화면만으로 설치 여부를 확정할 수는 없습니다.';
  $('#install-app').hidden = !state.installPrompt || standalone();
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; renderInstall(); });
window.addEventListener('appinstalled', () => { state.installPrompt = null; $('#install-state').textContent = '설치 요청이 완료됐습니다. 홈 화면이나 앱 목록에서 별빛공방을 열어주세요.'; $('#install-app').hidden = true; });
$('#install-app').addEventListener('click', async () => {
  const prompt = state.installPrompt; if (!prompt) return;
  state.installPrompt = null; $('#install-app').hidden = true;
  try { await prompt.prompt(); const choice = await prompt.userChoice; $('#install-state').textContent = choice.outcome === 'accepted' ? '설치를 요청했습니다. 홈 화면이나 앱 목록을 확인하세요.' : '설치를 취소했습니다. 브라우저 메뉴에서 다시 진행할 수 있습니다.'; }
  catch { $('#install-state').textContent = '설치 창을 열지 못했습니다. 브라우저 메뉴에서 설치를 진행하세요.'; }
});
$('#enable-push').addEventListener('click', enablePush);
$('#disable-push').addEventListener('click', disablePush);
$('#test-push').addEventListener('click', testPush);
$('#refresh-devices').addEventListener('click', refresh);
function accountMessage(user) { const element = $('#push-account'); if (element) element.textContent = user ? `현재 계정: ${user.username} · 이 계정의 기기만 표시합니다.` : '로그인한 계정을 확인한 뒤 알림을 연결하세요.'; }
window.addEventListener('starlight:session', event => accountMessage(event.detail?.user));
window.addEventListener('focus', () => { if (!state.busy) refresh(); });
renderInstall(); refresh();
