import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assert } from './validation.mjs';

export const accountsFilename = authFile => resolve(process.env.AUTH_USERS_FILE || join(dirname(authFile), 'accounts.sqlite'));
const namePattern = /^[A-Za-z0-9_.-]{1,64}$/;
const bootstrapDigest = value => createHash('sha256').update(JSON.stringify({ version: value.version, username: value.username, algorithm: value.algorithm, salt: value.salt, hash: value.hash })).digest('hex');
const publicAccount = row => row ? { id: row.id, username: row.username, permissions: JSON.parse(row.permissions), isAdmin: row.id === 'owner', enabled: Boolean(row.enabled), revision: row.revision } : null;

function permissionsInput(value) {
  assert(Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(permission => ['study', 'chat'].includes(permission)) && new Set(value).size === value.length, '학습 또는 AI 대화 권한을 하나 이상 선택하세요.');
  return ['study', 'chat'].filter(permission => value.includes(permission));
}

async function database(filename) {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    await chmod(filename, 0o600);
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        credentials TEXT NOT NULL, permissions TEXT NOT NULL, enabled INTEGER NOT NULL,
        revision INTEGER NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_names (name TEXT PRIMARY KEY COLLATE NOCASE, accountId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    return db;
  } catch (error) { db.close(); throw error; }
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function ownerNameAvailable(db, username) {
  assert(namePattern.test(username), '아이디 형식을 확인하세요.');
  const current = db.prepare('SELECT id FROM accounts WHERE username=? COLLATE NOCASE').get(username);
  const history = db.prepare('SELECT accountId FROM account_names WHERE name=? COLLATE NOCASE').get(username);
  assert((!current || current.id === 'owner') && (!history || history.accountId === 'owner'), '다른 계정에서 사용한 아이디입니다. 관리자 아이디를 다른 이름으로 지정하세요.', 409);
}

function synchronizeOwner(db, credentials) {
  ownerNameAvailable(db, credentials.username);
  const digest = bootstrapDigest(credentials);
  const owner = db.prepare("SELECT * FROM accounts WHERE id='owner'").get();
  const previous = db.prepare("SELECT value FROM account_metadata WHERE key='bootstrap'").get()?.value;
  if (!owner) db.prepare('INSERT INTO accounts(id,username,credentials,permissions,enabled,revision,createdAt) VALUES(?,?,?,?,?,?,?)')
    .run('owner', credentials.username, JSON.stringify(credentials), '["study","chat"]', 1, 1, new Date().toISOString());
  else if (digest !== previous) db.prepare("UPDATE accounts SET username=?,credentials=?,permissions='[\"study\",\"chat\"]',enabled=1,revision=revision+1 WHERE id='owner'")
    .run(credentials.username, JSON.stringify(credentials));
  db.prepare('INSERT OR IGNORE INTO account_names(name,accountId) VALUES(?,?)').run(credentials.username, 'owner');
  db.prepare("INSERT INTO account_metadata(key,value) VALUES('bootstrap',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(digest);
}

/** Hold the same DB write lock as account creation before replacing auth.json. */
export async function updateOwnerBootstrap({ filename, credentials, replaceFile }) {
  const db = await database(filename);
  try {
    transaction(db, () => {
      ownerNameAvailable(db, credentials.username);
      replaceFile();
      synchronizeOwner(db, credentials);
    });
  } finally { db.close(); }
}

export async function createAccountManager({ filename, readBootstrap, makeCredentials }) {
  const db = await database(filename);
  let closed = false;
  const open = () => assert(!closed, '계정 저장소가 종료되었습니다.', 503);
  let bootstrap;
  try { transaction(db, () => { bootstrap = readBootstrap(); synchronizeOwner(db, bootstrap); }); }
  catch (error) { db.close(); throw error; }
  const credentialsFor = async (username, password) => {
    try { return await makeCredentials(username, password); }
    catch (error) { error.status = 400; throw error; }
  };
  const find = id => { open(); return typeof id === 'string' && id.length <= 64 ? db.prepare('SELECT * FROM accounts WHERE id=?').get(id) : undefined; };
  const manager = {
    list() { open(); return db.prepare("SELECT * FROM accounts ORDER BY CASE WHEN id='owner' THEN 0 ELSE 1 END,createdAt,id").all().map(publicAccount); },
    get(id) { return publicAccount(find(id)); },
    isActive(id) { return Boolean(find(id)?.enabled); },
    current(principal, permission) {
      if (!principal || typeof principal !== 'object') return false;
      const row = find(principal.id);
      if (!row?.enabled || row.revision !== principal.revision) return false;
      if (permission === undefined) return true;
      if (permission === 'admin') return row.id === 'owner';
      if (!['study', 'chat'].includes(permission)) return false;
      return row.id === 'owner' || JSON.parse(row.permissions).includes(permission);
    },
    async create(input) {
      open();
      assert(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['username', 'password', 'permissions', 'enabled'].includes(key)), '계정 생성 항목을 확인하세요.');
      assert(typeof input.username === 'string' && namePattern.test(input.username), '아이디는 영문·숫자·._-로 1~64자입니다.');
      const permissions = permissionsInput(input.permissions);
      const enabled = input.enabled === undefined ? true : input.enabled;
      assert(typeof enabled === 'boolean', '계정 활성 상태를 확인하세요.');
      const credentials = await credentialsFor(input.username, input.password);
      open();
      return transaction(db, () => {
        assert(!db.prepare('SELECT 1 FROM account_names WHERE name=? COLLATE NOCASE').get(input.username), '이미 사용한 아이디입니다.', 409);
        assert(db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count < 30, '계정은 관리자를 포함해 최대 30개입니다.', 409);
        const id = randomUUID();
        db.prepare('INSERT INTO accounts(id,username,credentials,permissions,enabled,revision,createdAt) VALUES(?,?,?,?,?,?,?)')
          .run(id, input.username, JSON.stringify(credentials), JSON.stringify(permissions), Number(enabled), 1, new Date().toISOString());
        db.prepare('INSERT INTO account_names(name,accountId) VALUES(?,?)').run(input.username, id);
        return publicAccount(find(id));
      });
    },
    async update(id, changes) {
      open();
      assert(id !== 'owner', '고정 관리자는 계정 화면에서 변경할 수 없습니다. 비밀번호 복구는 setup-auth를 사용하세요.', 403);
      const original = find(id);
      assert(original, '계정을 찾을 수 없습니다.', 404);
      assert(changes && typeof changes === 'object' && !Array.isArray(changes) && Object.keys(changes).length > 0 && Object.keys(changes).every(key => ['permissions', 'enabled', 'password'].includes(key)), '변경 가능한 계정 항목을 확인하세요.');
      const permissions = Object.hasOwn(changes, 'permissions') ? permissionsInput(changes.permissions) : undefined;
      if (Object.hasOwn(changes, 'enabled')) assert(typeof changes.enabled === 'boolean', '계정 활성 상태를 확인하세요.');
      const credentials = Object.hasOwn(changes, 'password') ? await credentialsFor(original.username, changes.password) : undefined;
      open();
      return transaction(db, () => {
        const current = find(id);
        assert(current, '계정을 찾을 수 없습니다.', 404);
        db.prepare('UPDATE accounts SET credentials=?,permissions=?,enabled=?,revision=revision+1 WHERE id=?')
          .run(credentials ? JSON.stringify(credentials) : current.credentials, permissions ? JSON.stringify(permissions) : current.permissions,
            Object.hasOwn(changes, 'enabled') ? Number(changes.enabled) : current.enabled, id);
        return publicAccount(find(id));
      });
    },
    close() { if (!closed) { closed = true; db.close(); } }
  };
  return {
    accounts: manager,
    bootstrap,
    verifier(username) {
      open();
      if (typeof username !== 'string' || !namePattern.test(username)) return null;
      const row = db.prepare('SELECT * FROM accounts WHERE username=? COLLATE NOCASE').get(username);
      return row ? { principal: publicAccount(row), credentials: JSON.parse(row.credentials) } : null;
    }
  };
}
