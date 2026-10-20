import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentials, loadAuth } from '../lib/auth.mjs';
import { saveOwnerCredentials } from '../scripts/setup-auth.mjs';

// Each test file runs in its own process. Never inherit a live account DB path.
delete process.env.AUTH_USERS_FILE;

const OWNER_PASSWORD = 'owner-password-test-2026';
const USER_PASSWORD = 'user-password-test-2026';
const basic = (username, password) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const request = (username, password) => ({ headers: username === undefined ? {} : { authorization: basic(username, password) } });
function response() {
  return { headers: {}, status: undefined, body: undefined, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'stella-accounts-'));
  const filename = join(directory, 'auth.json');
  const credentials = await createCredentials('owner-test', OWNER_PASSWORD);
  await writeFile(filename, JSON.stringify(credentials), { mode: 0o600 });
  const instances = [];
  const open = async () => { const auth = await loadAuth(filename); instances.push(auth); return auth; };
  const auth = await open();
  t.after(async () => { instances.forEach(item => item.accounts.close()); await rm(directory, { recursive: true, force: true }); });
  return { directory, filename, credentials, auth, open };
}

test('v1 bootstrap owner verifier stays unchanged and all instances share stable owner identity', async t => {
  const f = await fixture(t);
  const original = await readFile(f.filename, 'utf8');
  const req = request('owner-test', OWNER_PASSWORD);
  const owner = await f.auth(req, response());
  assert.deepEqual(owner, { id: 'owner', username: 'owner-test', permissions: ['study', 'chat'], isAdmin: true, enabled: true, revision: 1 });
  assert.equal(req.user, owner);
  const second = await f.open();
  assert.deepEqual(second.accounts.get('owner'), owner);
  assert.equal(second.accounts.current(owner, 'admin'), true);
  assert.equal(second.accounts.current(owner, 'study'), true);
  assert.equal(await readFile(f.filename, 'utf8'), original);
  if (process.platform !== 'win32') assert.equal((await stat(join(f.directory, 'accounts.sqlite'))).mode & 0o777, 0o600);
});

test('authentication rejection preserves Basic challenge and optional probes never challenge', async t => {
  const { auth } = await fixture(t);
  for (const req of [request(), request('owner-test', 'incorrect-password'), request('missing', OWNER_PASSWORD), { headers: { authorization: 'Basic !!!' } }, { headers: { authorization: 'Basic /w==' } }]) {
    const res = response();
    assert.equal(await auth(req, res), false);
    assert.equal(res.status, 401); assert.match(res.headers['www-authenticate'], /Basic realm="HARU"/);
  }
  const optionalResponse = response();
  assert.equal(await auth(request(), optionalResponse, { optional: true }), null);
  assert.deepEqual(optionalResponse.headers, {}); assert.equal(optionalResponse.status, undefined);
  const valid = await auth(request('owner-test', OWNER_PASSWORD), response(), { optional: true });
  assert.equal(valid.id, 'owner');
});

test('missing and damaged auth bootstrap fails closed even when an accounts DB already exists', async t => {
  const f = await fixture(t);
  await assert.rejects(loadAuth(join(f.directory, 'missing.json')), /인증 파일/);
  for (const value of ['not-json', '{}', JSON.stringify({ ...f.credentials, username: 123 }), JSON.stringify({ ...f.credentials, algorithm: 'scrypt' }), JSON.stringify({ ...f.credentials, hash: '0' })]) {
    await writeFile(f.filename, value);
    await assert.rejects(loadAuth(f.filename), /인증 파일/);
  }
});

test('account creation returns no verifiers and rejects privilege fields, invalid permissions and weak passwords', async t => {
  const { auth, credentials } = await fixture(t);
  const user = await auth.accounts.create({ username: 'learner', password: USER_PASSWORD, permissions: ['study'] });
  assert.match(user.id, /^[a-f0-9-]{36}$/); assert.equal(user.isAdmin, false);
  assert.deepEqual(user.permissions, ['study']);
  assert.equal((await auth(request('learner', USER_PASSWORD), response())).id, user.id);
  assert.equal(auth.accounts.current(user, 'study'), true); assert.equal(auth.accounts.current(user, 'chat'), false); assert.equal(auth.accounts.current(user, 'admin'), false);
  const exposed = JSON.stringify([user, auth.accounts.list(), auth.accounts.get(user.id)]);
  for (const forbidden of [USER_PASSWORD, OWNER_PASSWORD, credentials.salt, credentials.hash, 'credentials', 'algorithm']) assert(!exposed.includes(forbidden));
  for (const change of [{ isAdmin: true }, { id: 'owner' }, { permissions: [] }, { permissions: ['admin'] }, { permissions: ['study', 'study'] }, { password: 'short' }, { username: '../bad' }, { enabled: 'true' }]) await assert.rejects(auth.accounts.create({ username: 'new-user', password: USER_PASSWORD, permissions: ['study'], ...change }), { status: 400 });
  await assert.rejects(auth.accounts.create({ username: 'LEARNER', password: USER_PASSWORD, permissions: ['chat'] }), { status: 409 });
});

test('cached credentials are revoked live across instances by reset, permission change and suspension', async t => {
  const f = await fixture(t);
  const user = await f.auth.accounts.create({ username: 'learner', password: USER_PASSWORD, permissions: ['study', 'chat'] });
  const second = await f.open(), third = await f.open();
  for (const auth of [f.auth, second, third]) assert.equal((await auth(request('learner', USER_PASSWORD), response())).id, user.id);
  await f.auth.accounts.update(user.id, { permissions: ['chat'] });
  assert.equal(second.accounts.current(user, 'study'), false);
  const revised = await second(request('learner', USER_PASSWORD), response());
  assert.equal(revised.revision, 2); assert.deepEqual(revised.permissions, ['chat']);
  await f.auth.accounts.update(user.id, { password: 'changed-password-2026' });
  for (const auth of [f.auth, second, third]) {
    assert.equal(await auth(request('learner', USER_PASSWORD), response()), false);
    assert.equal((await auth(request('learner', 'changed-password-2026'), response())).id, user.id);
  }
  await third.accounts.update(user.id, { enabled: false });
  assert.equal(f.auth.accounts.isActive(user.id), false);
  assert.equal(await second(request('learner', 'changed-password-2026'), response()), false);
  await f.auth.accounts.update(user.id, { enabled: true });
  assert.equal((await second(request('learner', 'changed-password-2026'), response())).id, user.id);
});

test('in-flight scrypt must recheck the account revision before admitting a request', async t => {
  const { auth } = await fixture(t);
  const user = await auth.accounts.create({ username: 'in-flight', password: USER_PASSWORD, permissions: ['study'] });
  const req = request('in-flight', USER_PASSWORD), res = response();
  const pending = auth(req, res);
  await auth.accounts.update(user.id, { enabled: false });
  assert.equal(await pending, false); assert.equal(res.status, 401); assert.equal(req.user, undefined);
});

test('owner changes are restricted to setup and username history cannot be reassigned', async t => {
  const f = await fixture(t);
  const user = await f.auth.accounts.create({ username: 'reserved-name', password: USER_PASSWORD, permissions: ['chat'] });
  for (const change of [{ enabled: false }, { permissions: ['study'] }, { password: 'new-admin-password-2026' }]) await assert.rejects(f.auth.accounts.update('owner', change), { status: 403 });
  await assert.rejects(f.auth.accounts.update(user.id, { username: 'new-name' }), { status: 400 });
  await assert.rejects(f.auth.accounts.update(user.id, { isAdmin: true }), { status: 400 });
  const ownerBefore = f.auth.accounts.get('owner');
  const replacement = await createCredentials('new-owner', 'new-owner-password-2026');
  await saveOwnerCredentials(f.filename, replacement);
  const after = f.auth.accounts.get('owner');
  assert.equal(after.id, 'owner'); assert.equal(after.username, 'new-owner'); assert.equal(after.revision, ownerBefore.revision + 1);
  assert.equal(f.auth.accounts.current(ownerBefore), false);
  assert.equal(await f.auth(request('owner-test', OWNER_PASSWORD), response()), false);
  assert.equal((await f.auth(request('new-owner', 'new-owner-password-2026'), response())).id, 'owner');
  await assert.rejects(f.auth.accounts.create({ username: 'OWNER-TEST', password: USER_PASSWORD, permissions: ['study'] }), { status: 409 });
  const fileBefore = await readFile(f.filename, 'utf8');
  await assert.rejects(saveOwnerCredentials(f.filename, await createCredentials('RESERVED-NAME', 'another-password-2026')), { status: 409 });
  assert.equal(await readFile(f.filename, 'utf8'), fileBefore);
  assert.equal(f.auth.accounts.get('owner').username, 'new-owner');
  const reopened = await f.open();
  assert.deepEqual(reopened.accounts.get('owner'), after);
  assert.equal(reopened.accounts.get(user.id).username, 'reserved-name');
});

test('bootstrap credential reset is imported once and preserves all non-owner accounts', async t => {
  const f = await fixture(t);
  const user = await f.auth.accounts.create({ username: 'saved-user', password: USER_PASSWORD, permissions: ['study'], enabled: false });
  const changed = await createCredentials('owner-test', 'owner-new-password-2026');
  await writeFile(f.filename, JSON.stringify(changed));
  const next = await f.open();
  assert.equal(next.accounts.get('owner').revision, 2);
  assert.equal((await f.auth(request('owner-test', 'owner-new-password-2026'), response())).id, 'owner');
  assert.equal(await f.auth(request('owner-test', OWNER_PASSWORD), response()), false);
  const another = await f.open();
  assert.equal(another.accounts.get('owner').revision, 2);
  assert.deepEqual(another.accounts.get(user.id), user);
});

test('account capacity includes owner, suspended accounts still reserve their IDs and names', async t => {
  const { auth } = await fixture(t);
  const first = await auth.accounts.create({ username: 'user-0', password: USER_PASSWORD, permissions: ['study'] });
  for (let i = 1; i < 29; i++) await auth.accounts.create({ username: `user-${i}`, password: USER_PASSWORD, permissions: ['study'] });
  assert.equal(auth.accounts.list().length, 30);
  await auth.accounts.update(first.id, { enabled: false });
  await assert.rejects(auth.accounts.create({ username: 'user-30', password: USER_PASSWORD, permissions: ['chat'] }), { status: 409 });
  await assert.rejects(auth.accounts.create({ username: 'USER-0', password: USER_PASSWORD, permissions: ['chat'] }), { status: 409 });
});
