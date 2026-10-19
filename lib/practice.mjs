import { assert, LEVELS, RATINGS, schedule } from './validation.mjs';

export const PRACTICE_KINDS = ['words', 'sentences', 'listening'];
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const normalized = value => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
export function validatePracticeItem(value) {
  assert(value && typeof value === 'object' && value.language === 'ja' && LEVELS.includes(value.level), '일본어 자료의 언어·급수를 확인해 주세요.');
  assert(typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id), '자료 ID를 확인해 주세요.');
  const result = { id: value.id, language: 'ja', level: value.level };
  for (const key of ['word', 'reading', 'meaning', 'example', 'translation', 'target', 'source']) {
    assert(typeof value[key] === 'string' && value[key].trim() && value[key].length <= 2000, `${key} 내용을 확인해 주세요.`); result[key] = value[key];
  }
  assert(result.example.includes(result.target), '문장에 빈칸 정답이 포함되어 있어야 합니다.'); return result;
}

/** Separate recall skills share a language-aware catalogue but never share schedules. */
export function createPractice(db, seeds) {
  db.exec(`CREATE TABLE IF NOT EXISTS practice_items (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS practice_cards (entryId TEXT NOT NULL REFERENCES practice_items(id), kind TEXT NOT NULL, rating TEXT NOT NULL, seen INTEGER NOT NULL, intervalDays REAL NOT NULL, dueAt TEXT NOT NULL, PRIMARY KEY(entryId,kind));
    CREATE TABLE IF NOT EXISTS practice_events (requestId TEXT PRIMARY KEY, entryId TEXT NOT NULL REFERENCES practice_items(id), kind TEXT NOT NULL, rating TEXT NOT NULL, durationMs INTEGER NOT NULL, answer TEXT, match INTEGER, createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS practice_due ON practice_cards(kind,dueAt);`);
  if (!db.prepare("SELECT value FROM metadata WHERE key='practice-seeded-v1'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const insert = db.prepare('INSERT OR IGNORE INTO practice_items VALUES (?,?)');
      for (const seed of seeds) { const value = validatePracticeItem(seed); insert.run(value.id, JSON.stringify(value)); }
      db.prepare("INSERT INTO metadata VALUES ('practice-seeded-v1','1')").run(); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const items = () => db.prepare('SELECT json FROM practice_items ORDER BY id').all().map(row => JSON.parse(row.json));
  const cards = () => db.prepare('SELECT * FROM practice_cards ORDER BY entryId,kind').all();
  const events = () => db.prepare('SELECT * FROM practice_events ORDER BY createdAt,requestId').all();
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
  const summary = level => {
    const ids = new Set(items().filter(item => item.language === 'ja' && item.level === level).map(item => item.id));
    const progress = cards().filter(row => ids.has(row.entryId)), history = events().filter(row => ids.has(row.entryId));
    const now = new Date(), today = dayFormat.format(now);
    return Object.fromEntries(PRACTICE_KINDS.map(kind => {
      const rows = progress.filter(row => row.kind === kind);
      const reviewsToday = history.filter(row => row.kind === kind && dayFormat.format(new Date(row.createdAt)) === today).length;
      return [kind, { total: ids.size, seen: rows.length, newCount: ids.size - rows.length, dueCount: rows.filter(row => row.dueAt <= now.toISOString()).length, reviewsToday }];
    }));
  };
  const list = (level, kind, queue, limit = 10) => {
    assert(LEVELS.includes(level) && PRACTICE_KINDS.includes(kind) && ['recommended', 'review', 'all'].includes(queue), '연습 조건을 확인해 주세요.');
    const now = new Date().toISOString(), progress = new Map(cards().filter(row => row.kind === kind).map(row => [row.entryId, row]));
    const result = items().filter(item => item.level === level && item.language === 'ja').map(item => {
      const card = progress.get(item.id), due = card && card.dueAt <= now;
      return { ...item, progress: card || null, recommendation: due ? (card.rating === 'again' || card.rating === 'hard' ? '헷갈렸던 항목의 복습 시간입니다.' : '다시 기억할 시간입니다.') : !card ? '목표 급수의 새 학습 항목입니다.' : '다음 복습 전 추가 연습입니다.', priority: due ? 0 : !card ? 1 : 2 };
    }).filter(item => queue === 'all' || (queue === 'review' ? item.priority === 0 : item.priority < 2))
      .sort((a, b) => a.priority - b.priority || (a.progress?.dueAt || '').localeCompare(b.progress?.dueAt || '') || a.id.localeCompare(b.id));
    return { language: 'ja', kind, queue, level, items: result.slice(0, limit), count: result.length, summary: summary(level)[kind] };
  };
  const grade = input => {
    assert(typeof input.entryId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(input.entryId), '자료 ID를 확인해 주세요.');
    assert(typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{10,100}$/.test(input.requestId), '요청 ID를 확인해 주세요.');
    assert(PRACTICE_KINDS.includes(input.kind) && RATINGS.includes(input.rating), '연습 종류·기억 정도를 확인해 주세요.');
    assert(Number.isInteger(input.durationMs) && input.durationMs >= 0 && input.durationMs <= 86400000, '학습 시간을 확인해 주세요.');
    assert(input.answer === undefined || (typeof input.answer === 'string' && input.answer.length <= 2000), '입력은 2000자 이하여야 합니다.');
    assert(input.kind !== 'listening' || input.listened === true, '음성을 끝까지 재생한 뒤 듣기 기록을 저장할 수 있습니다.');
    const entry = db.prepare('SELECT json FROM practice_items WHERE id=?').get(input.entryId);
    assert(entry, '학습 항목을 찾을 수 없습니다.', 404);
    const item = JSON.parse(entry.json), oldEvent = db.prepare('SELECT * FROM practice_events WHERE requestId=?').get(input.requestId);
    if (oldEvent) {
      assert(oldEvent.entryId === input.entryId && oldEvent.kind === input.kind && oldEvent.rating === input.rating, '이미 사용한 요청 ID입니다.', 409);
      return { duplicate: true, ...db.prepare('SELECT * FROM practice_cards WHERE entryId=? AND kind=?').get(input.entryId, input.kind) };
    }
    const previous = db.prepare('SELECT * FROM practice_cards WHERE entryId=? AND kind=?').get(input.entryId, input.kind);
    const next = schedule(previous, input.rating);
    const accepted = input.kind === 'sentences' ? [item.target, ...(item.target === item.word ? [item.reading] : [])] : [item.example];
    const match = input.answer?.trim() && input.kind !== 'words' ? Number(accepted.some(value => normalized(input.answer) === normalized(value))) : null;
    db.prepare('INSERT INTO practice_events VALUES (?,?,?,?,?,?,?,?)').run(input.requestId, item.id, input.kind, input.rating, input.durationMs, input.answer ?? null, match, new Date().toISOString());
    const card = { entryId: item.id, kind: input.kind, rating: input.rating, seen: (previous?.seen || 0) + 1, ...next };
    db.prepare('INSERT OR REPLACE INTO practice_cards VALUES (?,?,?,?,?,?)').run(card.entryId, card.kind, card.rating, card.seen, card.intervalDays, card.dueAt);
    return { ...card, match: match === null ? null : Boolean(match) };
  };
  const backup = () => ({ items: items(), cards: cards(), events: events() });
  const validateBackup = data => {
    assert(data && Array.isArray(data.items) && data.items.length <= 10000 && Array.isArray(data.cards) && data.cards.length <= 30000 && Array.isArray(data.events) && data.events.length <= 100000, '암기·연습 백업 형식을 확인해 주세요.');
    const values = data.items.map(validatePracticeItem), ids = new Set(values.map(item => item.id)); assert(ids.size === values.length, '중복된 연습 자료 ID입니다.');
    const keys = new Set(), eventIds = new Set();
    for (const row of data.cards) {
      assert(row && typeof row === 'object', '복습 카드 백업을 확인해 주세요.');
      const key = `${row.entryId}:${row.kind}`;
      assert(ids.has(row.entryId) && PRACTICE_KINDS.includes(row.kind) && RATINGS.includes(row.rating) && !keys.has(key) && Number.isInteger(row.seen) && row.seen > 0 && Number.isFinite(row.intervalDays) && row.intervalDays > 0 && row.intervalDays <= 180 && iso(row.dueAt), '복습 카드 백업을 확인해 주세요.'); keys.add(key);
    }
    for (const row of data.events) {
      assert(row && typeof row === 'object', '연습 이력 백업을 확인해 주세요.');
      assert(typeof row.requestId === 'string' && /^[a-zA-Z0-9_-]{10,100}$/.test(row.requestId) && !eventIds.has(row.requestId) && ids.has(row.entryId) && PRACTICE_KINDS.includes(row.kind) && RATINGS.includes(row.rating) && Number.isInteger(row.durationMs) && row.durationMs >= 0 && row.durationMs <= 86400000 && (row.answer === null || (typeof row.answer === 'string' && row.answer.length <= 2000)) && [null, 0, 1].includes(row.match) && iso(row.createdAt), '연습 이력 백업을 확인해 주세요.'); eventIds.add(row.requestId);
    }
    return { items: values, cards: data.cards, events: data.events };
  };
  // Caller owns the SQLite transaction so quiz and practice restore atomically.
  const restore = data => {
    db.exec('DELETE FROM practice_events; DELETE FROM practice_cards; DELETE FROM practice_items;');
    const i = db.prepare('INSERT INTO practice_items VALUES (?,?)'); for (const item of data.items) i.run(item.id, JSON.stringify(item));
    const c = db.prepare('INSERT INTO practice_cards VALUES (?,?,?,?,?,?)'); for (const row of data.cards) c.run(row.entryId, row.kind, row.rating, row.seen, row.intervalDays, row.dueAt);
    const e = db.prepare('INSERT INTO practice_events VALUES (?,?,?,?,?,?,?,?)'); for (const row of data.events) e.run(row.requestId, row.entryId, row.kind, row.rating, row.durationMs, row.answer, row.match, row.createdAt);
  };
  return { list, grade, summary, backup, validateBackup, restore };
}
