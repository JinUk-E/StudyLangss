import { lookup as systemLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import webpush from 'web-push';

const fault = (code, status = 400) => Object.assign(new Error('푸시 요청을 처리할 수 없습니다.'), { code, status });
export function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 4096) throw fault('PUSH_ENDPOINT');
  let url; try { url = new URL(value); } catch { throw fault('PUSH_ENDPOINT'); }
  const host = url.hostname;
  const approved = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
    || host === 'web.push.apple.com' || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+push\.apple\.com$/.test(host);
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (url.protocol !== 'https:' || !authority || authority.includes('@') || (url.port && url.port !== '443') || url.username || url.password || value.includes('#') || isIP(host) || !approved || url.pathname === '/') throw fault('PUSH_ENDPOINT');
  return url.href;
}

// Only globally routable addresses are eligible. Transition and mapped IPv6
// addresses are deliberately excluded instead of interpreting embedded IPv4.
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes('.') || address.includes('%')) return false;
  const parts = address.toLowerCase().split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const words = (parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left).map(x => parseInt(x, 16));
  const [a, b] = words;
  return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && a !== 0x3fff
    && !(a === 0x2001 && (b <= 0x01ff || b === 0x0db8))
    && !((words[4] === 0 || words[4] === 0x0200) && words[5] === 0x5efe);
}

export async function resolvePinnedEndpoint(endpoint, lookup = systemLookup) {
  const url = new URL(validateEndpoint(endpoint));
  const results = await lookup(url.hostname, { all: true, verbatim: true });
  if (!Array.isArray(results) || !results.length || results.some(entry => !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family)) throw fault('PUSH_DNS_BLOCKED');
  return { url, address: results[0].address, family: results[0].family };
}

export function createPushTransport({ lookup = systemLookup, request = httpsRequest, timeoutMs = 10_000 } = {}) {
  return async function sendPush({ subscription, payload, config, canSend = () => true }) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let abortLookup;
    try {
      const aborted = new Promise((_, reject) => {
        abortLookup = () => reject(fault('PUSH_TIMEOUT', 504));
        controller.signal.addEventListener('abort', abortLookup, { once: true });
      });
      const pinned = await Promise.race([resolvePinnedEndpoint(subscription.endpoint, lookup), aborted]);
      controller.signal.removeEventListener('abort', abortLookup);
      if (controller.signal.aborted) throw fault('PUSH_TIMEOUT', 504);
      const details = webpush.generateRequestDetails(subscription, JSON.stringify(payload), {
        TTL: 300, urgency: 'normal', contentEncoding: 'aes128gcm',
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }
      });
      if (details.body.length > 8192 || new URL(details.endpoint).href !== pinned.url.href) throw fault('PUSH_REQUEST');
      if (!canSend()) throw fault('PUSH_ACCOUNT_INACTIVE', 403);
      return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, result) => { if (!settled) { settled = true; error ? reject(error) : resolve(result); } };
        const req = request(pinned.url, {
          method: 'POST', headers: details.headers, agent: false, signal: controller.signal,
          servername: pinned.url.hostname, family: pinned.family,
          lookup: (hostname, options, callback) => {
            if (hostname !== pinned.url.hostname) return callback(fault('PUSH_DNS_BLOCKED'));
            if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
            else callback(null, pinned.address, pinned.family);
          }
        }, response => {
          let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > 8192) { response.destroy(); req.destroy(); finish(fault('PUSH_RESPONSE_SIZE')); }
          });
          response.on('error', () => finish(fault('PUSH_RESPONSE')));
          response.on('aborted', () => finish(fault('PUSH_RESPONSE')));
          response.on('end', () => finish(null, { statusCode: response.statusCode }));
        });
        req.on('error', () => finish(fault(timedOut ? 'PUSH_TIMEOUT' : 'PUSH_NETWORK', 502)));
        req.end(details.body);
      });
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('PUSH_')) throw error;
      throw fault(timedOut ? 'PUSH_TIMEOUT' : 'PUSH_NETWORK', 502);
    } finally {
      clearTimeout(timeout);
      if (abortLookup) controller.signal.removeEventListener('abort', abortLookup);
    }
  };
}

export const sendPushRequest = createPushTransport();
