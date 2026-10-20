import { resolve } from 'node:path';
import { runWorker } from '../lib/update-worker.mjs';

const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());
try { await runWorker(resolve(process.argv[2] || '.site-updater'), { signal: controller.signal }); }
catch (error) { console.error(`업데이트 worker 시작 실패: ${error.message}`); process.exitCode = 1; }
