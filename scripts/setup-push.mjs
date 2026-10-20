import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { validatePushConfig } from '../lib/push-service.mjs';
import { pushPaths } from '../lib/push-paths.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function setupPushConfig({ filename, origin, subject }) {
  const keys = webpush.generateVAPIDKeys();
  const config = validatePushConfig({ version: 1, origin, subject, ...keys });
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  await chmod(dirname(filename), 0o700);
  await writeFile(filename, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await chmod(filename, 0o600);
  return { configured: true, origin: config.origin };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const values = {};
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      if (!['--origin', '--contact', '--file'].includes(key) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--') || values[key]) throw new Error('사용법: npm run setup-push -- --origin https://도메인 --contact mailto:이메일 [--file 경로]');
      values[key] = process.argv[++i];
    }
    const filename = resolve(values['--file'] || pushPaths(root).configFile);
    const result = await setupPushConfig({ filename, origin: values['--origin'], subject: values['--contact'] });
    console.log(`푸시 설정을 저장했습니다. 원본 주소: ${result.origin}\n포트폴리오 서버를 재시작하세요. 기존 기기를 다시 등록해야 하는 키 변경은 하지 않았습니다.`);
  } catch (error) {
    console.error(error.code === 'EEXIST' ? '기존 푸시 설정이 있어 덮어쓰지 않았습니다. 키를 유지한 채 서버를 재시작하세요.' : error.status === 400 ? error.message : '푸시 설정을 저장할 수 없습니다. 주소·연락처·파일 경로와 권한을 확인하세요.');
    process.exitCode = 1;
  }
}
