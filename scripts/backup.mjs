import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.APP_URL || 'http://127.0.0.1:3210';
const directory = resolve(process.env.BACKUP_DIR || 'backups');
try {
  const response = await fetch(`${base}/api/backup`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`백업 요청 실패: HTTP ${response.status}`);
  const backup = await response.json();
  if (backup.schemaVersion !== 1 || !Array.isArray(backup.questions)) throw new Error('백업 형식을 확인할 수 없습니다.');
  await mkdir(directory, { recursive: true });
  const filename = resolve(directory, `haru-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(filename, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(`백업 저장: ${filename}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
