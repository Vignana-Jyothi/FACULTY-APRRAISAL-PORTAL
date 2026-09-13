import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { voidExpiredProofs } from '../cron/proofDeadline';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// A rejected proof that is never replaced would otherwise stall the appraisal
// forever, because the HoD cannot approve while any proof is unverified. Once
// the correction deadline passes the source is voided — its rows score nothing
// — and the review proceeds on the reduced marks. The faculty stays red-listed.
//
// Self-skips without a database. Owns its department, its faculty and its HoD,
// so an aborted run cannot leave a submission on a shared seed account.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let hodTok = '';
let faculty: FixtureUser;
let subId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('PDL');
    faculty = await fixture.addUser({ name: 'FAC' });
    const hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' });
    hodTok = hod.token;
    if (!hodTok || !faculty.token) return;

    // A journal with a proof URL, plus a conference that keeps its marks.
    subId = await fixture.createSubmission(faculty, {
      status: 'SUBMITTED',
      cat2Journals: { create: [{
        title: 'Deadline Paper', journalName: 'IEEE', authors: faculty.employeeCode, authorPosition: 'First',
        indexed: 'WOS', impactFactor: 2, volume: '1', issueNo: '1', pageNos: '1-9',
        dateOfPub: new Date('2026-01-01'), quartile: 'Q1', proofFile: 'https://example.com/bad-proof.pdf',
      }] },
    });
    ready = true;
  } catch { ready = false; }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('proof correction deadline', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(subId).not.toBe('');
  });

  it('voids the source, unblocks approval, and keeps the faculty red-listed', async () => {
    if (!ready) return;

    const scoreBefore = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(hodTok));
    expect(scoreBefore.status).toBe(200);
    expect(scoreBefore.body.cat2.publications).toBeGreaterThan(0);

    // HoD rejects the journal's proof -> HOLD + red list + a deadline.
    const proofs = await request(app).get(`/api/appraisals/${subId}/proofs`).set(bearer(hodTok));
    expect(proofs.status).toBe(200);
    const target = (proofs.body.proofs ?? proofs.body).find((p: any) => /Journals/.test(p.section));
    expect(target).toBeTruthy();

    const reject = await request(app).post(`/api/appraisals/${subId}/proofs/verify`)
      .set(bearer(hodTok)).send({ url: target.url, status: 'REJECTED', comment: 'wrong document' });
    expect(reject.status).toBe(200);

    let sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.status).toBe('HOLD');
    expect(sub!.redListed).toBe(true);
    expect(sub!.proofDeadlineAt).toBeTruthy();

    // Approval is blocked while the deadline has not passed.
    const blocked = await request(app).post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok)).send({ status: 'APPROVED' });
    expect(blocked.status).toBe(400);

    // Nothing is due yet.
    await voidExpiredProofs(new Date(sub!.proofDeadlineAt!.getTime() - 60_000), { submissionIds: [subId] });
    sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.voidedSources).toEqual([]);
    expect(sub!.status).toBe('HOLD');

    // Deadline passes.
    await voidExpiredProofs(new Date(sub!.proofDeadlineAt!.getTime() + 60_000), { submissionIds: [subId] });
    sub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(sub!.voidedSources).toContain('cat2Journals');
    expect(sub!.status).toBe('SUBMITTED');
    // The whole point: unblocked, but still on the red list.
    expect(sub!.redListed).toBe(true);

    // Marks for that source are gone...
    const scoreAfter = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(hodTok));
    expect(scoreAfter.body.cat2.publications).toBe(0);
    expect(scoreAfter.body.selfTotal).toBeLessThan(scoreBefore.body.selfTotal);

    // ...and the HoD can now approve on the reduced marks.
    const approved = await request(app).post(`/api/appraisals/${subId}/review`)
      .set(bearer(hodTok)).send({ status: 'APPROVED' });
    expect(approved.status).toBe(200);

    const finalSub = await prisma.appraisalSubmission.findUnique({ where: { id: subId } });
    expect(finalSub!.redListed).toBe(true);
  });
});
