import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, levelsFor, schedule, validateQuestion, validateSettings, assert, RATINGS } from './validation.mjs';
import { practiceItems } from '../content/japanese-practice.mjs';
import { createPractice } from './practice.mjs';

/** SQLite repository; mutations are committed together to preserve review history. */
export function createStore(directory, seeds, { language = 'ja', practiceSeeds = practiceItems } = {}) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'jlpt.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, questionId TEXT NOT NULL REFERENCES questions(id), answerIndex INTEGER NOT NULL, correct INTEGER NOT NULL, durationMs INTEGER NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (questionId TEXT PRIMARY KEY REFERENCES questions(id), dueAt TEXT NOT NULL, intervalDays REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS attempts_created ON attempts(createdAt);
    CREATE INDEX IF NOT EXISTS reviews_due ON reviews(dueAt);`);
  db.prepare('INSERT OR IGNORE INTO settings VALUES (1, ?)').run(JSON.stringify({ ...defaults, level: levelsFor(language)[0] }));
  if (!db.prepare("SELECT value FROM metadata WHERE key='seeded'").get()) {
    const insert = db.prepare('INSERT OR IGNORE INTO questions VALUES (?, ?)');
    for (const seed of seeds) { const q = validateQuestion(seed, language); insert.run(q.id, JSON.stringify(q)); }
    db.prepare("INSERT INTO metadata VALUES ('seeded','1')").run();
  }
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const practice = createPractice(db, practiceSeeds, language);
  const getSettings = () => JSON.parse(db.prepare('SELECT json FROM settings WHERE id=1').get().json);
  const setSettings = value => { const valid = validateSettings(value, language); db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(valid)); return valid; };
  const questions = () => db.prepare('SELECT json FROM questions ORDER BY id').all().map(r => JSON.parse(r.json));
  const question = id => { assert(typeof id === 'string' && id.length <= 100, '문항 ID를 확인해 주세요.'); const row = db.prepare('SELECT json FROM questions WHERE id=?').get(id); assert(row, '문항을 찾을 수 없습니다.', 404); return JSON.parse(row.json); };
  const reviews = () => db.prepare('SELECT * FROM reviews ORDER BY dueAt').all();
  const attempts = () => db.prepare('SELECT * FROM attempts ORDER BY id').all().map(a => ({ ...a, correct: Boolean(a.correct) }));
  const review = (id, rating) => { question(id); const next = schedule(db.prepare('SELECT * FROM reviews WHERE questionId=?').get(id), rating); db.prepare('INSERT OR REPLACE INTO reviews VALUES (?, ?, ?)').run(id, next.dueAt, next.intervalDays); return { questionId: id, ...next }; };
  const attempt = input => {
    const q = question(input.questionId);
    assert(Number.isInteger(input.answerIndex) && input.answerIndex >= 0 && input.answerIndex < q.choices.length, '답안을 선택해 주세요.');
    assert(Number.isInteger(input.durationMs) && input.durationMs >= 0 && input.durationMs <= 86400000, '풀이 시간을 확인해 주세요.');
    assert(input.confidence === undefined || RATINGS.includes(input.confidence), '복습 평가를 확인해 주세요.');
    return transaction(() => {
      const correct = q.answerIndex === input.answerIndex;
      const result = db.prepare('INSERT INTO attempts(questionId,answerIndex,correct,durationMs,createdAt) VALUES (?,?,?,?,?)').run(q.id, input.answerIndex, Number(correct), input.durationMs, new Date().toISOString());
      const next = review(q.id, correct ? input.confidence || 'good' : 'again');
      return { correct, answerIndex: q.answerIndex, explanation: q.explanation, reviewDueAt: next.dueAt, attemptId: Number(result.lastInsertRowid) };
    });
  };
  const importQuestions = input => {
    assert(Array.isArray(input) && input.length > 0 && input.length <= 1000, '1~1000개의 문항을 가져올 수 있습니다.');
    const valid = input.map(q => validateQuestion(q, language));
    assert(new Set(valid.map(q => q.id)).size === valid.length, '중복된 문항 ID가 있습니다.');
    return transaction(() => {
      for (const q of valid) {
        const existing = db.prepare('SELECT json FROM questions WHERE id=?').get(q.id);
        if (existing && db.prepare('SELECT id FROM attempts WHERE questionId=? LIMIT 1').get(q.id)) assert(JSON.stringify(validateQuestion(JSON.parse(existing.json), language)) === JSON.stringify(q), `이미 학습한 문항(${q.id})은 수정할 수 없습니다. 새 ID로 등록해 주세요.`, 409);
      }
      const upsert = db.prepare('INSERT INTO questions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json'); for (const q of valid) upsert.run(q.id, JSON.stringify(q));
      db.exec('DELETE FROM ai_cache'); return { imported: valid.length };
    });
  };
  const backup = () => transaction(() => ({ schemaVersion: 2, language, exportedAt: new Date().toISOString(), settings: getSettings(), questions: questions(), attempts: attempts(), reviews: reviews(), practice: practice.backup() }));
  const restore = data => {
    assert(data && [1, 2].includes(data.schemaVersion), '지원하지 않는 백업 형식입니다.');
    assert((data.language || 'ja') === language, '선택한 학습 언어와 백업 언어가 다릅니다.');
    const practiceData = data.schemaVersion === 2 ? practice.validateBackup(data.practice) : null;
    const settings = validateSettings(data.settings, language);
    assert(Array.isArray(data.questions) && data.questions.length <= 10000 && Array.isArray(data.attempts) && data.attempts.length <= 100000 && Array.isArray(data.reviews), '백업 데이터가 올바르지 않습니다.');
    const qs = data.questions.map(q => validateQuestion(q, language)), ids = new Set(qs.map(q => q.id)), byId = new Map(qs.map(q => [q.id, q]));
    assert(ids.size === qs.length, '중복 문항 ID가 있습니다.');
    const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    const attemptIds = new Set();
    for (const a of data.attempts) {
      assert(a && Number.isSafeInteger(a.id) && a.id > 0 && !attemptIds.has(a.id) && ids.has(a.questionId), '백업 학습 기록 ID를 확인해 주세요.'); attemptIds.add(a.id);
      assert(Number.isInteger(a.answerIndex) && a.answerIndex >= 0 && a.answerIndex < byId.get(a.questionId).choices.length && typeof a.correct === 'boolean' && Number.isInteger(a.durationMs) && a.durationMs >= 0 && a.durationMs <= 86400000 && stamp(a.createdAt), '백업 학습 기록을 확인해 주세요.');
      assert(a.correct === (a.answerIndex === byId.get(a.questionId).answerIndex), '백업의 정답 정보가 일치하지 않습니다.');
    }
    const reviewIds = new Set();
    for (const r of data.reviews) { assert(r && ids.has(r.questionId) && !reviewIds.has(r.questionId) && stamp(r.dueAt) && typeof r.intervalDays === 'number' && Number.isFinite(r.intervalDays) && r.intervalDays > 0 && r.intervalDays <= 180, '백업 복습 기록을 확인해 주세요.'); reviewIds.add(r.questionId); }
    return transaction(() => {
      db.exec('DELETE FROM reviews; DELETE FROM attempts; DELETE FROM questions; DELETE FROM ai_cache;'); setSettings(settings);
      const qInsert = db.prepare('INSERT INTO questions VALUES (?,?)'); for (const q of qs) qInsert.run(q.id, JSON.stringify(q));
      const aInsert = db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)'); for (const a of data.attempts) aInsert.run(a.id, a.questionId, a.answerIndex, Number(a.correct), a.durationMs, a.createdAt);
      const rInsert = db.prepare('INSERT INTO reviews VALUES (?,?,?)'); for (const r of data.reviews) rInsert.run(r.questionId, r.dueAt, r.intervalDays);
      if (practiceData) practice.restore(practiceData);
      return { restored: true, questions: qs.length, attempts: data.attempts.length };
    });
  };
  return { language, levels: levelsFor(language), db, transaction, getSettings, setSettings, questions, question, reviews, attempts, review, attempt, importQuestions, backup, restore, practice };
}
