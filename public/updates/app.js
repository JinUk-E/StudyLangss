const activePhases = new Set(['checking', 'validating', 'stopping', 'backing-up', 'applying', 'starting']);
const checkablePhases = new Set(['idle', 'ready', 'current', 'succeeded', 'failed']);
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const titles = {
  disabled: 'Mac 연결 설정이 필요합니다', idle: '새 버전을 확인할 수 있습니다',
  checking: '새 버전을 확인하고 있습니다', ready: '반영할 새 버전이 있습니다', current: '현재 코드가 최신 버전입니다',
  validating: '새 코드를 검증하고 있습니다', stopping: '서비스를 잠시 정지하고 있습니다',
  'backing-up': '현재 데이터를 백업하고 있습니다', applying: '확인한 코드를 반영하고 있습니다',
  starting: '서버를 재시작하고 상태를 확인하고 있습니다', succeeded: '사이트 업데이트를 완료했습니다',
  failed: '작업을 완료하지 못했습니다', manual: 'Mac에서 수동 점검이 필요합니다',
};
export class UpdateModel {
  constructor() { this.owner = false; this.online = false; this.busy = false; this.pendingJob = null; this.uncertain = false; this.status = null; }
  authorize(user) { this.owner = Boolean(user?.isAdmin && user.id === 'owner' && user.enabled !== false); }
  accept(status) {
    this.status = status; this.online = true; this.uncertain = false;
    if (this.pendingJob && (status?.jobId === this.pendingJob || status?.phase === 'manual' || status?.configured === false)) this.pendingJob = null;
  }
  get locked() { return !this.owner || !this.online || this.busy || Boolean(this.pendingJob) || this.uncertain; }
  get canCheck() { return !this.locked && this.status?.configured === true && this.status.available === true && checkablePhases.has(this.status.phase); }
  canApply(now = Date.now()) {
    const status = this.status, checked = Date.parse(status?.checkedAt || '');
    return Boolean(!this.locked && status?.configured === true && status.available === true && status.phase === 'ready'
      && shaPattern.test(status.current?.sha || '') && shaPattern.test(status.target?.sha || '')
      && status.current.sha !== status.target.sha && typeof status.checkToken === 'string' && status.checkToken.length > 0 && status.checkToken.length <= 256
      && Number.isFinite(checked) && checked <= now + 5000 && now - checked < 10 * 60 * 1000);
  }
  applyPayload(now = Date.now()) {
    if (!this.canApply(now)) return null;
    return { expectedHead: this.status.current.sha, targetSha: this.status.target.sha, checkToken: this.status.checkToken };
  }
}

const bounded = (value, max = 700) => typeof value === 'string' ? value.slice(0, max) : '';
const dateText = value => {
  const date = new Date(value || NaN);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
};

async function startPage() {
  const model = new UpdateModel();
  const element = id => document.getElementById(id);
  const put = (id, text) => { const target = element(id); if (target.textContent !== text) target.textContent = text; };
  let timer, refreshPromise, closed = false;
  const feedback = (text, error = false) => { put('action-feedback', text); element('action-feedback').dataset.error = String(error); };
  function render() {
    const status = model.status || {}, phase = status.phase;
    element('check-update').disabled = !model.canCheck;
    element('apply-update').disabled = !model.canApply();
    element('setup-panel').hidden = status.configured !== false;
    element('apply-panel').hidden = phase !== 'ready';
    const disconnected = !model.online;
    const title = disconnected ? '다시 연결하고 있습니다' : model.pendingJob ? '작업을 접수했습니다' : model.busy ? '요청을 보내고 있습니다' : titles[phase] || '상태를 확인하고 있습니다';
    put('phase-title', title);
    put('phase-message', bounded(status.message) || (disconnected ? '서버 상태를 확인할 때까지 새 작업을 실행하지 않습니다.' : ''));
    const restarting = ['stopping', 'backing-up', 'applying', 'starting'].includes(phase);
    put('connection-note', disconnected || restarting ? '재시작 중에는 연결이 잠시 끊길 수 있습니다. 화면을 그대로 두면 다시 연결합니다.' : model.pendingJob ? 'Mac이 작업을 시작할 때까지 기다려 주세요. 다시 누를 필요는 없습니다.' : status.configured && status.available === false && !activePhases.has(phase) && phase !== 'manual' ? 'Mac의 업데이트 서비스가 응답하지 않거나 다른 작업을 처리 중입니다. 연결이 확인되면 다시 사용할 수 있습니다.' : '');
    document.querySelector('.status-card').dataset.state = ['manual', 'failed'].includes(phase) ? 'error' : disconnected || model.pendingJob || activePhases.has(phase) ? 'waiting' : 'normal';
    put('current-subject', bounded(status.current?.subject, 180) || '아직 확인하지 않았습니다.');
    put('current-sha', bounded(status.current?.sha, 64) || '—');
    put('target-subject', bounded(status.target?.subject, 180) || (phase === 'current' ? '현재 코드와 같은 버전입니다.' : '새 버전을 확인해 주세요.'));
    put('target-sha', bounded(status.target?.sha, 64) || '—');
    put('checked-at', `마지막 확인 ${dateText(status.checkedAt)}`);
    put('updated-at', dateText(status.updatedAt));
    put('job-id', bounded(status.jobId, 80) || '—');
    put('backup-id', bounded(status.backupId, 100) || '—');
    const reason = !model.owner ? '관리자 계정을 확인해야 합니다.' : disconnected ? '서버에 다시 연결한 뒤 실행할 수 있습니다.' : !status.configured ? 'Mac 연결 설정을 먼저 완료해 주세요.' : phase === 'manual' ? 'Mac에서 점검·복구를 마친 뒤 다시 연결해 주세요.' : model.pendingJob || model.busy || activePhases.has(phase) ? '진행 중인 작업이 끝날 때까지 기다려 주세요.' : !status.available ? 'Mac의 업데이트 서비스 연결을 확인해 주세요.' : '';
    put('check-reason', reason);
    put('apply-reason', reason || (phase === 'ready' && !model.canApply() ? '확인 결과가 만료되었거나 정보가 부족합니다. 새 버전을 다시 확인해 주세요.' : '확인 후 10분 안에 적용할 수 있습니다. 그사이 코드가 달라지면 다시 확인해야 합니다.'));
    document.querySelector('.recovery-card').dataset.manual = String(phase === 'manual');
    put('recovery-note', phase === 'manual' ? '자동 복구를 실행하지 않습니다. Mac에서 안내에 따라 코드·데이터·의존성 상태를 확인하고 세 서비스를 복구하세요. 백업 번호가 있으면 복구 안내에서 해당 백업을 확인하세요.' : phase === 'failed' ? '상단의 원인을 해결한 뒤 새 버전을 다시 확인하세요. 작업이 멈췄거나 서비스 상태가 불확실하면 Mac의 복구 안내를 먼저 확인하세요.' : '오류가 나면 상태 안내를 확인하세요. 중단 후 복구가 필요한 경우 Mac에서 직접 점검해야 합니다.');
    const step = phase === 'checking' || phase === 'ready' || phase === 'current' ? 'check' : phase === 'validating' ? 'validate' : ['stopping', 'backing-up'].includes(phase) ? 'backup' : phase === 'applying' ? 'apply' : ['starting', 'succeeded'].includes(phase) ? 'finish' : null;
    for (const item of document.querySelectorAll('[data-step]')) {
      if (item.dataset.step === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    }
  }
  async function request(path, options = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(bounded(data.error) || `요청을 처리하지 못했습니다 (${response.status}).`); error.status = response.status; throw error; }
      return data;
    } finally { clearTimeout(timeout); }
  }
  function schedule() {
    clearTimeout(timer);
    if (!closed && model.owner) timer = setTimeout(() => refresh(), 3000);
  }
  function denyAccess() {
    model.owner = false; model.online = false;
    element('update-content').hidden = true;
    put('access-state', '이 페이지는 기존 관리자 계정으로만 사용할 수 있습니다. 로그인 상태를 확인한 뒤 페이지를 다시 여세요.');
    clearTimeout(timer);
  }
  function refresh() {
    if (refreshPromise || closed || !model.owner) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const pendingJob = model.pendingJob, uncertain = model.uncertain;
        model.accept(await request('/api/portfolio/updates'));
        if ((pendingJob && !model.pendingJob) || uncertain) feedback('');
      }
      catch (error) { if (error.status === 401 || error.status === 403) denyAccess(); else model.online = false; }
      finally { refreshPromise = null; render(); schedule(); }
    })();
    return refreshPromise;
  }
  async function submit(action) {
    const payload = action === 'apply' ? model.applyPayload() : model.canCheck ? {} : null;
    if (!payload) return;
    model.busy = true; feedback(''); render();
    try {
      const result = await request(`/api/portfolio/updates/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (typeof result.jobId !== 'string' || !result.jobId || result.jobId.length > 80) throw new Error('작업 접수 응답을 확인하지 못했습니다. 상태를 다시 조회합니다.');
      model.pendingJob = result.jobId;
      feedback('작업을 접수했습니다. Mac의 진행 상태를 확인하고 있습니다.');
    } catch (error) {
      if (error.status === 401) denyAccess();
      else if (error.status) feedback(error.message, true);
      else { model.online = false; model.uncertain = true; feedback('접수 여부를 확인할 수 없어 상태를 다시 조회합니다. 요청을 자동으로 다시 보내지 않습니다.', true); }
    } finally { model.busy = false; render(); await refresh(); }
  }
  element('check-update').addEventListener('click', () => submit('check'));
  element('apply-update').addEventListener('click', () => submit('apply'));
  window.addEventListener('pagehide', () => { closed = true; clearTimeout(timer); });
  window.addEventListener('pageshow', event => { if (event.persisted) { closed = false; model.online = false; render(); refresh(); } });
  try {
    const session = await request('/api/portfolio/me'); model.authorize(session.user);
    if (!model.owner) { denyAccess(); return; }
    put('access-state', `${bounded(session.user.username, 64)} · 관리자`);
    element('update-content').hidden = false;
    render(); await refresh();
  } catch { denyAccess(); }
}

if (typeof document !== 'undefined') startPage();
