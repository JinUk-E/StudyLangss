/** Capability checks are repeated on the server; navigation is only a hint. */
export const hasPermission = (user, permission) => Boolean(user && user.enabled !== false && (user.isAdmin || user.permissions?.includes(permission)));

export function requireAccess(req, res, permission) {
  if (hasPermission(req.user, permission)) return true;
  res.setHeader('Cache-Control', 'no-store');
  if (!(req.url || '').startsWith('/api/')) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>접근 권한 · 별빛공방</title><h1>이 기능의 사용 권한이 없습니다.</h1><p>현재 계정에 필요한 권한을 관리자에게 요청해 주세요.</p><a href="/">홈으로 돌아가기</a></html>');
  } else {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '이 기능의 사용 권한이 없습니다.' }));
  }
  return false;
}
