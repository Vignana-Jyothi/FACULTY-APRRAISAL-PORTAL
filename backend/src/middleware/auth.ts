import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import prisma from '../utils/prismaClient';
import { RoleType } from '@prisma/client';

export interface AuthUser {
  id: string;
  employeeCode: string;
  roles: Array<{ role: RoleType; departmentId: string | null }>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * What a user with `mustChangePassword` may still reach: read who they are, and
 * the two steps of the change-password flow. Refresh and logout are not behind
 * `authenticate` at all, so they need no entry. Everything else is refused
 * until the password someone else chose has been replaced.
 *
 * Kept here rather than as per-route middleware so a new route is gated by
 * default — forgetting to opt it in fails closed.
 */
const PASSWORD_CHANGE_ALLOWED: ReadonlyArray<readonly [method: string, path: string]> = [
  ['GET', '/api/users/me'],
  ['POST', '/api/users/me/password-otp'],
  ['POST', '/api/users/me/change-password'],
  ['POST', '/api/auth/logout'],
];

export function isAllowedDuringPasswordChange(method: string, fullPath: string): boolean {
  const path = fullPath.length > 1 ? fullPath.replace(/\/+$/, '') : fullPath;
  return PASSWORD_CHANGE_ALLOWED.some(([m, p]) => m === method.toUpperCase() && p === path);
}

export const PASSWORD_CHANGE_REQUIRED = {
  error: 'You must change your password before continuing.',
  code: 'PASSWORD_CHANGE_REQUIRED',
} as const;

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);

    // Verify the account still exists and is active — a token issued before
    // deactivation/deletion must not keep working for its full lifetime.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        isActive: true,
        tokenVersion: true,
        mustChangePassword: true,
        userRoles: { where: { isActive: true }, select: { role: true, departmentId: true } },
      },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Account inactive or not found' });
    }
    // Reject a token from before the last logout / password change.
    if ((payload.tokenVersion ?? 0) !== user.tokenVersion) {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    // Someone else chose this password (import / admin create): nothing but the
    // change-password flow until the user replaces it. baseUrl + path is the
    // mount-independent full path, without the query string.
    if (user.mustChangePassword && !isAllowedDuringPasswordChange(req.method, req.baseUrl + req.path)) {
      return res.status(403).json(PASSWORD_CHANGE_REQUIRED);
    }

    req.user = {
      id: payload.userId,
      employeeCode: payload.employeeCode,
      roles: user.userRoles,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
