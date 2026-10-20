import { lstat, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { resolve, join, isAbsolute, sep, dirname } from 'node:path';

export function defaultDataPaths(root) {
  return {
    DATA_DIR: resolve(root, 'data'), CHAT_DATA_DIR: resolve(root, 'data/chat'),
    PORTFOLIO_DATA_DIR: resolve(root, 'data/portfolio'), AUTH_FILE: resolve(root, 'data/auth.json'),
    AUTH_USERS_FILE: resolve(root, 'data/accounts.sqlite'), PUSH_DATA_DIR: resolve(root, 'data/push'),
    PUSH_CONFIG_FILE: resolve(root, 'data/push/vapid.json')
  };
}
export function validateRuntimeLayout(root, env) {
  for (const [key, expected] of Object.entries(defaultDataPaths(root))) {
    if (env[key] && resolve(root, env[key]) !== expected) throw new Error(`사이트 업데이트는 기본 data 경로 설치만 지원합니다: ${key}`);
  }
}
export async function assertSafeDataTree(path, base = resolve(path)) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink()) {
    const link = await readlink(path), target = await realpath(path);
    if (resolve(path) === base || isAbsolute(link) || !resolve(dirname(path), link).startsWith(base + sep) || !target.startsWith(base + sep) || !(await stat(target)).isFile()) throw new Error('데이터 폴더 안의 상대 파일 링크만 지원합니다. 외부/폴더 링크는 사용할 수 없습니다.');
    return;
  }
  if (info.isDirectory()) for (const name of await readdir(path)) await assertSafeDataTree(join(path, name), base);
  else if (!info.isFile()) throw new Error('데이터 경로에 일반 파일이 아닌 항목이 있습니다.');
}
