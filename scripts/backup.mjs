import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promptSecret } from '../lib/secret-prompt.mjs';

const base = process.env.APP_URL || 'http://127.0.0.1:3210';
const directory = resolve(process.env.BACKUP_DIR || 'backups');
try {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('로그인을 위해 대화형 터미널에서 npm run backup을 실행하세요.');
  const destination = new URL('/api/backup', base);
  if (destination.protocol !== 'https:' && !(destination.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname))) throw new Error('원격 백업은 HTTPS 주소를 사용하세요.');
  if (destination.username || destination.password) throw new Error('주소에 인증 정보를 넣지 마세요.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let username;
  try { username = (await terminal.question('로그인 아이디 [haru]: ')).trim() || 'haru'; }
  finally { terminal.close(); }
  const password = await promptSecret('비밀번호 (화면에 표시되지 않음): ');
  const language = process.env.STUDY_LANGUAGE || 'ja';
  if (!['ja', 'en'].includes(language)) throw new Error('STUDY_LANGUAGE은 ja 또는 en이어야 합니다.');
  destination.searchParams.set('language', language);
  const response = await fetch(destination, { headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`백업 요청 실패: HTTP ${response.status}`);
  const backup = await response.json();
  if (![1, 2].includes(backup.schemaVersion) || !Array.isArray(backup.questions)) throw new Error('백업 형식을 확인할 수 없습니다.');
  await mkdir(directory, { recursive: true });
  const filename = resolve(directory, `haru-${language}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(filename, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(`백업 저장: ${filename}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
