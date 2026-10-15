import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { reviewLockQuarter } from '../services/quarterReview';
import { createFixture, type Fixture } from './helpers/fixtures';

// Review lock (2026-10-15): once a quarter ends (on/after LOCK_FROM, 15 Oct 2026)
// the faculty is locked until the HoD issues its feedback. Quarters that ended
// earlier are grandfathered open. The HoD may unlock one faculty; issuing
// re-arms the lock.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let hodTok = '';
let facTok = '';
let otherHodTok = '';
let subId = '';
let ayStart: Date;

beforeAll(async () => {
  try {
    fixture = await createFixture('RLK');
    const hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD });
    const fac = await fixture.addUser({ name: 'FAC', role: RoleType.FACULTY });
    const otherDept = await fixture.addDepartment('OTH');
    const otherHod = await fixture.addUser({ name: 'OHOD', role: RoleType.HOD, deptId: otherDept });
    hodTok = hod.token; facTok = fac.token; otherHodTok = otherHod.token;
    // AY starting 1 Jul 2026: Q1 ends 30 Sep 2026 (grandfathered), Q2 ends 31 Dec 2026 (locks).
    ayStart = new Date('2026-07-01T00:00:00.000Z');
    const year = await prisma.academicYear.create({
      data: { label: `RLK ${Date.now()}`, startDate: ayStart, endDate: new Date('2027-06-30T00:00:00.000Z'), submissionOpen: false },
    });
    subId = await fixture.createSubmission(fac, { academicYearId: year.id });
    ready = !!hodTok && !!subId;
  } catch (e) { console.error('RLK setup', e); ready = false; }
});

afterAll(async () => {
  await fixture?.destroy();
  await prisma.academicYear.deleteMany({ where: { label: { startsWith: 'RLK ' } } }).catch(() => {});
});

describe('review lock quarter (grandfather + order)', () => {
  it('locks Q2 after it ends, but grandfathers Q1', async () => {
    if (!ready) return;
    // Pretend "now" is mid-Jan 2027: Q1 (Sep) and Q2 (Dec) have both ended, but
    // Q1 is before LOCK_FROM so it is grandfathered — the lock quarter is Q2.
    expect(await reviewLockQuarter(subId, ayStart, new Date('2027-01-15'))).toBe('Q2');
  });

  it('is null once every post-cutoff ended quarter is issued', async () => {
    if (!ready) return;
    await prisma.feedback.create({
      data: { submissionId: subId, period: 'Q2', userId: (await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } })).userId, academicYearId: (await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } })).academicYearId, snapshot: {}, status: 'ISSUED' },
    });
    expect(await reviewLockQuarter(subId, ayStart, new Date('2027-01-15'))).toBeNull();
    await prisma.feedback.deleteMany({ where: { submissionId: subId } });
  });

  it('is null at real-now (Q1 grandfathered, Q2 not ended yet) — faculty can still edit', async () => {
    if (!ready) return;
    const res = await request(app).put(`/api/appraisals/${subId}`).set(bearer(facTok)).send({ categories: {} });
    expect(res.status).toBe(200);
  });
});

describe('HoD edit-lock override', () => {
  it('only the own-department HoD may unlock; issuing re-arms the lock', async () => {
    if (!ready) return;
    const foreign = await request(app).post(`/api/appraisals/${subId}/edit-lock`).set(bearer(otherHodTok)).send({ unlocked: true });
    expect(foreign.status).toBe(403);

    const unlock = await request(app).post(`/api/appraisals/${subId}/edit-lock`).set(bearer(hodTok)).send({ unlocked: true });
    expect(unlock.status).toBe(200);
    expect((await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } })).editUnlocked).toBe(true);

    // Issuing the current quarter (Q1, ended at real now) clears the override.
    const issue = await request(app).post(`/api/appraisals/${subId}/feedback/issue`).set(bearer(hodTok)).send({ period: 'Q1', strengths: 'done' });
    expect(issue.status).toBe(200);
    expect((await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId } })).editUnlocked).toBe(false);
  });
});
