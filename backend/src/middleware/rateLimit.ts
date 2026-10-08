import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { verifyAccessToken } from '../utils/jwt';

// Rate-limit key: logged-in users by their account id, everyone else by IP.
// generalLimiter runs before `authenticate`, so we decode the Bearer token
// here ourselves. On campus, hundreds of users share one public NAT IP — an
// IP-only key would make them all share a single request budget. Keying by
// user id gives each person their own budget; only pre-login traffic (which is
// little) falls back to the shared IP key.
function userOrIpKey(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const { userId } = verifyAccessToken(authHeader.slice(7));
      if (userId) return `user:${userId}`;
    } catch {
      // invalid/expired token — fall through to IP
    }
  }
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

// Stricter limits on auth endpoints — prevents brute force
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max: 10, // 10 failed attempts per IP+account (campus NAT shares one public IP, so key on email too)
  // Key on IP + email so one user's bad password doesn't lock everyone behind the same campus IP.
  // Empty email (e.g. reset-password, which carries a token not an email) falls back to IP-only.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email || '').toLowerCase()}`,
  message: { error: 'Too many auth attempts. Try again in 5 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

// OTP request — even stricter (prevent email spam)
export const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 3, // 3 OTP requests / IP / min
  message: { error: 'Too many OTP requests. Wait 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter — looser. Disabled under test (supertest hammers from one IP).
// Keyed per user (or per IP when not logged in) so a whole campus behind one
// shared public IP isn't throttled as if it were a single client.
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 300, // 300 req / user / min
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
