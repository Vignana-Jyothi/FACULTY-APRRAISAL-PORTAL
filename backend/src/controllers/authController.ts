import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { z } from 'zod';
import prisma from '../utils/prismaClient';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';

const loginSchema = z.object({
  employeeCode: z.string().min(1),
  password: z.string().min(1),
});

// A valid bcrypt hash (of a random string) compared against when the account
// is unknown/inactive, so login timing does not leak account existence.
const DUMMY_HASH = '$2b$12$duvCNJakmNHd0zv7RFluk./a5qKxD9bExM479bQqjlEUQ/3f0vinq';

// The refresh token is the long-lived (7d) credential, so it lives in an
// httpOnly cookie out of JavaScript's reach — an XSS can no longer read it.
// Scoped to the auth routes that use it. `secure` only in production, so plain
// HTTP dev still works (prod is fronted by TLS at the campus proxy).
const REFRESH_COOKIE = 'refreshToken';
const refreshCookieOpts = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Minimal cookie reader — avoids adding cookie-parser for one cookie.
function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Sign a fresh access token and set the refresh cookie for `user`. Returns the
 * access token. Used by login and by change-password, which bumps tokenVersion
 * (killing every session) and then re-issues one for the tab that made the change.
 */
export function issueSession(
  res: Response,
  user: { id: string; employeeCode: string; tokenVersion: number },
): string {
  const payload = { userId: user.id, employeeCode: user.employeeCode, tokenVersion: user.tokenVersion };
  // Refresh token goes in the httpOnly cookie, never the JSON body.
  res.cookie(REFRESH_COOKIE, signRefreshToken(payload), refreshCookieOpts);
  return signAccessToken(payload);
}

export async function login(req: Request, res: Response) {
  const { employeeCode, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { employeeCode },
    include: {
      userRoles: {
        where: { isActive: true },
        select: { role: true, departmentId: true },
      },
    },
  });

  // Constant-time-ish: always run one bcrypt compare, even for an unknown or
  // inactive account, so response timing does not reveal whether the employee
  // code exists. DUMMY_HASH is a real bcrypt hash of a random string.
  const hash = user?.isActive ? user.passwordHash : DUMMY_HASH;
  const valid = await bcrypt.compare(password, hash);
  if (!user || !user.isActive || !valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const accessToken = issueSession(res, user);

  // Security audit trail — record the successful login (id + action only, no
  // credentials). Best-effort: never fail the login on an audit write error.
  prisma.auditLog.create({
    data: { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id },
  }).catch(() => {});

  return res.json({
    accessToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      employeeCode: user.employeeCode,
      departmentId: user.departmentId,
      roles: user.userRoles,
      // True when someone else chose this password; the client sends the user
      // straight to the change-password form, and `authenticate` refuses
      // everything else until it is changed.
      mustChangePassword: user.mustChangePassword,
    },
  });
}

export async function refresh(req: Request, res: Response) {
  // Prefer the httpOnly cookie; fall back to the body for older clients.
  const refreshToken = readCookie(req, REFRESH_COOKIE) ?? req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found' });
    // A refresh token from before the last logout / password change is dead.
    if ((payload.tokenVersion ?? 0) !== user.tokenVersion) {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    const accessToken = signAccessToken({ userId: user.id, employeeCode: user.employeeCode, tokenVersion: user.tokenVersion });
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

// Logout invalidates every outstanding token for the user by bumping the
// session generation, so a stolen access/refresh token stops working now
// rather than living out its expiry.
export async function logout(req: Request, res: Response) {
  // Resolve the user from the access token if still valid, else from the
  // refresh cookie — so logout can revoke even after the access token expired.
  let userId = req.user?.id;
  if (!userId) {
    const rt = readCookie(req, REFRESH_COOKIE);
    if (rt) { try { userId = verifyRefreshToken(rt).userId; } catch { /* ignore */ } }
  }
  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    }).catch(() => {});
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  return res.json({ message: 'Logged out' });
}

// ─── Forgot Password (no auth) ──────────────────────────────────────

const OTP_EXPIRY_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;

function generateOtp(): string {
  // Cryptographically secure 6-digit code (100000–999999).
  return String(randomInt(100000, 1000000));
}

const forgotSchema = z.object({
  employeeCode: z.string().min(1),
});

export async function forgotPassword(req: Request, res: Response) {
  const { employeeCode } = forgotSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { employeeCode } });

  // Always return success to prevent user enumeration
  const genericMsg = { message: 'If your account exists, an OTP has been emailed.' };

  if (!user || !user.isActive || !user.email) {
    return res.json(genericMsg);
  }

  const otp = generateOtp();
  const codeHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MIN * 60 * 1000);

  await prisma.passwordOtp.upsert({
    where: { userId: user.id },
    create: { userId: user.id, codeHash, expiresAt, attempts: 0 },
    update: { codeHash, expiresAt, attempts: 0 },
  });

  try {
    const { enqueueEmail } = await import('../services/emailService');
    await enqueueEmail({
      toUserId: user.id,
      template: 'password_otp',
      payload: {
        name: user.name,
        otp,
        expiresInMinutes: OTP_EXPIRY_MIN,
      },
      honorOptIn: false,
    });
  } catch (e) {
    console.error('[email] forgot-password OTP enqueue failed:', e);
  }

  return res.json(genericMsg);
}

const resetSchema = z.object({
  employeeCode: z.string().min(1),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must include a letter')
    .regex(/\d/, 'Password must include a number'),
});

export async function resetPassword(req: Request, res: Response) {
  const { employeeCode, otp, newPassword } = resetSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { employeeCode },
    include: { passwordOtp: true },
  });
  // Generic error to prevent enumeration
  const invalid = () => res.status(400).json({ error: 'Invalid or expired OTP' });
  if (!user || !user.isActive) return invalid();

  const otpRow = user.passwordOtp;
  if (!otpRow) return invalid();
  if (otpRow.expiresAt < new Date()) {
    await prisma.passwordOtp.delete({ where: { userId: user.id } }).catch(() => {});
    return invalid();
  }
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.passwordOtp.delete({ where: { userId: user.id } }).catch(() => {});
    return invalid();
  }

  const ok = await bcrypt.compare(otp, otpRow.codeHash);
  if (!ok) {
    await prisma.passwordOtp.update({
      where: { userId: user.id },
      data: { attempts: { increment: 1 } },
    });
    return invalid();
  }

  const newHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction(async (tx) => {
    // Bump the session generation so any token issued before this reset dies.
    // The user chose this password themselves (OTP-verified), so it clears any
    // forced change.
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, tokenVersion: { increment: 1 }, mustChangePassword: false },
    });
    await tx.passwordOtp.delete({ where: { userId: user.id } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_RESET',
        entityType: 'User',
        entityId: user.id,
      },
    });
  });

  return res.json({ message: 'Password reset successful. You may now log in.' });
}
