import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeHealth } from '../lib/runtime-health.mjs';

test('health requires loopback+secret and retains startup SHA after checkout changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'starlight-health-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']); git(['config', 'user.name', 'Health Test']); git(['config', 'user.email', 'health@example.invalid']); git(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(root, 'code.txt'), 'one'); git(['add', 'code.txt']); git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'one']);
  const sha = git(['rev-parse', 'HEAD']), token = 'a'.repeat(64);
  await mkdir(join(root, '.site-updater'));
  await writeFile(join(root, '.site-updater/config.json'), JSON.stringify({ version: 1, root, token, branch: 'starlightForge', remote: 'https://github.com/JinUk-E/StudyLangss.git', origin: 'https://starlightforge.duckdns.org' }));
  const handler = await createRuntimeHealth(root, 'portfolio');
  await writeFile(join(root, 'code.txt'), 'two'); git(['add', 'code.txt']); git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'two']);
  const call = (address, secret, url = '/internal/update-health') => { const res = { writeHead(status) { this.status = status; }, end(text) { this.value = JSON.parse(text); } }; const handled = handler({ url, method: 'GET', socket: { remoteAddress: address }, headers: { 'x-starlight-update-token': secret } }, res); return { ...res, handled }; };
  assert.equal(call('127.0.0.1', undefined).status, 404);
  assert.equal(call('127.0.0.1', 'b'.repeat(64)).status, 404);
  assert.equal(call('10.0.0.1', token).status, 404);
  assert.equal(call('127.0.0.1', token, '/else').handled, false);
  const response = call('127.0.0.1', token);
  assert.equal(response.status, 200); assert.deepEqual(response.value, { service: 'portfolio', startupSha: sha }); assert.notEqual(sha, git(['rev-parse', 'HEAD']));
});
