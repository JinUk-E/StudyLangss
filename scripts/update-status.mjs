import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createSiteUpdater } from '../lib/site-update.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
console.log(JSON.stringify(await createSiteUpdater(root).status(), null, 2));
console.log(`로컬 기록/백업: ${resolve(root, '.site-updater')}`);
for (const name of ['worker-errors.log', 'worker.stderr.log']) {
  try { console.log(`마지막 로컬 진단 (${name}):`, (await readFile(resolve(root, '.site-updater', name), 'utf8')).slice(-12000)); } catch { /* no log */ }
}
