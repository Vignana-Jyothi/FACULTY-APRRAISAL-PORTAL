import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// The reviewer's categories 1-5 marks are their own. Each defaults to the
// server-computed value, but the reviewer may override any of them, and the
// stored review total must follow the marks they awarded — not the self score.
// Both assessments go to HR, so they have to stay separable.
//
// Self-skips when the database is unavailable. Owns its department, faculty and
// HoD, so an aborted run cannot leave submissions on a shared seed account.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let hodTok = '';
// A throwaway dean. The seed ADMIN001 used to be logged in here, and every
// login (and every admin action) leaves an audit row the fixture can't reach.
let fixtureAdminTok = '';
let faculty: FixtureUser;

// A submission can only be approved once ("Already approved"), so each test
// that reviews gets its own throwaway.
async function makeSubmission(): Promise<string> {
  return fixture!.createSubmission(faculty, { status: 'SUBMITTED' });
}

beforeAll(async () => {
  try {
    fixture = await createFixture('ROV');
    faculty = await fixture.addUser({ name: 'FAC' });
    const hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' });
    hodTok = hod.token;
    fixtureAdminTok = (await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN })).token;
    ready = Boolean(hodTok && faculty.token && fixtureAdminTok);
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('review score — reviewer marks for categories 1-5', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(faculty?.id).toBeTruthy();
  });

  it('stores the overridden marks and totals them, not the self score', async () => {
    if (!ready) return;
    const subId = await makeSubmission();

    const res = await request(app)
      .post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok))
      .send({
        cat1Score: 120, cat2Score: 90, cat3Score: 40, cat4Score: 30, cat5Score: 20,
        cat6Punctuality: 10, cat6Professionalism: 10, cat6Willingness: 10,
        cat6Cordiality: 10, cat6Classroom: 10,
        overallComment: 'Marked down on evidence', status: 'APPROVED',
      });
    expect(res.status).toBe(200);

    const stored = await prisma.appraisalReview.findFirst({ where: { submissionId: subId } });
    expect(stored).toBeTruthy();
    expect(stored!.cat1Score).toBe(120);
    expect(stored!.cat2Score).toBe(90);
    expect(stored!.cat5Score).toBe(20);
    // 120 + 90 + 40 + 30 + 20 = 300, + Cat 6 capped at 50 = 350.
    expect(stored!.totalScore).toBe(300);
    expect(stored!.grandTotal).toBe(350);
  });

  it('admin can reopen an approved appraisal so the marks can be corrected', async () => {
    if (!ready) return;
    const subId = await makeSubmission();
    const adminTok = fixtureAdminTok;
    if (!adminTok) return;

    // Approve with a wrong mark.
    const first = await request(app).post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok)).send({ cat1Score: 10, status: 'APPROVED' });
    expect(first.status).toBe(200);

    // Reviewer is locked out of a second decision.
    const second = await request(app).post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok)).send({ cat1Score: 140, status: 'APPROVED' });
    expect(second.status).toBe(400);

    // A reason is required, and the HoD cannot reopen.
    const noReason = await request(app).post(`/api/admin/appraisals/${subId}/reopen-review`)
      .set(bearer(adminTok)).send({});
    expect(noReason.status).toBe(400);
    const notAdmin = await request(app).post(`/api/admin/appraisals/${subId}/reopen-review`)
      .set(bearer(hodTok)).send({ reason: 'let me back in' });
    expect(notAdmin.status).toBe(403);

    // Admin reopens; the HoD can now correct the mark.
    const reopen = await request(app).post(`/api/admin/appraisals/${subId}/reopen-review`)
      .set(bearer(adminTok)).send({ reason: 'Cat 1 keyed in wrong' });
    expect(reopen.status).toBe(200);

    const sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.status).toBe('SUBMITTED');

    const corrected = await request(app).post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok)).send({ cat1Score: 140, status: 'APPROVED' });
    expect(corrected.status).toBe(200);

    const stored = await prisma.appraisalReview.findFirst({ where: { submissionId: subId } });
    expect(stored!.cat1Score).toBe(140);

    // The reopen is on the record.
    const log = await prisma.auditLog.findFirst({
      where: { entityId: subId, action: 'REVIEW_REOPENED' },
    });
    expect(log).toBeTruthy();
    expect((log!.metadata as any).reason).toBe('Cat 1 keyed in wrong');
  });

  it('does not re-email the faculty when a reopened appraisal is approved unchanged', async () => {
    if (!ready) return;
    const subId = await makeSubmission();
    const adminTok = fixtureAdminTok;
    if (!adminTok) return;

    const approve = () => request(app).post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok)).send({ cat1Score: 50, cat6Punctuality: 5, status: 'APPROVED' });

    expect((await approve()).status).toBe(200);
    const afterFirst = await prisma.emailNotification.count({
      where: { toUserId: faculty.id, template: 'submission_approved' },
    });

    // Reopen and approve again with the SAME marks — nothing changed for the
    // faculty, so nothing should land in their inbox a second time.
    await request(app).post(`/api/admin/appraisals/${subId}/reopen-review`)
      .set(bearer(adminTok)).send({ reason: 'no-op reopen' });
    expect((await approve()).status).toBe(200);

    expect(await prisma.emailNotification.count({
      where: { toUserId: faculty.id, template: 'submission_approved' },
    })).toBe(afterFirst);

    // A corrected decision is a different outcome and does notify them.
    await request(app).post(`/api/admin/appraisals/${subId}/reopen-review`)
      .set(bearer(adminTok)).send({ reason: 'correcting the mark' });
    const corrected = await request(app).post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok)).send({ cat1Score: 140, cat6Punctuality: 5, status: 'APPROVED' });
    expect(corrected.status).toBe(200);

    expect(await prisma.emailNotification.count({
      where: { toUserId: faculty.id, template: 'submission_approved' },
    })).toBe(afterFirst + 1);
  });

  it('freezes BOTH totals — self and reviewed — as one snapshot', async () => {
    if (!ready) return;
    const subId = await makeSubmission();

    const before = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(hodTok));
    expect(before.status).toBe(200);
    const selfAtReview = before.body.selfTotal;

    const res = await request(app).post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok)).send({ cat1Score: 25, status: 'APPROVED' });
    expect(res.status).toBe(200);

    const stored = await prisma.appraisalReview.findFirst({ where: { submissionId: subId } });
    // Two variables, one decision: what the faculty scored, and what the
    // reviewer awarded. Both out of 500.
    expect(stored!.selfTotalScore).toBe(selfAtReview);
    expect(stored!.totalScore).toBe(25);

    // Change the submission underneath the review. The frozen pair must not move
    // — that is the whole point of storing the self figure rather than
    // recomputing it, since recomputation drifts when scoring rules change.
    await prisma.cat4AdminResp.create({
      data: { submissionId: subId, responsibility: 'Extra', level: 'Department', workInvolved: 'x', period: '2026' },
    });
    const live = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(hodTok));
    expect(live.body.selfTotal).toBeGreaterThan(selfAtReview);

    const after = await prisma.appraisalReview.findFirst({ where: { submissionId: subId } });
    expect(after!.selfTotalScore).toBe(selfAtReview);
    expect(after!.totalScore).toBe(25);
  });

  it('refuses to reopen a submission that was never decided', async () => {
    if (!ready) return;
    const subId = await makeSubmission();
    const adminTok = fixtureAdminTok;
    if (!adminTok) return;

    const res = await request(app).post(`/api/admin/appraisals/${subId}/reopen-review`)
      .set(bearer(adminTok)).send({ reason: 'nothing to reopen' });
    expect(res.status).toBe(400);
  });

  it('rejects a mark above the category maximum', async () => {
    if (!ready) return;
    const subId = await makeSubmission();

    const res = await request(app)
      .post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok))
      .send({ cat1Score: 151, status: 'APPROVED' }); // Cat 1 caps at 150
    expect(res.status).toBe(400);
  });

  it('falls back to the computed value for any category left out', async () => {
    if (!ready) return;
    const subId = await makeSubmission();

    const score = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(hodTok));
    expect(score.status).toBe(200);

    const res = await request(app)
      .post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok))
      .send({ cat1Score: 100, status: 'APPROVED' }); // 2-5 omitted
    expect(res.status).toBe(200);

    const stored = await prisma.appraisalReview.findFirst({ where: { submissionId: subId } });
    expect(stored!.cat1Score).toBe(100);
    expect(stored!.cat2Score).toBe(score.body.cat2.total);
    expect(stored!.cat3Score).toBe(score.body.cat3.total);
  });
});
