import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, FIXTURE_PW, type Fixture, type FixtureUser } from './helpers/fixtures';

// DELETE /admin/users/:id is a soft delete. It used to remove the user row and
// with it every appraisal they had filed, every review they had given on other
// people's work, and their audit trail — from a button that also had a bulk
// form. Staff leave; the institution's record of them has to survive.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let adminTok = '';
let victim: FixtureUser;
let colleague: FixtureUser;
let victimSubId = '';
let colleagueSubId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('SDL');
    // A throwaway dean, not the seed ADMIN001 — every login is audited, and
    // this suite's admin actions are audited too; the fixture takes them away.
    adminTok = (await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN })).token;
    if (!adminTok) return;

    // The victim is a HoD, so the role stand-down is observable, and they have
    // both an appraisal of their own and a review they gave to someone else.
    victim = await fixture.addUser({ name: 'VIC', role: RoleType.HOD, designation: 'Professor' });
    colleague = await fixture.addUser({ name: 'COL' });

    victimSubId = await fixture.createSubmission(victim, { status: 'DRAFT' });
    colleagueSubId = await fixture.createSubmission(colleague, { status: 'SUBMITTED' });

    const reviewed = await request(app)
      .post(`/api/appraisals/${colleagueSubId}/review`)
      .set(bearer(victim.token))
      .send({
        cat4Score: 10, cat6Punctuality: 8, cat6Professionalism: 8, cat6Willingness: 8,
        cat6Cordiality: 8, cat6Classroom: 8, overallComment: 'Fine.', status: 'APPROVED',
      });
    ready = reviewed.status === 200 && Boolean(adminTok && victim.token);
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
});

const login = (code: string) =>
  request(app).post('/api/auth/login').send({ employeeCode: code, password: FIXTURE_PW });

describe('DELETE /admin/users/:id — soft delete', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(victimSubId).not.toBe('');
    expect(colleagueSubId).not.toBe('');
  });

  it('lets the user sign in before it is called', async () => {
    if (!ready) return;
    expect((await login(victim.employeeCode)).status).toBe(200);
  });

  it('refuses to let an admin deactivate themselves', async () => {
    if (!ready) return;
    const me = await request(app).get('/api/users/me').set(bearer(adminTok));
    const res = await request(app).delete(`/api/admin/users/${me.body.id}`).set(bearer(adminTok));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/your own account/i);
  });

  it('deactivates the account and stands its roles down', async () => {
    if (!ready) return;
    const res = await request(app).delete(`/api/admin/users/${victim.id}`).set(bearer(adminTok));
    expect(res.status).toBe(200);

    const row = await prisma.user.findUnique({ where: { id: victim.id } });
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);

    const roles = await prisma.userRole.findMany({ where: { userId: victim.id } });
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((r) => r.isActive === false)).toBe(true);
  });

  it('keeps their appraisal, the review they gave, and the audit trail', async () => {
    if (!ready) return;
    expect(await prisma.appraisalSubmission.findUnique({ where: { id: victimSubId } })).not.toBeNull();
    const given = await prisma.appraisalReview.findFirst({ where: { reviewerId: victim.id } });
    expect(given).not.toBeNull();
    expect(given!.submissionId).toBe(colleagueSubId);
    // The colleague's approved appraisal is untouched by their reviewer leaving.
    const colleagueSub = await prisma.appraisalSubmission.findUnique({ where: { id: colleagueSubId } });
    expect(colleagueSub!.status).toBe('APPROVED');
  });

  it('stops them signing in', async () => {
    if (!ready) return;
    expect((await login(victim.employeeCode)).status).toBe(401);
  });

  it('hides them from the user list, and shows them when an admin asks', async () => {
    if (!ready) return;
    const hidden = await request(app)
      .get(`/api/admin/users?search=${victim.employeeCode}`).set(bearer(adminTok));
    const hiddenRows = Array.isArray(hidden.body) ? hidden.body : hidden.body.rows;
    expect(hiddenRows.find((u: any) => u.id === victim.id)).toBeUndefined();

    const shown = await request(app)
      .get(`/api/admin/users?search=${victim.employeeCode}&includeInactive=true`).set(bearer(adminTok));
    const shownRows = Array.isArray(shown.body) ? shown.body : shown.body.rows;
    expect(shownRows.find((u: any) => u.id === victim.id)?.isActive).toBe(false);
  });

  it('ignores includeInactive for a non-admin', async () => {
    if (!ready) return;
    const res = await request(app)
      .get(`/api/admin/users?search=${victim.employeeCode}&includeInactive=true`)
      .set(bearer(colleague.token));
    // The route is admin-guarded, so a faculty is refused outright.
    expect(res.status).toBe(403);
  });

  it('can be undone, and the user signs in again', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/admin/users/${victim.id}/reactivate`).set(bearer(adminTok));
    expect(res.status).toBe(200);
    expect((await login(victim.employeeCode)).status).toBe(200);

    // Roles stay stood down — they are re-assigned deliberately, not restored.
    const roles = await prisma.userRole.findMany({ where: { userId: victim.id } });
    expect(roles.every((r) => r.isActive === false)).toBe(true);
  });

  it('records both actions in the audit log', async () => {
    if (!ready) return;
    const rows = await prisma.auditLog.findMany({ where: { entityId: victim.id, entityType: 'User' } });
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('USER_DEACTIVATED');
    expect(actions).toContain('USER_REACTIVATED');
  });
});
