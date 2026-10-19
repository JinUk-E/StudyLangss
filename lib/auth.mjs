import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

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

/** Load a required auth file at startup; absent/corrupt configuration fails closed. */
export async function loadAuth(filename) {
  let config;
  try { config = JSON.parse(await readFile(filename, 'utf8')); }
  catch { throw new Error('인증 파일이 없거나 읽을 수 없습니다. 먼저 npm run setup-auth를 실행하세요.'); }
  if (config?.version !== 1 || config.algorithm !== 'scrypt-N32768-r8-p1' || !/^[A-Za-z0-9_.-]{1,64}$/.test(config.username || '') || !/^[a-f0-9]{64}$/.test(config.salt || '') || !/^[a-f0-9]{128}$/.test(config.hash || '')) throw new Error('인증 파일 형식이 올바르지 않습니다. npm run setup-auth로 다시 설정하세요.');
  const expectedUser = digest(config.username), expectedPassword = Buffer.from(config.hash, 'hex');
  const valid = new Map();
  let activeChecks = 0;
  return async (req, res) => {
    const reject = (status = 401) => {
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
    if ((valid.get(fingerprint) || 0) > Date.now()) return true;
    let credentials;
    try { credentials = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(header.slice(6), 'base64')); }
    catch { return reject(); }
    const colon = credentials.indexOf(':');
    if (colon < 1 || credentials.length > 512) return reject();
    const username = credentials.slice(0, colon), password = credentials.slice(colon + 1);
    if (password.length > 256 || /[\r\n\0]/.test(credentials)) return reject();
    if (activeChecks >= 2) return reject(429);
    activeChecks++;
    try {
      const actual = await derive(password, config.salt, 64, options);
      const userMatches = timingSafeEqual(digest(username), expectedUser);
      if (!timingSafeEqual(actual, expectedPassword) || !userMatches) return reject();
      if (valid.size >= 16) valid.clear();
      valid.set(fingerprint, Date.now() + 60000);
      return true;
    } finally { activeChecks--; }
  };
}
