import { mkdir, writeFile, rename, chmod, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { promptSecret } from '../lib/secret-prompt.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const filename = resolve(root, 'data/duckdns-token');
let temp;
try {
  const token = (await promptSecret('DuckDNS token (화면에 표시되지 않음): ')).trim();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error('DuckDNS 계정 화면의 token 값을 입력하세요.');
  }
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  temp = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temp, `${token}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temp, filename);
  temp = undefined;
  await chmod(filename, 0o600);
  console.log('DuckDNS token 저장 완료 (Git 제외, 소유자만 읽기/쓰기).');
} catch (error) {
  if (temp) await rm(temp, { force: true }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
}
