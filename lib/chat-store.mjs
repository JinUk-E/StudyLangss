import { createLibraryDrafts } from './library-agent.mjs';
import { createPlanner } from './planner.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createChatStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'chat.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
      sources TEXT NOT NULL DEFAULT '[]', model TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_thread_messages ON messages(threadId, createdAt);
    UPDATE messages SET status='interrupted' WHERE status='generating';`);
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_notices (noticeKey TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE);`);
  const planner = createPlanner(db);
  const drafts = createLibraryDrafts(db);
  const now = () => new Date().toISOString();
  const decorate = row => row ? {...row, project:drafts.project(row.id)} : row;
  const thread = id => decorate(db.prepare('SELECT * FROM threads WHERE id=?').get(id));
  const messages = id => db.prepare('SELECT * FROM messages WHERE threadId=? ORDER BY rowid').all(id)
    .map(row => ({ ...row, sources: JSON.parse(row.sources), actions: [...planner.actions(row.id), ...drafts.actions(row.id)] }));
  return {
    db, thread, messages, planner, drafts,
    notices: () => db.prepare('SELECT t.* FROM assistant_notices n JOIN threads t ON t.id=n.threadId ORDER BY t.updatedAt DESC LIMIT 30').all(),
    announce(key,title,content) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const old=db.prepare('SELECT threadId FROM assistant_notices WHERE noticeKey=?').get(key);
        const id=old?.threadId||randomUUID(), stamp=now();
        if(!old){db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(id,title,'stella-notice',stamp,stamp);db.prepare('INSERT INTO assistant_notices VALUES (?,?)').run(key,id);}
        else {db.prepare('UPDATE threads SET title=?,updatedAt=? WHERE id=?').run(title,stamp,id);}
        const prior=db.prepare("SELECT id FROM messages WHERE threadId=? AND model='스텔라 자료실 관리' ORDER BY rowid LIMIT 1").get(id);
        if(prior)db.prepare('UPDATE messages SET content=? WHERE id=?').run(content,prior.id);
        else db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),id,'assistant',content,'complete','[]','스텔라 자료실 관리',stamp);
        db.exec('COMMIT');return thread(id);
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    list: () => db.prepare('SELECT * FROM threads ORDER BY updatedAt DESC, rowid DESC LIMIT 200').all().map(decorate),
    create(model, project=null) {
      const id = randomUUID(), stamp = now();
      db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)').run(id, '새 대화', model, stamp, stamp);
      drafts.bind(id,project);
      return thread(id);
    },
    remove: id => db.prepare('DELETE FROM threads WHERE id=?').run(id),
    begin(id, content, model) {
      const userId = randomUUID(), assistantId = randomUUID(), stamp = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        const first = !db.prepare('SELECT 1 FROM messages WHERE threadId=? LIMIT 1').get(id);
        if (first) db.prepare('UPDATE threads SET title=? WHERE id=?').run(content.replace(/\s+/g, ' ').slice(0, 60), id);
        db.prepare('UPDATE threads SET model=?, updatedAt=? WHERE id=?').run(model, stamp, id);
        const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        insert.run(userId, id, 'user', content, 'complete', '[]', model, stamp);
        insert.run(assistantId, id, 'assistant', '', 'generating', '[]', model, stamp);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return assistantId;
    },
    finish(id, content, status, sources) {
      db.prepare('UPDATE messages SET content=?, status=?, sources=? WHERE id=?').run(content, status, JSON.stringify(sources), id);
    }
  };
}
