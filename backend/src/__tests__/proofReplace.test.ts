import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { voidExpiredProofs } from '../cron/proofDeadline';
import { syncProofVerifications } from '../services/proofService';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// A faculty whose proof was rejected may replace it while the appraisal is on
// hold and the correction deadline has not passed. The corrected proof goes
// back to PENDING and, once nothing rejected is left, the appraisal goes back
// to the review queue. A proof still rejected at the deadline costs its
// subsection the marks.
//
// The rejection is staged directly in the database rather than through the
// verify endpoint, so a run sends no rejection email. Self-skips without a
// database; owns its department, faculty and HoD.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const BAD = 'https://example.com/bad-proof.pdf';
const GOOD = 'https://example.com/corrected-proof.pdf';

let ready = false;
let fixture: Fixture | null = null;
let faculty: FixtureUser;
let hodTok = '';
let subId = '';

async function stageRejection(url: string, deadline: Date) {
  await syncProofVerifications(subId);
  await prisma.proofVerification.update({
    where: { submissionId_url: { submissionId: subId, url } },
    data: { status: 'REJECTED', comment: 'wrong document' },
  });
  await prisma.appraisalSubmission.update({
    where: { id: subId },
    data: { status: 'HOLD', redListed: true, heldAt: new Date(), holdReason: 'Rejected proof', proofDeadlineAt: deadline },
  });
}

const replace = (tok: string, url: string, newUrl: string) =>
  request(app).post(`/api/appraisals/${subId}/proofs/replace`).set(bearer(tok)).send({ url, newUrl });

beforeAll(async () => {
  try {
    fixture = await createFixture('PRP');
    faculty = await fixture.addUser({ name: 'FAC' });
    const hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' });
    hodTok = hod.token;
    if (!hodTok || !faculty.token) return;

    subId = await fixture.createSubmission(faculty, {
      status: 'SUBMITTED',
      cat2Journals: { create: [{
        title: 'Replace Paper', journalName: 'IEEE', authors: faculty.employeeCode, authorPosition: 'First',
        indexed: 'WOS', allAuthorsFromCampus: false, impactFactor: 2, volume: '1', issueNo: '1', pageNos: '1-9',
        dateOfPub: new Date('2026-01-01'), quartile: 'Q1', proofFile: BAD,
      }] },
    });
    ready = true;
  } catch { ready = false; }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('replacing a rejected proof', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(subId).not.toBe('');
  });

  it('lets only the owner replace, and only with a real proof', async () => {
    if (!ready) return;
    await stageRejection(BAD, new Date(Date.now() + 7 * 86_400_000));

    expect((await replace(hodTok, BAD, GOOD)).status).toBe(403);
    expect((await replace(faculty.token, BAD, 'not a link')).status).toBe(400);
    // An upload path the faculty never uploaded.
    expect((await replace(faculty.token, BAD, '/uploads/file/someone-elses.pdf')).status).toBe(400);
  });

  it('swaps the proof in place, back to PENDING and back in the queue, still red-listed', async () => {
    if (!ready) return;
    const before = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(hodTok));

    const res = await replace(faculty.token, BAD, GOOD);
    expect(res.status).toBe(200);

    const row = await prisma.cat2Journal.findFirst({ where: { submissionId: subId } });
    expect(row!.proofFile).toBe(GOOD);
    const pvs = await prisma.proofVerification.findMany({ where: { submissionId: subId } });
    expect(pvs.map((p) => [p.url, p.status])).toEqual([[GOOD, 'PENDING']]);

    const sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.status).toBe('SUBMITTED');
    expect(sub!.redListed).toBe(true); // the HoD clears the red list, not the faculty
    expect(sub!.voidedSources).toEqual([]);

    // The faculty can read their own proof list (it drives their card).
    expect((await request(app).get(`/api/appraisals/${subId}/proofs`).set(bearer(faculty.token))).status).toBe(200);

    // Nothing rejected any more, so another replacement is refused.
    expect((await replace(faculty.token, GOOD, 'https://example.com/other.pdf')).status).toBe(400);

    const after = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(hodTok));
    expect(after.body.cat2.publications).toBe(before.body.cat2.publications);
  });

  it('refuses a replacement after the deadline, and the deadline cuts the marks', async () => {
    if (!ready) return;
    const past = new Date(Date.now() - 60_000);
    await stageRejection(GOOD, past);

    expect((await replace(faculty.token, GOOD, 'https://example.com/late.pdf')).status).toBe(400);

    await voidExpiredProofs(new Date(past.getTime() + 1_000), { submissionIds: [subId] });
    const sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.voidedSources).toContain('cat2Journals');
    expect(sub!.redListed).toBe(true);

    const score = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(hodTok));
    expect(score.body.cat2.publications).toBe(0);
  });
});
