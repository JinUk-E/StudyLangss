import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, readdir, stat, utimes } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const MiB = 1024 * 1024;
const failure = (message, status = 503, code = 'TTS_UNAVAILABLE') => Object.assign(new Error(message), { status, code });
const cancelled = () => failure('음성 요청을 취소했습니다.', 499, 'TTS_CANCELLED');

/** Absolute executable paths, argv only, bounded output, and forceful timeout cleanup. */
export function runCommand(command, args, { signal, timeoutMs = 30000 } = {}) {
  return new Promise((resolveRun, reject) => {
    if (signal?.aborted) return reject(signal.reason || cancelled());
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', stopped, forceTimer;
    const stop = reason => {
      if (stopped) return;
      stopped = reason;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 250);
      forceTimer.unref();
    };
    const abort = () => stop(signal.reason || cancelled());
    const timer = setTimeout(() => stop(failure('음성 생성 시간이 초과되었습니다.', 504, 'TTS_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunk, target) => {
      if (target === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
      if (stdout.length + stderr.length > 128 * 1024) stop(failure('음성 도구의 응답이 너무 큽니다.', 502, 'TTS_OUTPUT_LIMIT'));
    };
    child.stdout.on('data', chunk => collect(chunk, 'stdout'));
    child.stderr.on('data', chunk => collect(chunk, 'stderr'));
    child.once('error', error => { stopped ||= failure('Mac 음성 도구를 실행할 수 없습니다.', 503, 'TTS_EXEC_FAILED'); stopped.cause = error; });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
      if (stopped) reject(stopped);
      else if (code !== 0) reject(failure('Mac 음성 생성에 실패했습니다. 설치된 일본어 음성을 확인해 주세요.', 502, 'TTS_EXEC_FAILED'));
      else resolveRun({ stdout, stderr });
    });
  });
}

/** Reject corrupt/empty files before a response or a cache hit can reach a browser. */
export function validWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 46 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.readUInt32LE(4) + 8 !== buffer.length) return false;
  let offset = 12, format = false, audio = false;
  while (offset + 8 <= buffer.length) {
    const kind = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > buffer.length) return false;
    if (kind === 'fmt ') {
      if (size < 16) return false;
      const channels = buffer.readUInt16LE(start + 2), rate = buffer.readUInt32LE(start + 4), align = buffer.readUInt16LE(start + 12);
      if (buffer.readUInt16LE(start) !== 1 || ![1, 2].includes(channels) || rate < 8000 || rate > 96000 || buffer.readUInt16LE(start + 14) !== 16 || align !== channels * 2 || buffer.readUInt32LE(start + 8) !== rate * align) return false;
      format = true;
    }
    if (kind === 'data') audio ||= size > 0 && size % 2 === 0;
    offset = start + size + (size % 2);
  }
  return offset === buffer.length && format && audio;
}

export function createTts({ cacheDir, platform = process.platform, run = runCommand, backend, namespace = 'study', timeoutMs = 30000, requestTimeoutMs = timeoutMs + 20000, maxCacheBytes = 128 * MiB, maxAudioBytes = 16 * MiB, maxQueue = 16 } = {}) {
  if (!cacheDir) throw new TypeError('TTS cacheDir is required');
  if (![timeoutMs, requestTimeoutMs, maxCacheBytes, maxAudioBytes, maxQueue].every(value => Number.isSafeInteger(value) && value > 0) || maxAudioBytes > maxCacheBytes) throw new TypeError('Invalid TTS resource limits');
  const directory = resolve(cacheDir), jobs = new Map(), queue = [], controllers = new Set(), activeJobs = new Set();
  let closed = false, running = false, voiceState, voiceExpires = 0, voicePromise, closePromise;
  const unavailable = error => ({ available: false, voices: [], error });

  async function voices() {
    if (closed) return unavailable('음성 서버가 종료되었습니다.');
    if (backend) {
      try { return await backend.voices(); }
      catch { return { ...unavailable('Qwen 음성 서비스에 연결하지 못했습니다. Mac 설치 상태를 확인해 주세요.'), provider: 'qwen3-tts', state: 'unavailable' }; }
    }
    if (platform !== 'darwin') return unavailable('서버 음성 합성은 macOS에서 사용할 수 있습니다.');
    if (voiceState && Date.now() < voiceExpires) return voiceState;
    if (voicePromise) return voicePromise;
    const controller = new AbortController(); controllers.add(controller);
    voicePromise = (async () => {
      try {
        const result = await run('/usr/bin/say', ['-v', '?'], { signal: controller.signal, timeoutMs: Math.min(timeoutMs, 10000) });
        const found = new Map();
        for (const line of String(result.stdout || '').split(/\r?\n/)) {
          const match = line.match(/^(.+?)\s+ja[_-]JP\s+#/);
          const name = match?.[1].trim();
          if (name && name.length <= 128 && !/[\x00-\x1f\x7f]/.test(name)) found.set(name, { id: name, name, language: 'ja-JP' });
        }
        const list = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
        voiceState = list.length ? { available: true, voices: list } : unavailable('Mac에 일본어 음성을 설치한 뒤 다시 시도해 주세요.');
      } catch { voiceState = unavailable('Mac의 일본어 음성 목록을 불러오지 못했습니다.'); }
      finally { controllers.delete(controller); }
      voiceExpires = Date.now() + (voiceState.available ? 60000 : 5000);
      return voiceState;
    })().finally(() => { voicePromise = undefined; });
    return voicePromise;
  }

  async function load(filename) {
    try {
      const info = await stat(filename);
      if (!info.isFile() || info.size > maxAudioBytes) throw new Error('invalid cache size');
      const buffer = await readFile(filename);
      if (!validWav(buffer)) throw new Error('invalid cache WAV');
      await utimes(filename, new Date(), new Date());
      return buffer;
    } catch (error) {
      if (error.code !== 'ENOENT') await rm(filename, { force: true });
      return null;
    }
  }

  async function trimCache(incoming) {
    const files = [];
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9]{64}\.wav$/.test(name)) continue;
      try { const info = await stat(join(directory, name)); if (info.isFile()) files.push({ name, size: info.size, time: info.mtimeMs }); } catch {}
    }
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.time - b.time)) {
      if (total + incoming <= maxCacheBytes) break;
      await rm(join(directory, file.name), { force: true }); total -= file.size;
    }
  }

  async function produce(job) {
    const { key, text, voice, language, controller } = job, signal = controller.signal;
    const timer = setTimeout(() => controller.abort(failure('음성 생성 시간이 초과되었습니다.', 504, 'TTS_TIMEOUT')), timeoutMs);
    let temporary;
    try {
      signal.throwIfAborted();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await trimCache(0);
      const destination = join(directory, `${key}.wav`), existing = await load(destination);
      if (existing) return { buffer: existing, contentType: 'audio/wav', voice, cacheKey: key, cached: true };
      signal.throwIfAborted();
      temporary = await mkdtemp(join(directory, '.tts-'));
      const input = join(temporary, 'text.txt'), aiff = join(temporary, 'speech.aiff'), wave = join(temporary, 'speech.wav');
      if (backend) await backend.generate({ text, language, voice, signal, destination: wave });
      else {
        await writeFile(input, text, { encoding: 'utf8', mode: 0o600 });
        await run('/usr/bin/say', ['-v', voice, '-o', aiff, '-f', input], { signal, timeoutMs });
        signal.throwIfAborted();
        await run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', aiff, wave], { signal, timeoutMs });
      }
      signal.throwIfAborted();
      const info = await stat(wave);
      if (!info.isFile() || info.size > maxAudioBytes) throw failure('생성된 음성 파일이 허용 크기를 초과했습니다.', 502, 'TTS_AUDIO_LIMIT');
      const buffer = await readFile(wave);
      if (!validWav(buffer)) throw failure('생성된 음성 파일이 올바르지 않습니다.', 502, 'TTS_INVALID_AUDIO');
      await trimCache(buffer.length);
      signal.throwIfAborted();
      await rename(wave, destination);
      return { buffer, contentType: 'audio/wav', voice, cacheKey: key, cached: false };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error.status) throw error;
      throw Object.assign(failure('음성 파일을 생성하거나 저장하지 못했습니다.', 502, 'TTS_GENERATION_FAILED'), { cause: error });
    } finally {
      clearTimeout(timer);
      // Only remove a freshly allocated child of the configured cache directory.
      if (temporary && dirname(resolve(temporary)) === directory && basename(temporary).startsWith('.tts-')) await rm(temporary, { recursive: true, force: true });
    }
  }

  async function pump() {
    if (running || closed) return;
    const job = queue.shift();
    if (!job) return;
    if (!job.subscribers.size) { jobs.delete(job.key); pump(); return; }
    running = true; job.started = true; controllers.add(job.controller); activeJobs.add(job);
    try {
      const result = await produce(job);
      for (const subscriber of job.subscribers) subscriber.resolve(result);
    } catch (error) { for (const subscriber of job.subscribers) subscriber.reject(error); }
    finally {
      for (const subscriber of job.subscribers) subscriber.cleanup();
      job.subscribers.clear(); controllers.delete(job.controller); activeJobs.delete(job);
      if (jobs.get(job.key) === job) jobs.delete(job.key);
      running = false; job.finish(); pump();
    }
  }

  async function synthesize(input, { voice: requestedVoice, language = 'ja', accountId = 'owner', signal } = {}) {
    const deadline = Date.now() + requestTimeoutMs;
    if (closed) throw failure('음성 서버가 종료되었습니다.');
    if (signal?.aborted) throw cancelled();
    if (typeof input !== 'string' || !input.trim() || input.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input) || input.includes('[[') || input.includes(']]')) throw failure('음성 텍스트는 1~2000자의 일반 문장으로 입력해 주세요.', 400, 'TTS_INVALID_TEXT');
    if (!['ja', 'ko', 'en', 'auto'].includes(language) || typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(accountId)) throw failure('음성 언어 또는 계정 정보를 확인해 주세요.', 400, 'TTS_INVALID_SOURCE');
    if (!backend && language !== 'ja') throw failure('한국어와 대화 음성은 Qwen3-TTS 설치 후 사용할 수 있습니다.', 503, 'TTS_NOT_CONFIGURED');
    const text = input.trim().normalize('NFC'), available = await voices();
    if (Date.now() >= deadline) throw failure('음성 요청 대기 시간이 초과되었습니다. 잠시 후 다시 눌러 주세요.', 504, 'TTS_TIMEOUT');
    if (closed) throw failure('음성 서버가 종료되었습니다.');
    if (signal?.aborted) throw cancelled();
    if (!available.available) throw failure(available.error);
    const languageTag = language === 'ja' ? 'ja-JP' : language === 'en' ? 'en-US' : 'ko-KR';
    const candidates = available.voices.filter(item => !backend || item.language === languageTag);
    if (requestedVoice !== undefined && (typeof requestedVoice !== 'string' || !candidates.some(item => item.id === requestedVoice))) throw failure('선택한 언어에 맞는 음성을 선택해 주세요.', 400, 'TTS_INVALID_VOICE');
    if (!candidates.length) throw failure('선택한 언어의 음성을 사용할 수 없습니다.', 503, 'TTS_UNAVAILABLE');
    const voice = requestedVoice ?? candidates[0].id;
    const key = createHash('sha256').update(JSON.stringify([backend?.identity || 'mac-say-wave-v1', namespace, accountId, language, voice, text])).digest('hex');
    let job = jobs.get(key);
    if (job?.controller.signal.aborted) job = undefined;
    if (!job) {
      if (jobs.size >= maxQueue) throw failure('음성 요청이 많습니다. 잠시 후 다시 시도해 주세요.', 429, 'TTS_QUEUE_FULL');
      job = { key, text, voice, language, controller: new AbortController(), subscribers: new Set(), started: false };
      job.done = new Promise(done => { job.finish = done; });
      jobs.set(key, job); queue.push(job);
    }
    return new Promise((resolveRequest, rejectRequest) => {
      let requestTimer;
      const subscriber = { resolve: resolveRequest, reject: rejectRequest, cleanup: () => { clearTimeout(requestTimer); signal?.removeEventListener('abort', onAbort); } };
      const abort = reason => {
        subscriber.cleanup(); job.subscribers.delete(subscriber); rejectRequest(reason);
        if (!job.subscribers.size) {
          job.controller.abort(reason);
          if (!job.started) { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); if (jobs.get(key) === job) jobs.delete(key); job.finish(); }
        }
      };
      const onAbort = () => abort(cancelled());
      requestTimer = setTimeout(() => abort(failure('음성 요청 대기 시간이 초과되었습니다. 잠시 후 다시 눌러 주세요.', 504, 'TTS_TIMEOUT')), Math.max(1, deadline - Date.now()));
      job.subscribers.add(subscriber); signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      pump();
    });
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    for (const controller of controllers) controller.abort(cancelled());
    for (const job of queue.splice(0)) {
      for (const subscriber of job.subscribers) { subscriber.cleanup(); subscriber.reject(cancelled()); }
      job.subscribers.clear(); jobs.delete(job.key); job.finish();
    }
    closePromise = Promise.allSettled([...new Set([...jobs.values(), ...activeJobs])].map(job => job.done).concat(voicePromise || [])).then(() => undefined);
    return closePromise;
  }
  return { voices, synthesize, close };
}
