import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicRepositoryFilter } from '../lib/public-repository-links.mjs';

const data = (repository, link = '', profile = {}) => ({ profile: { githubUrl: 'https://github.com/Example', contactUrl: '', ...profile }, projects: [{ id: 'one', title: '소개 유지', repository, link, published: true }] });
const visible = (filter, url) => filter(data(url)).then(value => value.projects[0].repository);

test('anonymous confirmed public GitHub repositories are shown, with profiles and ordinary links preserved', async () => {
  const calls = [];
  const filter = createPublicRepositoryFilter({ fetchImpl: async (url, options) => {
    calls.push({ url, options }); return Response.json({ private: false, full_name: 'Example/Public' });
  } });
  const input = data('https://github.com/Example/Public', 'https://example.com/play');
  assert.deepEqual(await filter(input), input);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.github.com/repos/Example/Public');
  assert.equal(calls[0].options.headers.Authorization, undefined); assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('private, missing, ambiguous and failed GitHub lookups hide all public link fields without mutating originals', async () => {
  for (const fetchImpl of [
    async () => Response.json({ private: true, full_name: 'Example/Secret' }),
    async () => new Response('', { status: 404 }), async () => new Response('', { status: 403 }),
    async () => new Response('', { status: 500 }), async () => new Response('invalid json'),
    async () => Response.json({ full_name: 'Example/Secret' }),
    async () => Response.json({ private: false, full_name: 'Other/Repo' }),
    async () => { throw new Error('network unavailable'); }
  ]) {
    const filter = createPublicRepositoryFilter({ fetchImpl });
    const url = 'https://github.com/Example/Secret';
    const input = data(url, `${url}/releases`, { githubUrl: url, contactUrl: `${url}/issues` });
    const output = await filter(input);
    assert.equal(output.projects[0].repository, ''); assert.equal(output.projects[0].link, '');
    assert.equal(output.profile.githubUrl, ''); assert.equal(output.profile.contactUrl, '');
    assert.equal(output.projects[0].title, input.projects[0].title);
    assert.equal(input.projects[0].repository, url); assert.equal(input.profile.githubUrl, url);
  }
});

test('case, www alias, git suffix and subpaths share one in-flight lookup and verdict', async () => {
  let count = 0, complete;
  const filter = createPublicRepositoryFilter({ fetchImpl: () => { count++; return new Promise(resolve => { complete = resolve; }); } });
  const urls = ['https://GitHub.com/Example/Public', 'https://www.github.com/example/public.git/', 'https://github.com/EXAMPLE/PUBLIC/releases/latest'];
  const checks = urls.map(url => visible(filter, url));
  assert.equal(count, 1); complete(Response.json({ private: false, full_name: 'example/public' }));
  assert.deepEqual(await Promise.all(checks), urls);
  assert.equal(await visible(filter, urls[1]), urls[1]); assert.equal(count, 1);
});

test('expired public verdicts are never reused on lookup failure and private verdicts are rechecked', async () => {
  let time = 0, mode = 'public', calls = 0;
  const filter = createPublicRepositoryFilter({ now: () => time, fetchImpl: async () => {
    calls++; if (mode === 'failure') throw new Error('offline');
    if (mode === 'missing') return new Response('', { status: 404 });
    return Response.json({ full_name: 'Example/Repo', private: false });
  } });
  const url = 'https://github.com/Example/Repo';
  assert.equal(await visible(filter, url), url);
  time = 599999; mode = 'failure'; assert.equal(await visible(filter, url), url); assert.equal(calls, 1);
  time = 600000; assert.equal(await visible(filter, url), ''); assert.equal(calls, 2);
  time += 30000; mode = 'missing'; assert.equal(await visible(filter, url), ''); assert.equal(calls, 3);
  time += 600000; mode = 'public'; assert.equal(await visible(filter, url), url); assert.equal(calls, 4);
});

test('a hung upstream is aborted and hidden rather than blocking the public page indefinitely', async () => {
  const filter = createPublicRepositoryFilter({ timeoutMs: 20, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    const backup = setTimeout(() => reject(new Error('test guard timeout')), 1000);
    signal.addEventListener('abort', () => { clearTimeout(backup); reject(signal.reason); }, { once: true });
  }) });
  const started = performance.now();
  assert.equal(await visible(filter, 'https://github.com/Example/Slow'), '');
  assert.ok(performance.now() - started < 900);
});

test('invalid GitHub repo paths cannot redirect checks to another host and verdict cache is bounded', async () => {
  let calls = 0;
  const filter = createPublicRepositoryFilter({ fetchImpl: async url => {
    calls++; const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.github.com');
    return Response.json({ private: false, full_name: parsed.pathname.slice(7) });
  } });
  for (const url of ['https://github.com/example/a%2fb', 'https://www.github.com/example/%ZZ']) assert.equal(await visible(filter, url), '');
  assert.equal(calls, 0);
  for (let i = 0; i < 257; i++) await visible(filter, `https://github.com/Example/Repo${i}`);
  await visible(filter, 'https://github.com/Example/Repo0'); assert.equal(calls, 258);
});
