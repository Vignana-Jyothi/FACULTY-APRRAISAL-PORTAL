import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// Proofs are checked on the draft during the year and through the review, up
// to the decision (owner decision 2026-09-19). Rejecting a proof on a DRAFT
// used to flip the draft to HOLD (locking the faculty out of their own form)
// and red-list them; now it only marks the proof and emails the faculty
// (@fixture.invalid — never delivered). Owns its department, faculty and HoD.

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
        indexed: 'WOS', allAuthorsFromCampus: false, impactFactor: 2, volume: '1', issueNo: '1', pageNos: '1-9',
        dateOfPub: new Date('2026-01-01'), quartile: 'Q1', proofFile: PROOF,
      }] },
    });
    ready = true;
  } catch { ready = false; }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('proof verification runs on the draft and until the decision', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });

  it('rejects a proof on a DRAFT without holding it — no hold, no red list, the faculty is told', async () => {
    if (!ready) return;
    const res = await verify('REJECTED');
    expect(res.status).toBe(200);

    const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } });
    expect(sub.status).toBe('DRAFT');
    expect(sub.redListed).toBe(false);
    expect(sub.heldAt).toBeNull();
    expect(sub.proofDeadlineAt).toBeNull();
    expect(await prisma.emailNotification.count({ where: { toUserId: faculty.id, template: 'proof_rejected' } })).toBe(1);
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
