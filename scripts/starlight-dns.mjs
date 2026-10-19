// DuckDNS IP updates and Certbot DNS-01 hooks for this site's hostname only.
import { readFile, stat } from 'node:fs/promises';
import { Resolver } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';

const domain = 'starlightforge.duckdns.org';
const tokenFile = new URL('../data/duckdns-token', import.meta.url);

async function update(parameters) {
  const metadata = await stat(tokenFile);
  if (metadata.mode & 0o077) throw new Error('Token file must be owner-only (chmod 600).');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error('Run node scripts/setup-duckdns.mjs first.');
  }
  const url = new URL('https://www.duckdns.org/update');
  url.search = new URLSearchParams({ domains: 'starlightforge', token, ...parameters });
  // Never print the URL, token, or network exception (which may contain the URL).
  let response;
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || (await response.text()).trim() !== 'OK') throw new Error();
  } catch { throw new Error('DuckDNS update failed; check connectivity and the saved token.'); }
}

async function waitForTxt(value) {
  const resolvers = ['1.1.1.1', '8.8.8.8'].map(server => {
    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers([server]);
    return resolver;
  });
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const matches = await Promise.all(resolvers.map(async resolver => {
      try {
        const records = await resolver.resolveTxt(`_acme-challenge.${domain}`);
        return records.some(parts => parts.join('') === value);
      } catch { return false; }
    }));
    if (matches.every(Boolean)) return;
    await delay(10000);
  }
  throw new Error('DNS challenge did not propagate within four minutes.');
}

try {
  const action = process.argv[2];
  if (!['update', 'auth', 'cleanup'].includes(action)) {
    throw new Error('Usage: node scripts/starlight-dns.mjs update|auth|cleanup');
  }
  if (action === 'update') {
    await update({ ip: '' });
  } else {
    const identifier = process.env.CERTBOT_IDENTIFIER || process.env.CERTBOT_DOMAIN;
    if (identifier !== domain) throw new Error('Unexpected Certbot domain; refusing DNS changes.');
    const value = process.env.CERTBOT_VALIDATION;
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Missing DNS challenge value.');
    if (action === 'auth') {
      await update({ txt: value });
      await waitForTxt(value);
    } else {
      // clear=true with txt clears only the TXT record, not the IP address.
      await update({ txt: value, clear: 'true' });
    }
  }
  console.log(`DuckDNS ${action}: OK`);
} catch (error) {
  // Filesystem errors reveal paths only; API/network errors are sanitized above.
  console.error(error.message);
  process.exitCode = 1;
}
