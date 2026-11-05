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
  if(!db.prepare('PRAGMA table_info(assistant_notices)').all().some(c=>c.name==='messageId'))db.exec('ALTER TABLE assistant_notices ADD COLUMN messageId TEXT');
  // Fold old notice threads into one without dropping messages or replies.
  db.exec('BEGIN IMMEDIATE');
  try {
    const old=db.prepare('SELECT n.noticeKey,n.threadId,n.messageId,t.createdAt,t.updatedAt FROM assistant_notices n JOIN threads t ON t.id=n.threadId ORDER BY t.createdAt,t.rowid').all();
    if(old.length) {
      const id=old[0].threadId;
      for(const row of old) {
        const messageId=row.messageId||db.prepare("SELECT id FROM messages WHERE threadId=? AND model='스텔라 자료실 관리' ORDER BY rowid LIMIT 1").get(row.threadId)?.id||null;
        db.prepare('UPDATE assistant_notices SET threadId=?,messageId=? WHERE noticeKey=?').run(id,messageId,row.noticeKey);
        if(row.threadId!==id) {
          db.prepare('UPDATE messages SET threadId=? WHERE threadId=?').run(id,row.threadId);
          db.prepare('DELETE FROM threads WHERE id=? AND NOT EXISTS (SELECT 1 FROM assistant_notices WHERE threadId=?)').run(row.threadId,row.threadId);
        }
      }
      db.prepare("UPDATE threads SET title='스텔라 공지',updatedAt=MAX(updatedAt,?) WHERE id=?").run(old.map(r=>r.updatedAt).sort().at(-1),id);
    }
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');db.close();throw error;}
  const planner = createPlanner(db);
  const drafts = createLibraryDrafts(db);
  const now = () => new Date().toISOString();
  const decorate = row => row ? {...row, project:drafts.project(row.id)} : row;
  const thread = id => decorate(db.prepare('SELECT * FROM threads WHERE id=?').get(id));
  const messages = id => db.prepare('SELECT * FROM messages WHERE threadId=? ORDER BY createdAt,rowid').all(id)
    .map(row => ({ ...row, sources: JSON.parse(row.sources), actions: [...planner.actions(row.id), ...drafts.actions(row.id)] }));
  return {
    db, thread, messages, planner, drafts,
    notices: () => db.prepare('SELECT DISTINCT t.* FROM assistant_notices n JOIN threads t ON t.id=n.threadId ORDER BY t.updatedAt DESC LIMIT 30').all(),
    announce(key,title,content) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const old=db.prepare('SELECT threadId,messageId FROM assistant_notices WHERE noticeKey=?').get(key);
        const existing=db.prepare('SELECT threadId FROM assistant_notices LIMIT 1').get();
        const id=old?.threadId||existing?.threadId||randomUUID(), stamp=now();
        if(!old&&!existing)db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(id,'스텔라 공지','stella-notice',stamp,stamp);
        db.prepare("UPDATE threads SET title='스텔라 공지',updatedAt=? WHERE id=?").run(stamp,id);
        if(old?.messageId)db.prepare('UPDATE messages SET content=? WHERE id=? AND threadId=?').run(content,old.messageId,id);
        else {
          const messageId=randomUUID();db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run(messageId,id,'assistant',content,'complete','[]','스텔라 자료실 관리',stamp);
          if(old)db.prepare('UPDATE assistant_notices SET messageId=? WHERE noticeKey=?').run(messageId,key);
          else db.prepare('INSERT INTO assistant_notices(noticeKey,threadId,messageId) VALUES (?,?,?)').run(key,id,messageId);
        }
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
