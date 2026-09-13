import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// Proofs are verified between submission and the decision. Rejecting a proof
// on a DRAFT used to flip the draft to HOLD (locking the faculty out of their
// own form), red-list them and email them — before they had submitted.
//
// Only VERIFIED is exercised on an open submission, so a run queues no mail.
// Owns its department, faculty and HoD.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const PROOF = 'https://example.com/status-proof.pdf';

let ready = false;
let fixture: Fixture | null = null;
let faculty: FixtureUser;
let hodTok = '';
let subId = '';

const verify = (status: 'VERIFIED' | 'REJECTED') =>
  request(app).post(`/api/appraisals/${subId}/proofs/verify`).set(bearer(hodTok)).send({ url: PROOF, status, comment: 'probe' });

const setStatus = (status: 'DRAFT' | 'SUBMITTED' | 'APPROVED') =>
  prisma.appraisalSubmission.update({ where: { id: subId }, data: { status } });

beforeAll(async () => {
  try {
    fixture = await createFixture('PVS');
    faculty = await fixture.addUser({ name: 'FAC' });
    hodTok = (await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' })).token;
    if (!hodTok || !faculty.token) return;
    subId = await fixture.createSubmission(faculty, {
      status: 'DRAFT',
      cat2Journals: { create: [{
        title: 'Status Paper', journalName: 'IEEE', authors: faculty.employeeCode, authorPosition: 'First',
        indexed: 'WOS', impactFactor: 2, volume: '1', issueNo: '1', pageNos: '1-9',
        dateOfPub: new Date('2026-01-01'), quartile: 'Q1', proofFile: PROOF,
      }] },
    });
    ready = true;
  } catch { ready = false; }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('proof verification only runs while the appraisal is under review', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });

  it('refuses to reject a proof on a DRAFT — no hold, no red list, no mail', async () => {
    if (!ready) return;
    const res = await verify('REJECTED');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/submitted/i);

    const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } });
    expect(sub.status).toBe('DRAFT');
    expect(sub.redListed).toBe(false);
    expect(sub.heldAt).toBeNull();
    expect(await prisma.emailNotification.count({ where: { toUserId: faculty.id, template: 'proof_rejected' } })).toBe(0);
  });

  it('refuses to change a proof on a decided appraisal', async () => {
    if (!ready) return;
    await setStatus('APPROVED');
    expect((await verify('REJECTED')).status).toBe(400);
    expect((await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } })).status).toBe('APPROVED');
  });

  it('verifies a proof once the appraisal is submitted', async () => {
    if (!ready) return;
    await setStatus('SUBMITTED');
    const res = await verify('VERIFIED');
    expect(res.status).toBe(200);
    const pv = await prisma.proofVerification.findFirstOrThrow({ where: { submissionId: subId, url: PROOF } });
    expect(pv.status).toBe('VERIFIED');
  });
});
