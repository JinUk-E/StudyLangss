import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, readlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runCommand, inspectCheckout, checkForUpdate, performUpdate, runWorker } from '../lib/update-worker.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const remote = 'https://github.com/JinUk-E/StudyLangss.git';
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'stella-updater-')));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const git = async args => { const result = await runCommand('git', args, { cwd: root, env: process.env, allowFailure: true }); assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`); return result.stdout.trim(); };
  await git(['init', '-b', 'starlightForge']);
  await git(['config', 'user.name', 'Updater fixture']); await git(['config', 'user.email', 'fixture@example.invalid']);
  await git(['remote', 'add', 'origin', remote]);
  await mkdir(join(root, 'tests'));
  await writeFile(join(root, '.gitignore'), 'data/\n.site-updater/\nnode_modules/\n');
  await writeFile(join(root, 'tests', 'fixture.test.mjs'), '// fixture\n');
  await writeFile(join(root, 'version'), 'old');
  await git(['add', '.']); await git(['commit', '-m', 'original']);
  const original = await git(['rev-parse', 'HEAD']);
  await writeFile(join(root, 'version'), 'new'); await git(['add', '.']); await git(['commit', '-m', 'candidate']);
  const target = await git(['rev-parse', 'HEAD']);
  await git(['checkout', '-B', 'starlightForge', original]);
  const directory = join(root, '.site-updater');
  await mkdir(directory); await mkdir(join(root, 'data')); await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'data', 'private.txt'), 'actual private content');
  await writeFile(join(root, 'node_modules', 'old'), 'previous dependencies');
  const services = [];
  for (const [service, label, script, port] of [
    ['portfolio', 'org.starlightforge.portfolio', 'portfolio-server.mjs', 3212],
    ['chat', 'org.starlightforge.chat', 'chat-server.mjs', 3211], ['study', 'kr.haru.jlpt', 'server.mjs', 3210]]) {
    const plist = join(directory, `${service}.plist`); const bytes = Buffer.from(`fixture ${service}`);
    await writeFile(plist, bytes); services.push({ service, label, script, port, plist, plistHash: hash(bytes) });
  }
  const config = { version: 1, root, origin: 'https://starlightforge.duckdns.org', branch: 'starlightForge', remote,
    nodePath: process.execPath, npmCli: resolve(root, 'npm-cli.js'), token: 'a'.repeat(64), services };
  await writeFile(join(directory, 'config.json'), JSON.stringify(config));
  let failTests = false, failBootout = false, failStartHealth = false, fetchedTarget = target;
  const calls = [];
  const options = {
    sleep: async () => {}, portOpen: async () => false, pidAlive: async () => false,
    health: async (service, candidate, sha) => !(failStartHealth && sha === target),
    command: async (file, args, extra) => {
      calls.push({ file, args, extra });
      if (file === 'git' || file === '/usr/bin/git') {
        if (args.includes('fetch')) { await git(['update-ref', 'refs/remotes/origin/starlightForge', fetchedTarget]); return { stdout: '', stderr: '', code: 0 }; }
        return runCommand(file, args, { ...extra, env: { ...extra.env, PATH: process.env.PATH } });
      }
      if (file === '/bin/launchctl') {
        if (args[0] === 'print') return { stdout: `\tpid = ${200001 + services.findIndex(service => args[1].endsWith(`/${service.label}`))}\n`, stderr: '', code: 0 };
        if (failBootout && args[0] === 'bootout') throw Error('fixture bootout failure');
        return { stdout: '', stderr: '', code: 0 };
      }
      assert.equal(file, process.execPath);
      if (args[0] === config.npmCli) {
        assert.deepEqual(args.slice(1), ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
        assert.equal(extra.env.AUTH_FILE, undefined); assert.equal(extra.env.DATA_DIR, undefined);
        assert.equal(extra.env.PUSH_CONFIG_FILE, undefined); assert.equal(extra.env.AUTH_USERS_FILE, undefined);
        await mkdir(join(extra.cwd, 'node_modules')); await writeFile(join(extra.cwd, 'node_modules', 'new'), 'validated dependencies');
      } else {
        assert.equal(args[0], '--test');
        if (failTests) throw Error('fixture test failure');
      }
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  const ready = async () => {
    const status = await checkForUpdate(config, options);
    await writeFile(join(directory, 'status.json'), JSON.stringify(status)); return status;
  };
  const apply = async () => {
    const state = await ready(); const states = [];
    const request = { id: randomUUID(), action: 'apply', requestedAt: new Date().toISOString(),
      expectedHead: state.current.sha, targetSha: state.target.sha, checkToken: state.checkToken };
    const save = async value => { states.push(value); await writeFile(join(directory, 'status.json'), JSON.stringify(value)); };
    return { request, states, save, execute: () => performUpdate(config, request, save, options) };
  };
  return { root, directory, config, original, target, git, options, calls, ready, apply,
    failTests: () => failTests = true, failBootout: () => failBootout = true,
    failStartHealth: () => failStartHealth = true, targetAfterFetch: sha => fetchedTarget = sha };
}

test('command execution is bounded and reports failure without shell interpolation', async () => {
  const literal = '$(echo secret); & echo unsafe';
  assert.equal((await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal])).stdout, literal);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)']), /명령 실행 실패/);
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 25 }), /제한 시간/);
});

test('inspection rejects dirty checkout and changed remote', async t => {
  const f = await fixture(t);
  assert.equal((await inspectCheckout(f.config, f.options)).sha, f.original);
  await writeFile(join(f.root, 'version'), 'local edit');
  await assert.rejects(inspectCheckout(f.config, f.options), /로컬 변경/);
  await f.git(['checkout', '--', 'version']); await f.git(['remote', 'set-url', 'origin', 'https://example.invalid/repo']);
  await assert.rejects(inspectCheckout(f.config, f.options), /원격 저장소/);
});

test('successful update verifies backup, preserves old dependencies, applies exact version and restarts all services', async t => {
  const f = await fixture(t); const job = await f.apply();
  assert.match(job.request.checkToken, /^[a-f0-9]{32}$/);
  await job.execute();
  assert.equal(job.states.at(-1).phase, 'succeeded');
  assert.equal(await f.git(['rev-parse', 'HEAD']), f.target);
  assert.equal(await readFile(join(f.root, 'data', 'private.txt'), 'utf8'), 'actual private content');
  assert.equal(await readFile(join(f.directory, 'backups', job.request.id, 'data', 'private.txt'), 'utf8'), 'actual private content');
  assert.equal(await readFile(join(f.directory, 'previous-modules', job.request.id, 'old'), 'utf8'), 'previous dependencies');
  assert.equal(await readFile(join(f.root, 'node_modules', 'new'), 'utf8'), 'validated dependencies');
  assert.equal(f.calls.filter(x => x.file === '/bin/launchctl' && x.args[0] === 'bootstrap').length, 3);
  assert.deepEqual(await readdir(join(f.directory, 'stage')), []);
});

test('failed isolated verification never stops live services or changes checkout', async t => {
  const f = await fixture(t); const job = await f.apply(); f.failTests(); await job.execute();
  assert.equal(job.states.at(-1).phase, 'failed'); assert.equal(await f.git(['rev-parse', 'HEAD']), f.original);
  assert.equal(f.calls.some(x => x.file === '/bin/launchctl'), false);
  assert.equal(await readFile(join(f.root, 'node_modules', 'old'), 'utf8'), 'previous dependencies');
});

test('changed remote version after approval is rejected before service shutdown', async t => {
  const f = await fixture(t); const job = await f.apply(); f.targetAfterFetch(f.original); await job.execute();
  assert.equal(job.states.at(-1).phase, 'failed'); assert.equal(f.calls.some(x => x.file === '/bin/launchctl'), false);
});

test('partial shutdown failure leaves manual recovery state and attempts to stop every service', async t => {
  const f = await fixture(t); const job = await f.apply(); f.failBootout(); await job.execute();
  assert.equal(job.states.at(-1).phase, 'manual');
  assert.equal(f.calls.filter(x => x.file === '/bin/launchctl' && x.args[0] === 'bootout').length, 6);
  assert.equal(await f.git(['rev-parse', 'HEAD']), f.original);
});

test('wrong startup SHA prevents success, stops newly launched services, preserves recovery snapshot', async t => {
  const f = await fixture(t); const job = await f.apply(); f.failStartHealth(); await job.execute();
  assert.equal(job.states.at(-1).phase, 'manual');
  assert.equal(f.calls.filter(x => x.file === '/bin/launchctl' && x.args[0] === 'bootout').length, 6);
  assert.equal(await readFile(join(f.directory, 'backups', job.request.id, 'data', 'private.txt'), 'utf8'), 'actual private content');
});

test('expired approval and mismatched token do not execute commands', async t => {
  const f = await fixture(t); const job = await f.apply(); f.calls.length = 0;
  await assert.rejects(performUpdate(f.config, { ...job.request, checkToken: '0'.repeat(32) }, job.save, f.options), /만료/);
  await assert.rejects(performUpdate(f.config, job.request, job.save, { ...f.options, now: () => Date.now() + 700000 }), /만료/);
  assert.equal(f.calls.length, 0);
});

test('changed plist and symlinked data are rejected before stopping services', async t => {
  const f = await fixture(t); const job = await f.apply();
  await writeFile(f.config.services[0].plist, 'edited service configuration'); await job.execute();
  assert.equal(job.states.at(-1).phase, 'failed'); assert.equal(f.calls.some(x => x.file === '/bin/launchctl'), false);
  const original = 'fixture portfolio'; await writeFile(f.config.services[0].plist, original);
  await mkdir(join(f.directory, 'external')); await symlink(join(f.directory, 'external'), join(f.root, 'data', 'linked'), 'junction');
  const second = await f.apply(); await second.execute();
  assert.equal(second.states.at(-1).phase, 'failed'); assert.equal(f.calls.some(x => x.file === '/bin/launchctl'), false);
});

test('restarted worker marks an interrupted request manual and never executes it', async t => {
  const f = await fixture(t); await f.ready();
  await mkdir(join(f.directory, 'pending'));
  await writeFile(join(f.directory, 'pending', 'request.json'), JSON.stringify({ id: randomUUID(), action: 'apply' }));
  const controller = new AbortController(); controller.abort(); f.calls.length = 0;
  await runWorker(f.directory, { ...f.options, signal: controller.signal });
  assert.equal(JSON.parse(await readFile(join(f.directory, 'status.json'))).phase, 'manual'); assert.equal(f.calls.length, 0);
  await assert.rejects(readFile(join(f.directory, 'worker.lock', 'pid')), { code: 'ENOENT' });
});

test('a second worker cannot take the lock of a live process', async t => {
  const f = await fixture(t);
  await mkdir(join(f.directory, 'worker.lock')); await writeFile(join(f.directory, 'worker.lock', 'pid'), String(process.pid));
  await assert.rejects(runWorker(f.directory, f.options), /이미 실행 중/);
  assert.equal(await readFile(join(f.directory, 'worker.lock', 'pid'), 'utf8'), String(process.pid));
});

test('a candidate tracking local runtime data cannot be offered for deployment', async t => {
  const f = await fixture(t);
  await f.git(['checkout', '-B', 'candidate-fixture', f.target]);
  await writeFile(join(f.root, 'data', 'forbidden.txt'), 'tracked local runtime');
  await f.git(['add', '-f', 'data/forbidden.txt']); await f.git(['commit', '-m', 'forbidden candidate']);
  const candidate = await f.git(['rev-parse', 'HEAD']); await f.git(['checkout', 'starlightForge']);
  f.targetAfterFetch(candidate);
  await assert.rejects(checkForUpdate(f.config, f.options), /보호된 로컬 경로/);
  assert.equal(await f.git(['rev-parse', 'HEAD']), f.original);
});

test('Certbot style relative file links remain relative and resolve inside the verified backup', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'data', 'archive')); await mkdir(join(f.root, 'data', 'live'));
  await writeFile(join(f.root, 'data', 'archive', 'cert1.pem'), 'fixture certificate');
  try { await symlink('../archive/cert1.pem', join(f.root, 'data', 'live', 'cert.pem'), 'file'); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows file symlink privilege unavailable; run this check on macOS'); return; } throw error; }
  const job = await f.apply(); await job.execute(); assert.equal(job.states.at(-1).phase, 'succeeded');
  const backedLink = join(f.directory, 'backups', job.request.id, 'data', 'live', 'cert.pem');
  assert.equal(await readlink(backedLink), '../archive/cert1.pem'); assert.equal(await readFile(backedLink, 'utf8'), 'fixture certificate');
});

test('existing services with an unexpected running version prevent any shutdown', async t => {
  const f = await fixture(t); const job = await f.apply(); f.options.health = async () => false;
  await job.execute(); assert.equal(job.states.at(-1).phase, 'failed');
  assert.equal(f.calls.some(x => x.file === '/bin/launchctl'), false);
});

test('ports that remain occupied after bootout prevent code or dependency replacement', async t => {
  const f = await fixture(t); const job = await f.apply(); f.options.portOpen = async () => true;
  await job.execute(); assert.equal(job.states.at(-1).phase, 'manual');
  assert.equal(await f.git(['rev-parse', 'HEAD']), f.original);
  assert.equal(await readFile(join(f.root, 'node_modules', 'old'), 'utf8'), 'previous dependencies');
});

test('closed ports alone do not allow backup while the original service PID is still alive', async t => {
  const f = await fixture(t); const job = await f.apply(); f.options.pidAlive = async () => true;
  await job.execute(); assert.equal(job.states.at(-1).phase, 'manual');
  assert.equal(await f.git(['rev-parse', 'HEAD']), f.original);
  assert.equal(job.states.some(value => value.phase === 'backing-up'), false);
  assert.equal(await readFile(join(f.root, 'node_modules', 'old'), 'utf8'), 'previous dependencies');
});
