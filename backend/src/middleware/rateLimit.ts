import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

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
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 120, // 120 req / IP / min
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
