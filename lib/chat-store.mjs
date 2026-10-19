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
  const now = () => new Date().toISOString();
  const thread = id => db.prepare('SELECT * FROM threads WHERE id=?').get(id);
  const messages = id => db.prepare('SELECT * FROM messages WHERE threadId=? ORDER BY rowid').all(id)
    .map(row => ({ ...row, sources: JSON.parse(row.sources) }));
  return {
    db, thread, messages,
    list: () => db.prepare('SELECT * FROM threads ORDER BY updatedAt DESC, rowid DESC LIMIT 200').all(),
    create(model) {
      const id = randomUUID(), stamp = now();
      db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)').run(id, '새 대화', model, stamp, stamp);
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
