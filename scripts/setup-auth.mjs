import { createInterface } from 'node:readline/promises';
import { mkdir, rm } from 'node:fs/promises';
import { writeFileSync, renameSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createCredentials, validateCredentials } from '../lib/auth.mjs';
import { accountsFilename, updateOwnerBootstrap } from '../lib/accounts.mjs';
import { promptSecret } from '../lib/secret-prompt.mjs';

export async function saveOwnerCredentials(filename, input) {
  const credentials = validateCredentials(input);
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${randomUUID()}.tmp`;
  try {
    await updateOwnerBootstrap({ filename: accountsFilename(filename), credentials, replaceFile: () => {
      writeFileSync(temp, JSON.stringify(credentials, null, 2), { flag: 'wx', mode: 0o600 });
      chmodSync(temp, 0o600);
      renameSync(temp, filename);
    } });
  } finally { await rm(temp, { force: true }).catch(() => {}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const root = fileURLToPath(new URL('..', import.meta.url));
 const filename = resolve(process.env.AUTH_FILE || resolve(process.env.DATA_DIR || resolve(root, 'data'), 'auth.json'));
 try {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Mac 또는 PC의 대화형 터미널에서 npm run setup-auth를 실행하세요.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let username;
  try { username = (await terminal.question('로그인 아이디 [haru]: ')).trim() || 'haru'; }
  finally { terminal.close(); }
  const password = await promptSecret('새 비밀번호 (12자 이상, 화면에 표시되지 않음): ');
  const confirmation = await promptSecret('비밀번호 확인: ');
  if (password !== confirmation) throw new Error('비밀번호가 일치하지 않습니다.');
  const credentials = await createCredentials(username, password);
  await saveOwnerCredentials(filename, credentials);
  console.log(`인증 설정 저장: ${filename}\n실행 중인 앱을 재시작하세요. 기존 학습 기록은 유지됩니다.`);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
 }
}
