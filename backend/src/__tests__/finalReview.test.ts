import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// The dean-assigned final-review layer ABOVE the HoD. Admin assigns any number
// of reviewers, from any department; ONE approval finalises, and a REJECT sends
// the submission back to HOLD.
//
// Self-skips when the database is unavailable. Owns its departments, its faculty
// and its reviewers, so an aborted run cannot leave a submission on a shared
// seed account — FAC21 lost a real draft that way once.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let adminTok = '', rev1Tok = '', rev2Tok = '', outsiderTok = '';
let rev1Id = '', rev2Id = '', outsiderId = '', subId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('FRV');
    // A throwaway dean. Logging in as the seed ADMIN001 left a LOGIN audit row
    // (and its admin actions' rows) behind on every run.
    adminTok = (await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN })).token;
    if (!adminTok) return;

    const faculty = await fixture.addUser({ name: 'FAC' });
    const rev1 = await fixture.addUser({ name: 'RV1', role: RoleType.REVIEWER });
    const rev2 = await fixture.addUser({ name: 'RV2', role: RoleType.HOD, designation: 'Professor' });

    // A reviewer belonging to a DIFFERENT department: cross-department access
    // must come from the dean's assignment alone, never from a standing role.
    const otherDeptId = await fixture.addDepartment('FRX');
    const outsider = await fixture.addUser({ name: 'OUT', role: RoleType.REVIEWER, deptId: otherDeptId });

    rev1Id = rev1.id; rev2Id = rev2.id; outsiderId = outsider.id;
    rev1Tok = rev1.token; rev2Tok = rev2.token; outsiderTok = outsider.token;
    if (!rev1Tok || !rev2Tok || !outsiderTok) return;

    // Throwaway submission already HoD-approved, ready for the final layer.
    subId = await fixture.createSubmission(faculty, { status: 'APPROVED' });
    ready = true;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('final review — dean-assigned reviewer layer', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(subId).not.toBe('');
    expect(outsiderId).not.toBe('');
  });

  it('non-admin cannot assign final reviewers (403)', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(rev1Tok)).send({ reviewerIds: [rev1Id, rev2Id] });
    expect(res.status).toBe(403);
  });

  it('accepts any number of reviewers — a single one is allowed', async () => {
    if (!ready) return;
    const one = await request(app).post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(adminTok)).send({ reviewerIds: [rev1Id] });
    expect(one.status).toBe(201);
    expect(one.body.reviewers).toHaveLength(1);

    // Duplicates collapse rather than erroring.
    const dup = await request(app).post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(adminTok)).send({ reviewerIds: [rev1Id, rev1Id] });
    expect(dup.status).toBe(201);
    expect(dup.body.reviewers).toHaveLength(1);
  });

  it('rejects an empty reviewer list', async () => {
    if (!ready) return;
    const none = await request(app).post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(adminTok)).send({ reviewerIds: [] });
    expect(none.status).toBe(400);
  });

  it('admin assigns reviewers → submission moves to FINAL_REVIEW', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(adminTok)).send({ reviewerIds: [rev1Id, rev2Id] });
    expect(res.status).toBe(201);
    expect(res.body.reviewers).toHaveLength(2);

    const sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.status).toBe('FINAL_REVIEW');
  });

  it('a non-assigned user cannot cast a final-review vote (403)', async () => {
    if (!ready || !outsiderTok) return;
    const res = await request(app).post(`/api/appraisals/${subId}/final-review`)
      .set(bearer(outsiderTok)).send({ decision: 'APPROVED' });
    expect(res.status).toBe(403);
  });

  it('a single approval finalises the appraisal → APPROVED, without the second reviewer', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/appraisals/${subId}/final-review`)
      .set(bearer(rev1Tok)).send({ decision: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('APPROVED');

    const sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.status).toBe('APPROVED');

    // The other assigned reviewer never acted and is not required to.
    const other = await prisma.finalReview.findFirst({ where: { submissionId: subId, reviewerId: rev2Id } });
    expect(other!.decision).toBe('PENDING');
  });

  it('a rejection sends the appraisal back to HOLD with the reason', async () => {
    if (!ready) return;
    // Re-open the final-review round.
    await prisma.appraisalSubmission.update({ where: { id: subId }, data: { status: 'FINAL_REVIEW' } });
    await prisma.finalReview.updateMany({
      where: { submissionId: subId }, data: { decision: 'PENDING', comment: null, decidedAt: null },
    });

    const noComment = await request(app).post(`/api/appraisals/${subId}/final-review`)
      .set(bearer(rev1Tok)).send({ decision: 'REJECTED' });
    expect(noComment.status).toBe(400); // a reason is required

    const res = await request(app).post(`/api/appraisals/${subId}/final-review`)
      .set(bearer(rev1Tok)).send({ decision: 'REJECTED', comment: 'Insufficient evidence' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('HOLD');

    const sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.status).toBe('HOLD');
    expect(sub!.holdReason).toBe('Insufficient evidence');
  });

  it('a reviewer from another department can review and view the appraisal', async () => {
    if (!ready) return;
    // This reviewer belongs to another department, so the submission's faculty
    // is not theirs to see — it only works because the dean assigned them.
    await prisma.appraisalSubmission.update({ where: { id: subId }, data: { status: 'APPROVED' } });
    const assign = await request(app).post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(adminTok)).send({ reviewerIds: [outsiderId] });
    expect(assign.status).toBe(201);

    // Cross-department read access comes from the assignment alone.
    const view = await request(app).get(`/api/appraisals/${subId}`).set(bearer(outsiderTok));
    expect(view.status).toBe(200);

    const res = await request(app).post(`/api/appraisals/${subId}/final-review`)
      .set(bearer(outsiderTok)).send({ decision: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('APPROVED');

    // Restore the two-reviewer assignment for the following test.
    await prisma.appraisalSubmission.update({ where: { id: subId }, data: { status: 'APPROVED' } });
    await request(app).post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(adminTok)).send({ reviewerIds: [rev1Id, rev2Id] });
  });

  it('an assigned reviewer sees the submission in their pending queue', async () => {
    if (!ready) return;
    await prisma.appraisalSubmission.update({ where: { id: subId }, data: { status: 'FINAL_REVIEW' } });
    await prisma.finalReview.updateMany({
      where: { submissionId: subId }, data: { decision: 'PENDING', comment: null, decidedAt: null },
    });

    const res = await request(app).get('/api/final-reviews/pending').set(bearer(rev2Tok));
    expect(res.status).toBe(200);
    expect(res.body.some((r: any) => r.submission.id === subId)).toBe(true);
  });
});
