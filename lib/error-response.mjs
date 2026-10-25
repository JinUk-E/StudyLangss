const pages = {
  400: ['요청을 확인해 주세요', '주소나 입력 내용을 확인한 뒤 다시 시도해 주세요.'],
  401: ['로그인이 필요해요', '아이디와 비밀번호를 확인한 뒤 다시 로그인해 주세요. 로그인 창을 닫으셨다면 아래에서 다시 시도할 수 있어요.'],
  403: ['접근 권한을 확인해 주세요', '현재 계정으로는 이 페이지를 이용할 수 없어요. 필요한 권한을 관리자에게 요청해 주세요.'],
  404: ['페이지를 찾을 수 없어요', '주소가 변경되었거나 공개되지 않은 페이지예요. 홈에서 원하는 메뉴를 다시 선택해 주세요.'],
  405: ['요청을 처리할 수 없어요', '홈에서 원하는 메뉴를 다시 선택해 주세요.'],
  409: ['잠시 확인이 필요해요', '진행 중인 작업이나 화면 상태를 확인한 뒤 다시 시도해 주세요.'],
  413: ['파일이 너무 커요', '파일 크기를 줄인 뒤 다시 시도해 주세요.'],
  415: ['파일 형식을 확인해 주세요', '지원하는 파일이나 입력 형식으로 다시 시도해 주세요.'],
  429: ['조금만 기다려 주세요', '요청이 잠시 몰렸어요. 잠시 기다린 뒤 다시 시도해 주세요.'],
  500: ['페이지를 표시할 수 없어요', '요청을 처리하는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'],
  502: ['서비스에 연결하지 못했어요', '일시적으로 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.'],
  503: ['서비스를 잠시 사용할 수 없어요', '서비스를 준비하고 있어요. 잠시 후 다시 시도해 주세요.'],
  504: ['응답을 조금 더 기다려야 해요', '요청을 처리하는 데 시간이 걸리고 있어요. 잠시 후 다시 시도해 주세요.']
};
const statusCode = status => Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;

/** Representation only: never changes authentication, permissions or HTTP status. */
export function wantsErrorPage(req) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) return false;
  const headers = req.headers || {};
  if (headers['sec-fetch-mode'] === 'navigate' || ['document', 'iframe'].includes(headers['sec-fetch-dest'])) return true;
  const accept = typeof headers.accept === 'string' ? headers.accept : '';
  const quality = type => Math.max(0, ...accept.split(',').map(part => {
    const [media, ...parameters] = part.trim().toLowerCase().split(';');
    if (media !== type) return 0;
    const q = parameters.map(value => value.trim()).find(value => value.startsWith('q='));
    return q === undefined ? 1 : Number(q.slice(2)) || 0;
  }));
  return quality('text/html') > 0 && quality('text/html') >= quality('application/json');
}

/** HTML contains fixed copy only. Never interpolate a URL, exception or account. */
export function errorPage(status) {
  status = statusCode(status);
  const [title, message] = pages[status] || pages[500];
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · 별빛공방</title>
<style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#243c41;background:#f4f7f8}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:28px;background:radial-gradient(ellipse at 15% 10%,#e1f1eb,transparent 55%),radial-gradient(ellipse at 90% 90%,#faeee5,transparent 50%)}main{width:min(100%,620px);padding:clamp(26px,6vw,54px);border:1px solid #dfe8e7;border-radius:30px;background:#ffffffed;box-shadow:0 20px 70px #2749490b}.brand{display:flex;align-items:center;gap:12px;color:#467c72;font-size:14px;font-weight:650;margin-bottom:40px}.star{width:38px;height:38px;display:grid;place-items:center;border-radius:13px;background:#e7f3ee;font-size:25px}.code{color:#6a8c85;font-size:12px;letter-spacing:2px;font-weight:600}h1{font-size:clamp(25px,5vw,34px);line-height:1.4;letter-spacing:-1px;margin:16px 0}p{font-size:15px;line-height:1.9;color:#63787d;margin:0}nav{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}a{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:12px 20px;border-radius:14px;font-size:14px;font-weight:600;text-decoration:none;color:#fff;background:#427e73}a.secondary{background:#edf3f2;color:#416b63}a:focus-visible{outline:3px solid #c08c4e;outline-offset:4px}.note{font-size:12px;margin-top:30px;color:#80928f}@media(prefers-color-scheme:dark){:root{color:#e5efed;background:#18282b}body{background:radial-gradient(ellipse at 15% 10%,#1b3b34,transparent 60%),#18282b}main{background:#223438;border-color:#3e5354}.brand,.code{color:#9fc9bd}.star{background:#304c45}p,.note{color:#b0c3c1}a.secondary{background:#344c48;color:#d9e9e4}}
</style></head><body><main><div class="brand"><span class="star" aria-hidden="true">✦</span>별빛공방</div><div class="code">${status} · STARLIGHT FORGE</div><h1>${title}</h1><p>${message}</p><nav aria-label="오류 화면 이동"><a href="/">홈으로 돌아가기</a><a class="secondary" href="">${status === 401 ? '다시 로그인' : '다시 시도'}</a></nav><p class="note">작은 시도와 꾸준한 기록.</p></main></body></html>`;
}

export function publicErrorMessage(status, message) {
  status = statusCode(status);
  if (status < 500 && typeof message === 'string' && message) return message;
  if (status === 503) return '서비스를 사용할 수 없습니다. Mac의 서비스 상태를 확인하고 잠시 후 다시 시도해 주세요.';
  return (pages[status] || pages[500])[1];
}

export function sendError(req, res, status, message) {
  status = statusCode(status);
  if (res.headersSent) { res.end(); return; }
  const html = wantsErrorPage(req);
  for (const header of ['Content-Disposition', 'Content-Length', 'Content-Encoding']) res.removeHeader?.(header);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Vary', 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest');
  if (html) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.writeHead(status, { 'Content-Type': `${html ? 'text/html' : 'application/json'}; charset=utf-8` });
  res.end(req.method === 'HEAD' ? undefined : html ? errorPage(status) : JSON.stringify({ error: publicErrorMessage(status, message) }));
}
