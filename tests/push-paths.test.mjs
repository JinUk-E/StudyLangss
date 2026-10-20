import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushPaths } from '../lib/push-paths.mjs';
import { createPushService } from '../lib/push-service.mjs';

const run = promisify(execFile), root = fileURLToPath(new URL('..', import.meta.url));
test('custom portfolio data location is shared by setup CLI, server service and delivery CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stella-push-path-'));
  let service;
  try {
    const env = { ...process.env, PORTFOLIO_DATA_DIR: directory };
    delete env.PUSH_DATA_DIR; delete env.PUSH_CONFIG_FILE;
    const paths = pushPaths(root, env);
    assert.equal(paths.directory, join(directory, 'push'));
    await run(process.execPath, ['scripts/setup-push.mjs', '--origin', 'https://starlightforge.duckdns.org', '--contact', 'https://starlightforge.duckdns.org'], { cwd: root, env, timeout: 10000 });
    const original = await readFile(paths.configFile, 'utf8');
    service = await createPushService(paths); assert.equal(service.info().configured, true); service.close(); service = null;
    const sent = await run(process.execPath, ['scripts/send-push.mjs', '--all'], { cwd: root, env, timeout: 10000 });
    assert.deepEqual(JSON.parse(sent.stdout).results, []); // No registered devices, no network requests.
    await assert.rejects(run(process.execPath, ['scripts/setup-push.mjs', '--origin', 'https://starlightforge.duckdns.org', '--contact', 'https://starlightforge.duckdns.org'], { cwd: root, env, timeout: 10000 }));
    assert.equal(await readFile(paths.configFile, 'utf8'), original);
    const explicit = pushPaths(root, { PORTFOLIO_DATA_DIR: directory, PUSH_DATA_DIR: join(directory, 'explicit'), PUSH_CONFIG_FILE: join(directory, 'own.json') });
    assert.equal(explicit.directory, join(directory, 'explicit')); assert.equal(explicit.configFile, join(directory, 'own.json'));
  } finally {
    service?.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
