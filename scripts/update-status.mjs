import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createSiteUpdater } from '../lib/site-update.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
console.log(JSON.stringify(await createSiteUpdater(root).status(), null, 2));
console.log(`로컬 기록/백업: ${resolve(root, '.site-updater')}`);
try { console.log('마지막 로컬 진단:', (await readFile(resolve(root, '.site-updater/worker.stderr.log'), 'utf8')).slice(-6000)); } catch { /* no log */ }
