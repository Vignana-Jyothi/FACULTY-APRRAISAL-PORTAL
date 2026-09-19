import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { submitOpensAt, dayAfterInIndia } from '../services/submitGate';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';
import { submitAt, submitAfterGate } from './helpers/submitGate';

// Draft carries over the year (owner decisions 2026-09-19,
// docs/superpowers/plans/draft-carryover.md):
//  - submit opens only when the Q4 review window ends (else the AY end);
//  - the department checks proofs on the DRAFT; a reject there marks the proof
//    and emails the faculty — no hold, no red list, no deadline;
//  - the HoD notes a provisional DraftReview that pre-fills the real review.
//
// Owns every user (all @fixture.invalid). Review windows are created only on
// this suite's own closed, far-future academic years — never on the open one.
// The submit gate on the real open year is crossed by moving this process's
// clock (helpers/submitGate), not by touching its windows.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const P_MAIN = 'https://example.com/dco-main.pdf';
const P_INDEX = 'https://example.com/dco-index.pdf';
const P_NEW = 'https://example.com/dco-index-v2.pdf';

let ready = false;
let fixture: Fixture | null = null;
let faculty: FixtureUser;
let hod: FixtureUser;
let incharge: FixtureUser;
let otherHod: FixtureUser;
let dean: FixtureUser;
let principal: FixtureUser;
let subId = '';
const yearIds: string[] = [];

const journal = (indexProof: string) => ({
  title: 'Carryover Paper', journalName: 'IEEE', authors: 'DCO Faculty', authorPosition: 'First',
  indexed: 'WOS', allAuthorsFromCampus: false, impactFactor: 2, volume: '1', issueNo: '1', pageNos: '1-9',
  dateOfPub: '2026-01-01', quartile: 'Q1', proofFile: P_MAIN, indexProofFile: indexProof,
});

const verify = (tok: string, url: string, status: 'VERIFIED' | 'REJECTED', comment?: string) =>
  request(app).post(`/api/appraisals/${subId}/proofs/verify`).set(bearer(tok)).send({ url, status, comment });
const putDR = (tok: string, body: Record<string, unknown>) =>
  request(app).put(`/api/appraisals/${subId}/draft-review`).set(bearer(tok)).send(body);
const getDR = (tok: string) => request(app).get(`/api/appraisals/${subId}/draft-review`).set(bearer(tok));
const proofRow = (url: string) => prisma.proofVerification.findFirst({ where: { submissionId: subId, url } });

async function throwawayYear(tag: string) {
  // Closed (submissionOpen false) and a century out, so nothing else picks it
  // up and no daily job has a window ending today.
  const y = await prisma.academicYear.create({
    data: { label: `DCO-${tag}-${Date.now()}`, startDate: new Date('2099-07-01'), endDate: new Date('2100-06-30') },
  });
  yearIds.push(y.id);
  return y.id;
}

beforeAll(async () => {
  try {
    fixture = await createFixture('DCO');
    faculty = await fixture.addUser({ name: 'FAC', role: RoleType.FACULTY });
    hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' });
    incharge = await fixture.addUser({ name: 'INC', role: RoleType.REVIEWER });
    const other = await fixture.addDepartment('DCX');
    otherHod = await fixture.addUser({ name: 'OHD', role: RoleType.HOD, deptId: other });
    dean = await fixture.addUser({ name: 'DEA', role: RoleType.DEAN });
    principal = await fixture.addUser({ name: 'PRI', role: RoleType.PRINCIPAL });
    if (![faculty, hod, incharge, otherHod, dean, principal].every((u) => u.token)) return;

    subId = await fixture.createSubmission(faculty, {
      status: 'DRAFT',
      cat2Journals: { create: [{ ...journal(P_INDEX), dateOfPub: new Date('2026-01-01') }] },
    });
    ready = true;
  } catch (e) {
    console.error(e);
    ready = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
  for (const id of yearIds) {
    await prisma.reviewWindow.deleteMany({ where: { academicYearId: id } });
    await prisma.academicYear.deleteMany({ where: { id } });
  }
});

describe('draft carries over the year', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });

  describe('when submission opens', () => {
    it('is the academic year end when no Q4 window is configured', async () => {
      const y = await throwawayYear('NOQ4');
      expect((await submitOpensAt(y))!.toISOString()).toBe(dayAfterInIndia(new Date('2100-06-30')).toISOString());
    });

    it('is the enabled Q4 window end when there is one', async () => {
      const y = await throwawayYear('Q4');
      await prisma.reviewWindow.create({
        data: { academicYearId: y, quarter: 'Q4', startDate: new Date('2100-04-01'), endDate: new Date('2100-05-15') },
      });
      expect((await submitOpensAt(y))!.toISOString()).toBe(dayAfterInIndia(new Date('2100-05-15')).toISOString());
    });

    it('falls back to the academic year end when the Q4 window is disabled', async () => {
      const y = await throwawayYear('OFF');
      await prisma.reviewWindow.create({
        data: { academicYearId: y, quarter: 'Q4', enabled: false, startDate: new Date('2100-04-01'), endDate: new Date('2100-05-15') },
      });
      expect((await submitOpensAt(y))!.toISOString()).toBe(dayAfterInIndia(new Date('2100-06-30')).toISOString());
    });

    it('is exposed on the appraisal payload', async () => {
      if (!ready) return;
      const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } });
      const res = await request(app).get(`/api/appraisals/${subId}`).set(bearer(faculty.token));
      expect(res.status).toBe(200);
      expect(res.body.submitOpensAt).toBe((await submitOpensAt(sub.academicYearId))!.toISOString());
    });
  });

  describe('proofs on the draft', () => {
    it('the department HoD verifies a proof on a draft', async () => {
      if (!ready) return;
      const res = await verify(hod.token, P_MAIN, 'VERIFIED');
      expect(res.status).toBe(200);
      expect((await proofRow(P_MAIN))!.status).toBe('VERIFIED');
    });

    it('another department\'s HoD and the owner cannot', async () => {
      if (!ready) return;
      expect((await verify(otherHod.token, P_INDEX, 'VERIFIED')).status).toBe(403);
      expect((await verify(faculty.token, P_INDEX, 'VERIFIED')).status).toBe(403);
    });

    it('the incharge rejects a proof: REJECTED + reason, the faculty is emailed, the draft is not held', async () => {
      if (!ready) return;
      const res = await verify(incharge.token, P_INDEX, 'REJECTED', 'index page missing');
      expect(res.status).toBe(200);

      const pv = await proofRow(P_INDEX);
      expect(pv!.status).toBe('REJECTED');
      expect(pv!.comment).toBe('index page missing');

      const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } });
      expect(sub.status).toBe('DRAFT');
      expect(sub.redListed).toBe(false);
      expect(sub.heldAt).toBeNull();
      expect(sub.proofDeadlineAt).toBeNull();

      const mail = await prisma.emailNotification.findMany({ where: { toUserId: faculty.id, template: 'proof_rejected' } });
      expect(mail).toHaveLength(1);
      expect((mail[0].payload as any).draft).toBe(true);
      // Nothing is red-listed, so no HoD red-list notice.
      expect(await prisma.emailNotification.count({ where: { toUserId: hod.id, template: 'proof_rejected_hod' } })).toBe(0);
    });

    it('the owner reads their own proof statuses, reason included', async () => {
      if (!ready) return;
      const res = await request(app).get(`/api/appraisals/${subId}/proofs`).set(bearer(faculty.token));
      expect(res.status).toBe(200);
      const byUrl = new Map(res.body.proofs.map((p: any) => [p.url, p]));
      expect((byUrl.get(P_MAIN) as any).status).toBe('VERIFIED');
      expect((byUrl.get(P_INDEX) as any).status).toBe('REJECTED');
      expect((byUrl.get(P_INDEX) as any).comment).toBe('index page missing');
    });

    it('replacing the proof in the draft makes a new pending row; the verified one is untouched', async () => {
      if (!ready) return;
      const save = await request(app).put(`/api/appraisals/${subId}`).set(bearer(faculty.token))
        .send({ categories: { cat2Journals: [journal(P_NEW)] } });
      expect(save.status).toBe(200);

      const res = await request(app).get(`/api/appraisals/${subId}/proofs`).set(bearer(hod.token));
      expect(res.status).toBe(200);
      const urls = res.body.proofs.map((p: any) => p.url);
      expect(urls).not.toContain(P_INDEX);
      expect(res.body.proofs.find((p: any) => p.url === P_NEW).status).toBe('PENDING');
      expect(res.body.proofs.find((p: any) => p.url === P_MAIN).status).toBe('VERIFIED');
    });
  });

  describe('drafts in progress', () => {
    it('the HoD finds the draft with its proof counts; another department does not', async () => {
      if (!ready) return;
      const mine = await request(app).get('/api/reviews/drafts').set(bearer(hod.token));
      expect(mine.status).toBe(200);
      const row = mine.body.find((r: any) => r.submissionId === subId);
      expect(row).toBeTruthy();
      expect(row.counts).toEqual({ total: 2, verified: 1, rejected: 0, pending: 1 });
      expect(row.faculty.id).toBe(faculty.id);

      const theirs = await request(app).get('/api/reviews/drafts').set(bearer(otherHod.token));
      expect(theirs.status).toBe(200);
      expect(theirs.body.find((r: any) => r.submissionId === subId)).toBeUndefined();

      expect((await request(app).get('/api/reviews/drafts').set(bearer(faculty.token))).status).toBe(403);
    });
  });

  describe('draft review', () => {
    it('the department HoD saves it, clamped to each maximum, with an audit row', async () => {
      if (!ready) return;
      const res = await putDR(hod.token, {
        cat1Score: 999, cat2Score: 40, cat3Score: -5, cat4Score: 20, cat5Score: null,
        cat6Punctuality: 15, cat6Professionalism: 8, cat6Willingness: 7, cat6Cordiality: 9, cat6Classroom: 6,
        overallComment: 'Provisional — strong research',
      });
      expect(res.status).toBe(200);
      expect(res.body.cat1Score).toBe(150);
      expect(res.body.cat3Score).toBe(0);
      expect(res.body.cat5Score).toBeNull();
      expect(res.body.cat6Punctuality).toBe(10);
      expect(await prisma.auditLog.count({ where: { action: 'DRAFT_REVIEW_SAVED', entityId: subId } })).toBe(1);
    });

    it('nobody else may write it: incharge, other-department HoD, owner, dean, principal', async () => {
      if (!ready) return;
      for (const u of [incharge, otherHod, faculty, dean, principal]) {
        expect((await putDR(u.token, { cat1Score: 1 })).status).toBe(403);
      }
      expect((await prisma.draftReview.findUniqueOrThrow({ where: { submissionId: subId } })).cat1Score).toBe(150);
    });

    it('is read whole by the HoD, incharge and principal; without Cat 6 by the dean; never by the owner', async () => {
      if (!ready) return;
      for (const u of [hod, incharge, principal]) {
        const r = await getDR(u.token);
        expect(r.status).toBe(200);
        expect(r.body.cat6Punctuality).toBe(10);
        expect(r.body.cat2Score).toBe(40);
      }
      const d = await getDR(dean.token);
      expect(d.status).toBe(200);
      expect(d.body.cat2Score).toBe(40);
      for (const f of ['cat6Punctuality', 'cat6Professionalism', 'cat6Willingness', 'cat6Cordiality', 'cat6Classroom']) {
        expect(d.body[f]).toBeUndefined();
      }
      expect((await getDR(faculty.token)).status).toBe(403);
      expect((await getDR(otherHod.token)).status).toBe(403);
      // Nor does it ride along on the owner's own appraisal payload.
      const own = await request(app).get(`/api/appraisals/${subId}`).set(bearer(faculty.token));
      expect(own.body.draftReview).toBeUndefined();
    });
  });

  describe('submission', () => {
    it('is refused before the Q4 review window ends, naming the date', async () => {
      if (!ready) return;
      const { res } = await submitAt(subId, faculty.id, -60_000);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Submission opens on/);
      expect(res.body.submitOpensAt).toBeTruthy();
      expect((await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } })).status).toBe('DRAFT');
    });

    it('is refused now, on the live clock (the Q4 window has not ended)', async () => {
      if (!ready) return;
      const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } });
      const opensAt = (await submitOpensAt(sub.academicYearId))!;
      const res = await request(app).post(`/api/appraisals/${subId}/submit`).set(bearer(faculty.token));
      if (opensAt.getTime() > Date.now()) expect(res.status).toBe(400);
      else expect(res.status).toBe(200);
      if (res.status === 200) {
        // Already past the gate in this database: put it back for the next case.
        await prisma.appraisalSubmission.update({ where: { id: subId }, data: { status: 'DRAFT', submittedAt: null } });
      }
    });

    it('is allowed once it ends, and verified proofs carry into the submission', async () => {
      if (!ready) return;
      const { res } = await submitAfterGate(subId, faculty.id);
      expect(res.status).toBe(200);
      expect((await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } })).status).toBe('SUBMITTED');
      expect((await proofRow(P_MAIN))!.status).toBe('VERIFIED');
      expect((await proofRow(P_NEW))!.status).toBe('PENDING');
    });

    it('the draft review can no longer be written once submitted', async () => {
      if (!ready) return;
      const res = await putDR(hod.token, { cat1Score: 10 });
      expect(res.status).toBe(400);
    });

    it('the final review page still reads the draft review to seed from', async () => {
      if (!ready) return;
      const r = await getDR(hod.token);
      expect(r.status).toBe(200);
      expect(r.body.cat1Score).toBe(150);
      expect(r.body.cat6Punctuality).toBe(10);
      expect(r.body.overallComment).toBe('Provisional — strong research');
    });

    it('rejecting a proof after submission still holds and red-lists (unchanged)', async () => {
      if (!ready) return;
      const res = await verify(hod.token, P_NEW, 'REJECTED', 'still wrong');
      expect(res.status).toBe(200);
      const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } });
      expect(sub.status).toBe('HOLD');
      expect(sub.redListed).toBe(true);
      expect(sub.proofDeadlineAt).toBeTruthy();
    });
  });
});
