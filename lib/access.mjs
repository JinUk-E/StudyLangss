import { sendError } from './error-response.mjs';

/** Capability checks are repeated on the server; navigation is only a hint. */
export const hasPermission = (user, permission) => Boolean(user && user.enabled !== false && (user.isAdmin || user.permissions?.includes(permission)));

export function requireAccess(req, res, permission) {
  if (hasPermission(req.user, permission)) return true;
  sendError(req, res, 403, '이 기능의 사용 권한이 없습니다.');
  return false;
}
