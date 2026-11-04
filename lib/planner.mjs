import { randomUUID } from 'node:crypto';
import { assert } from './validation.mjs';
export const PLANNER_ZONE = 'Asia/Seoul';
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const clean = (v, max, required = false) => { assert(typeof v === 'string' && v.length <= max && (!required || v.trim()) && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v), '입력 길이와 내용을 확인해 주세요.'); return v.trim(); };
function stamp(v) {
  if (v === null || v === '') return null;
  assert(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)), '날짜·시간과 시간대가 필요합니다.');
  const year = Number(v.slice(0, 4)), month = Number(v.slice(5, 7)), day = Number(v.slice(8, 10));
  assert(year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && Number(v.slice(11,13)) < 24 && Number(v.slice(14,16)) < 60, '유효한 날짜·시간을 입력하세요.');
  return new Date(v).toISOString();
}
function validate(value) {
  assert(object(value) && ['event', 'task'].includes(value.kind), '일정 또는 할 일을 선택하세요.');
  const startAt = stamp(value.startAt ?? null), endAt = stamp(value.endAt ?? null), dueAt = stamp(value.dueAt ?? null);
  assert(value.kind !== 'event' || startAt, '일정 시작 시간이 필요합니다.');
  assert(value.kind !== 'event' || !dueAt, '일정에는 시작·종료 시간을 사용하세요.');
  assert(value.kind !== 'task' || (!startAt && !endAt), '할 일에는 마감 시간을 사용하세요.');
  assert(!endAt || startAt && endAt > startAt, '종료 시간은 시작 시간 이후여야 합니다.');
  assert(['open', 'done', 'cancelled'].includes(value.status), '진행 상태를 확인하세요.');
  return { kind: value.kind, title: clean(value.title, 160, true), notes: clean(value.notes ?? '', 2000), startAt, endAt, dueAt, status: value.status };
}
export function createPlanner(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,json TEXT NOT NULL,revision INTEGER NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS planner_actions(operationId TEXT PRIMARY KEY,messageId TEXT,json TEXT NOT NULL,createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS planner_message_actions ON planner_actions(messageId);`);
  const decode = row => row ? { ...JSON.parse(row.json), id: row.id, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt } : null;
  const get = id => { assert(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), '일정 ID를 확인하세요.'); return decode(db.prepare('SELECT * FROM plans WHERE id=?').get(id)); };
  function list({ from, to, status = 'open', kind = 'all', query = '' } = {}) {
    assert(['open', 'done', 'cancelled', 'all'].includes(status) && ['all', 'event', 'task'].includes(kind), '조회 조건을 확인하세요.');
    const start = from ? stamp(from) : null, end = to ? stamp(to) : null, needle = clean(query, 160).toLowerCase();
    assert(!start || !end || end > start, '조회 종료 시간은 시작 시간 이후여야 합니다.');
    const all = db.prepare('SELECT * FROM plans').all().map(decode).filter(p => {
      const when = p.startAt || p.dueAt, until = p.endAt || when;
      return (status === 'all' || p.status === status) && (kind === 'all' || p.kind === kind) && (!needle || (p.title + ' ' + p.notes).toLowerCase().includes(needle)) && (!start || when && (p.endAt ? until > start : until >= start)) && (!end || when && when < end);
    }).sort((a,b) => (a.startAt || a.dueAt || '9999').localeCompare(b.startAt || b.dueAt || '9999') || a.createdAt.localeCompare(b.createdAt));
    return { items: all.slice(0, 150), total: all.length, truncated: all.length > 150, timeZone: PLANNER_ZONE };
  }
  function conflicts(item) {
    if (item.kind !== 'event' || item.status !== 'open') return [];
    const end = item.endAt || new Date(Date.parse(item.startAt) + 60000).toISOString();
    return db.prepare('SELECT * FROM plans').all().map(decode).filter(p => p.kind === 'event' && p.status === 'open' && p.id !== item.id && p.startAt < end && (p.endAt || new Date(Date.parse(p.startAt) + 60000).toISOString()) > item.startAt).map(p => ({ id:p.id, title:p.title, startAt:p.startAt, endAt:p.endAt }));
  }
  function mutate(action, input, { operationId = randomUUID(), messageId = null } = {}) {
    assert(object(input), '일정 입력을 확인하세요.');
    assert(typeof operationId === 'string' && operationId.length <= 200, '작업 식별자를 확인하세요.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT json FROM planner_actions WHERE operationId=?').get(operationId);
      if (previous) { db.exec('COMMIT'); return { ...JSON.parse(previous.json), duplicate:true }; }
      const now = new Date().toISOString(); let item;
      if (action === 'create') {
        assert(Object.keys(input).every(k => ['kind','title','notes','startAt','endAt','dueAt'].includes(k)), '알 수 없는 일정 항목입니다.');
        assert(db.prepare('SELECT COUNT(*) n FROM plans').get().n < 5000, '일정 저장 한도에 도달했습니다.');
        const value = validate({...input, status:'open'});
        item = {...value, id:randomUUID(),revision:1,createdAt:now,updatedAt:now};
        db.prepare('INSERT INTO plans VALUES (?,?,?,?,?)').run(item.id, JSON.stringify(value), 1, now, now);
      } else {
        assert(action === 'update' && object(input.changes), '변경할 내용을 확인하세요.');
        assert(Object.keys(input).every(k => ['id','revision','changes'].includes(k)), '알 수 없는 변경 항목입니다.');
        assert(Object.keys(input.changes).length > 0 && Object.keys(input.changes).every(k => ['title','notes','startAt','endAt','dueAt','status'].includes(k)), '변경 항목을 확인하세요.');
        const previous = get(input.id); assert(previous, '일정을 찾을 수 없습니다.', 404);
        assert(Number.isInteger(input.revision) && input.revision === previous.revision, '다른 곳에서 변경된 일정입니다. 다시 조회해 주세요.', 409);
        const value = validate({...previous, ...input.changes});
        item = {...previous,...value, revision:previous.revision+1,updatedAt:now};
        db.prepare('UPDATE plans SET json=?,revision=?,updatedAt=? WHERE id=?').run(JSON.stringify(value),item.revision,now,item.id);
      }
      const result = { action, item, conflicts:conflicts(item), saved:true };
      db.prepare('INSERT INTO planner_actions VALUES (?,?,?,?)').run(operationId,messageId,JSON.stringify(result),now);
      db.exec('COMMIT'); return result;
    } catch(error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  return { list,get,mutate, actions: messageId => db.prepare('SELECT json FROM planner_actions WHERE messageId=? ORDER BY rowid').all(messageId).map(r=>JSON.parse(r.json)) };
}
