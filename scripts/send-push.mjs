import { fileURLToPath } from 'node:url';
import { createPushService } from '../lib/push-service.mjs';
import { pushPaths } from '../lib/push-paths.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let service;
try {
  const args = process.argv.slice(2);
  let id, all = false;
  if (args.length === 1 && args[0] === '--all') all = true;
  else if (args.length === 2 && args[0] === '--id' && /^[a-f0-9-]{36}$/.test(args[1])) id = args[1];
  else throw new Error('usage');
  service = await createPushService(pushPaths(root));
  if (!service.info().configured) throw new Error('config');
  const result = await service.send({ id, all });
  console.log(JSON.stringify({ results: result, note: 'accepted는 푸시 서비스 접수이며 실제 기기 수신 확인이 아닙니다.' }, null, 2));
  if (result.some(item => item.status !== 'accepted')) process.exitCode = 1;
} catch (error) {
  console.error(error.message === 'usage' ? '사용법: npm run send-push -- --id 기기ID 또는 npm run send-push -- --all' : '푸시를 발송하지 못했습니다. 설정과 기기 목록을 확인하세요.');
  process.exitCode = 1;
} finally { service?.close(); }
