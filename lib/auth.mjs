import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { accountsFilename, createAccountManager } from './accounts.mjs';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const digest = value => createHash('sha256').update(value).digest();

/** Create a salted verifier, never a recoverable password. Used by local setup. */
export async function createCredentials(username, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(username)) throw new Error('아이디는 영문·숫자·._-로 1~64자입니다.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 256 || /[\r\n\0]/.test(password)) throw new Error('비밀번호는 줄바꿈 없이 12~256자로 입력하세요.');
  const salt = randomBytes(32).toString('hex');
  const hash = (await derive(password, salt, 64, options)).toString('hex');
  return { version: 1, username, algorithm: 'scrypt-N32768-r8-p1', salt, hash };
}

export function validateCredentials(config) {
  if (config?.version !== 1 || config.algorithm !== 'scrypt-N32768-r8-p1' || typeof config.username !== 'string' || typeof config.salt !== 'string' || typeof config.hash !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(config.username) || !/^[a-f0-9]{64}$/.test(config.salt) || !/^[a-f0-9]{128}$/.test(config.hash)) throw new Error('인증 파일 형식이 올바르지 않습니다. npm run setup-auth로 다시 설정하세요.');
  return { version: 1, username: config.username, algorithm: config.algorithm, salt: config.salt, hash: config.hash };
}

/** Required v1 bootstrap is read inside the shared account DB startup lock. */
export async function loadAuth(filename) {
  const readBootstrap = () => {
    let config;
    try { config = JSON.parse(readFileSync(filename, 'utf8')); }
    catch { throw new Error('인증 파일이 없거나 읽을 수 없습니다. 먼저 npm run setup-auth를 실행하세요.'); }
    return validateCredentials(config);
  };
  readBootstrap();
  const manager = await createAccountManager({ filename: accountsFilename(filename), readBootstrap, makeCredentials: createCredentials });
  const accounts = manager.accounts;
  const valid = new Map();
  let activeChecks = 0;
  const authenticate = async (req, res, { optional = false } = {}) => {
    delete req.user;
    const reject = (status = 401) => {
      if (optional) return null;
      res.setHeader('Cache-Control', 'no-store');
      if (status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="HARU", charset="UTF-8"');
      else res.setHeader('Retry-After', '2');
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 401 ? '아이디와 비밀번호로 로그인해 주세요.' : '로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.' }));
      return false;
    };
    const header = req.headers.authorization;
    if (typeof header !== 'string' || header.length > 2048 || !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(header)) return reject();
    const fingerprint = digest(header).toString('hex');
    let credentials;
    try { credentials = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(header.slice(6), 'base64')); }
    catch { return reject(); }
    const colon = credentials.indexOf(':');
    if (colon < 1 || credentials.length > 512) return reject();
    const username = credentials.slice(0, colon), password = credentials.slice(colon + 1);
    if (password.length > 256 || /[\r\n\0]/.test(credentials)) return reject();
    const account = manager.verifier(username);
    const cached = valid.get(fingerprint);
    if (account && cached && cached.expires > Date.now() && cached.id === account.principal.id && cached.revision === account.principal.revision && accounts.current(account.principal)) {
      req.user = account.principal;
      return req.user;
    }
    if (activeChecks >= 2) return reject(429);
    activeChecks++;
    try {
      const config = account ? validateCredentials(account.credentials) : manager.bootstrap;
      const actual = await derive(password, config.salt, 64, options);
      const userMatches = timingSafeEqual(digest(username.toLowerCase()), digest(config.username.toLowerCase()));
      if (!timingSafeEqual(actual, Buffer.from(config.hash, 'hex')) || !userMatches || !account || !accounts.current(account.principal)) return reject();
      if (valid.size >= 128) valid.clear();
      valid.set(fingerprint, { expires: Date.now() + 60000, id: account.principal.id, revision: account.principal.revision });
      req.user = account.principal;
      return req.user;
    } finally { activeChecks--; }
  };
  authenticate.accounts = accounts;
  return authenticate;
}
