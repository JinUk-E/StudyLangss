import { assert } from './validation.mjs';

/** Recheck live authorization while queued/generating and before every cached or new response. */
export async function sendSpeech(req, res, { tts, source, accounts, permission }) {
  const controller = new AbortController();
  const denied = () => Object.assign(new Error('계정이나 사용 권한이 변경되어 음성을 중지했습니다.'), { status: 403 });
  const check = () => { try { if (!accounts.current(req.user, permission)) controller.abort(denied()); } catch { controller.abort(denied()); } };
  const disconnected = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', disconnected);
  const interval = setInterval(check, 2000);
  try {
    check(); controller.signal.throwIfAborted();
    const audio = await tts.synthesize(source.text, { language: source.language, voice: source.voice, accountId: req.user.id, signal: controller.signal });
    controller.signal.throwIfAborted();
    assert(accounts.current(req.user, permission), '계정이나 사용 권한이 변경되어 음성을 중지했습니다.', 403);
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': audio.contentType, 'Content-Length': audio.buffer.length, 'Cache-Control': 'private, no-store' }); res.end(audio.buffer);
  } catch (error) {
    if (res.destroyed) return;
    if (controller.signal.aborted && controller.signal.reason?.status) throw controller.signal.reason;
    throw error;
  } finally { clearInterval(interval); res.off('close', disconnected); }
}
