import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { isAllowedDuringPasswordChange } from '../middleware/auth';
import { DEFAULT_IMPORT_PASSWORD } from '../utils/defaultPassword';
import { createFixture, FIXTURE_PW, type Fixture, type FixtureUser } from './helpers/fixtures';

// Anyone whose password was chosen by someone else (bulk import, admin create)
// must replace it before using the app. `authenticate` enforces it server-side;
// the user's own change-password and the OTP forgot-password reset clear it.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const OTP = '482913';

let ready = false;
let fixture: Fixture | null = null;
let admin: FixtureUser;
let changer: FixtureUser;
let resetter: FixtureUser;
// Users this suite makes through the API rather than the fixture.
const madeByApi: string[] = [];

async function flag(u: FixtureUser) {
  await prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });
}

async function seedOtp(userId: string) {
  await prisma.passwordOtp.upsert({
    where: { userId },
    create: { userId, codeHash: await bcrypt.hash(OTP, 4), expiresAt: new Date(Date.now() + 600_000), attempts: 0 },
    update: { codeHash: await bcrypt.hash(OTP, 4), expiresAt: new Date(Date.now() + 600_000), attempts: 0 },
  });
}

beforeAll(async () => {
  try {
    fixture = await createFixture('FPC');
    admin = await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN });
    changer = await fixture.addUser({ name: 'CHG', role: RoleType.FACULTY });
    resetter = await fixture.addUser({ name: 'RST', role: RoleType.FACULTY });
    // Flag after login: the token stays valid (tokenVersion unchanged), which is
    // exactly the "admin flagged a signed-in user" case the gate must catch.
    await flag(changer);
    await flag(resetter);
    ready = Boolean(admin.token && changer.token && resetter.token);
  } catch (e) {
    console.error(e);
    ready = false;
  }
});

afterAll(async () => {
  for (const id of madeByApi) {
    await prisma.passwordOtp.deleteMany({ where: { userId: id } });
    await prisma.emailNotification.deleteMany({ where: { toUserId: id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: id }, { entityId: id }] } });
    await prisma.userRole.deleteMany({ where: { userId: id } });
    await prisma.user.deleteMany({ where: { id } });
  }
  await fixture?.destroy();
});

describe('isAllowedDuringPasswordChange', () => {
  it('allows only /me, the change-password flow and logout', () => {
    expect(isAllowedDuringPasswordChange('GET', '/api/users/me')).toBe(true);
    expect(isAllowedDuringPasswordChange('GET', '/api/users/me/')).toBe(true);
    expect(isAllowedDuringPasswordChange('POST', '/api/users/me/password-otp')).toBe(true);
    expect(isAllowedDuringPasswordChange('post', '/api/users/me/change-password')).toBe(true);
    expect(isAllowedDuringPasswordChange('POST', '/api/auth/logout')).toBe(true);

    expect(isAllowedDuringPasswordChange('PUT', '/api/users/me/profile')).toBe(false);
    expect(isAllowedDuringPasswordChange('PUT', '/api/users/me')).toBe(false);
    expect(isAllowedDuringPasswordChange('GET', '/api/appraisals')).toBe(false);
    expect(isAllowedDuringPasswordChange('GET', '/api/users/me/../../admin/users')).toBe(false);
  });
});

describe('forced password change — gate', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });

  it('refuses a normal route with 403 PASSWORD_CHANGE_REQUIRED', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/appraisals').set(bearer(changer.token));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'You must change your password before continuing.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  });

  it('refuses the profile update too — only the password form is open', async () => {
    if (!ready) return;
    const res = await request(app).put('/api/users/me/profile').set(bearer(changer.token)).send({ phone: '1' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('still serves /me, carrying the flag', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/users/me').set(bearer(changer.token));
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('carries the flag in the login payload', async () => {
    if (!ready) return;
    const res = await request(app).post('/api/auth/login').send({ employeeCode: changer.employeeCode, password: FIXTURE_PW });
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    // A new login is still gated.
    const gated = await request(app).get('/api/appraisals').set(bearer(res.body.accessToken));
    expect(gated.status).toBe(403);
    // The login did not bump tokenVersion, so the suite's token is still good.
  });

  it('lets the OTP request through (wrong current password is a 400, not the gate)', async () => {
    if (!ready) return;
    const res = await request(app)
      .post('/api/users/me/password-otp')
      .set(bearer(changer.token))
      .send({ currentPassword: 'definitely-wrong' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBeUndefined();
  });

  it('allows change-password, clears the flag and hands back a working session', async () => {
    if (!ready) return;
    await seedOtp(changer.id);
    const res = await request(app)
      .post('/api/users/me/change-password')
      .set(bearer(changer.token))
      .send({ otp: OTP, newPassword: 'Changed123' });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(false);
    expect(typeof res.body.accessToken).toBe('string');
    expect(String(res.headers['set-cookie'] ?? '')).toMatch(/refreshToken=/);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: changer.id }, select: { mustChangePassword: true } });
    expect(row.mustChangePassword).toBe(false);

    // The new token reaches normal routes; the pre-change one is dead.
    const after = await request(app).get('/api/appraisals').set(bearer(res.body.accessToken));
    expect(after.status).toBe(200);
    const stale = await request(app).get('/api/appraisals').set(bearer(changer.token));
    expect(stale.status).toBe(401);

    const me = await request(app).get('/api/users/me').set(bearer(res.body.accessToken));
    expect(me.body.mustChangePassword).toBe(false);
  });

  it('does not gate an unflagged user', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/users/me').set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(false);
  });
});

describe('forced password change — OTP forgot-password reset clears it', () => {
  it('resets the password and clears the flag', async () => {
    if (!ready) return;
    await seedOtp(resetter.id);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ employeeCode: resetter.employeeCode, otp: OTP, newPassword: 'Reset12345' });
    expect(res.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: resetter.id }, select: { mustChangePassword: true } });
    expect(row.mustChangePassword).toBe(false);

    const login = await request(app).post('/api/auth/login').send({ employeeCode: resetter.employeeCode, password: 'Reset12345' });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(false);
  });
});

describe('forced password change — set when someone else picks the password', () => {
  const stamp = `${Date.now() % 1_000_000}`;

  it('admin create-user sets the flag', async () => {
    if (!ready) return;
    const code = `FPCNEW${stamp}`;
    const res = await request(app)
      .post('/api/admin/users')
      .set(bearer(admin.token))
      .send({ employeeCode: code, name: 'FPC Created', email: `${code.toLowerCase()}@fixture.invalid`, password: 'Temp@1234', departmentId: fixture!.deptId });
    expect(res.status).toBe(201);
    madeByApi.push(res.body.id);
    expect(res.body.mustChangePassword).toBe(true);

    const login = await request(app).post('/api/auth/login').send({ employeeCode: code, password: 'Temp@1234' });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it('bulk import sets the flag on every created account', async () => {
    if (!ready) return;
    const a = `FPCIMA${stamp}`;
    const b = `FPCIMB${stamp}`;
    const csv = [
      'S.NO,EMP ID,Name of the Faculty,Designation,D.O.J,Mobile Number,E - Mail ID',
      `1,${a},FPC Import A,Assistant Professor,15-08-2020,9000000001,${a.toLowerCase()}@fixture.invalid`,
      `2,${b},FPC Import B,Assistant Professor,15-08-2020,9000000002,${b.toLowerCase()}@fixture.invalid`,
    ].join('\n');
    const res = await request(app)
      .post('/api/admin/users/bulk-import')
      .set(bearer(admin.token))
      .send({ csv, departmentId: fixture!.deptId, dryRun: false });
    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(2);
    for (const c of res.body.created) madeByApi.push(c.id);

    const rows = await prisma.user.findMany({
      where: { employeeCode: { in: [a, b] } },
      select: { mustChangePassword: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.mustChangePassword)).toBe(true);

    const login = await request(app).post('/api/auth/login').send({ employeeCode: a, password: DEFAULT_IMPORT_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const gated = await request(app).get('/api/appraisals').set(bearer(login.body.accessToken));
    expect(gated.status).toBe(403);
    expect(gated.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});
