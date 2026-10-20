import { execFileSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { readUpdateConfig } from './site-update.mjs';
import { validateRuntimeLayout } from './update-layout.mjs';

/** Capture revision once: an old process must never report a new checkout's HEAD. */
export async function createRuntimeHealth(root, service) {
  const config = await readUpdateConfig(root, resolve(root, '.site-updater'));
  let startupSha = null;
  if (config) {
    validateRuntimeLayout(root, process.env);
    try {
      const value = execFileSync(process.platform === 'darwin' ? '/usr/bin/git' : 'git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
      if (/^[a-f0-9]{40}$/.test(value)) startupSha = value;
    } catch { /* remain unavailable */ }
  }
  return (req, res) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/internal/update-health') return false;
    const address = req.socket.remoteAddress;
    const token = req.headers['x-starlight-update-token'];
    const allowed = req.method === 'GET' && startupSha && config && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(config.token));
    res.writeHead(allowed ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(allowed ? { service, startupSha } : { error: '페이지를 찾을 수 없습니다.' }));
    return true;
  };
}
