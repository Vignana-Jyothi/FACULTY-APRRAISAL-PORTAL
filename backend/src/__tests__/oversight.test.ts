import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// GET /oversight/summary — the dean + principal status board (owner decision
// 2026-09-19). It is institute-wide, so the counts include whatever else is in
// the dev database; the assertions check this suite's own rows and compare the
// averages against the database rather than hard-coding them.
//
// The Cat 6 rule: the principal gets the average /550 grand total, the dean the
// average reviewed /500 — and the dean's payload must carry no /550 figure.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const round1 = (n: number | null | undefined) => (typeof n === 'number' ? Math.round(n * 10) / 10 : null);

let ready = false;
let fixture: Fixture | null = null;
let principal: FixtureUser, dean: FixtureUser, admin: FixtureUser, hod: FixtureUser, fac: FixtureUser;
let scrutinizer: FixtureUser;
let finalSubId = '', finalReviewId = '', yearId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('OVS');
    principal = await fixture.addUser({ name: 'PRN', role: RoleType.PRINCIPAL });
    dean = await fixture.addUser({ name: 'DEA', role: RoleType.DEAN });
    admin = await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN });
    hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' });
    fac = await fixture.addUser({ name: 'FC1', role: RoleType.FACULTY });
    const fac2 = await fixture.addUser({ name: 'FC2', role: RoleType.FACULTY });
    scrutinizer = await fixture.addUser({ name: 'SCR', role: RoleType.SCRUTINIZER });
    if (![principal, dean, admin, hod, fac, scrutinizer].every((u) => u.token)) return;

    yearId = (await prisma.academicYear.findFirstOrThrow({
      where: { submissionOpen: true }, orderBy: { startDate: 'desc' },
    })).id;

    // HoD-approved, waiting on the scrutinizer.
    finalSubId = await fixture.createSubmission(fac, { status: 'FINAL_REVIEW', submittedAt: new Date() });
    await prisma.appraisalReview.create({
      data: {
        submissionId: finalSubId, reviewerId: hod.id, reviewerRole: 'HOD', status: 'FINAL_REVIEW',
        totalScore: 431.5, grandTotal: 478.5, cat6Punctuality: 9, cat6Professionalism: 9,
        cat6Willingness: 9, cat6Cordiality: 10, cat6Classroom: 10,
      },
    });
    finalReviewId = (await prisma.finalReview.create({
      data: { submissionId: finalSubId, reviewerId: scrutinizer.id, assignedById: dean.id },
    })).id;

    // Red-listed, on hold.
    await fixture.createSubmission(fac2, { status: 'HOLD', redListed: true, submittedAt: new Date() });

    // Tier + eligibility decided for one faculty, not the other.
    await prisma.facultyTier.create({
      data: { userId: fac.id, academicYearId: yearId, tier: 'T1', eligible: true, assignedById: dean.id },
    });
    ready = true;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('oversight summary', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(finalReviewId).not.toBe('');
  });

  it('is closed to the admin, a HoD, a scrutinizer and a faculty member (403)', async () => {
    if (!ready) return;
    for (const u of [admin, hod, scrutinizer, fac]) {
      const res = await request(app).get('/api/oversight/summary').set(bearer(u.token));
      expect(res.status).toBe(403);
    }
  });

  it('404s for an unknown academic year', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/oversight/summary?academicYearId=nope').set(bearer(dean.token));
    expect(res.status).toBe(404);
  });

  it('lists the pending final review with faculty and scrutinizer names', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/oversight/summary').set(bearer(dean.token));
    expect(res.status).toBe(200);
    expect(res.body.year.id).toBe(yearId);
    const row = res.body.finalReviews.pending.find((p: any) => p.id === finalReviewId);
    expect(row).toBeTruthy();
    expect(row.submission.id).toBe(finalSubId);
    expect(row.faculty.name).toBe(fac.name);
    expect(row.scrutinizer.name).toBe(scrutinizer.name);
    expect(res.body.finalReviews.pendingCount).toBeGreaterThanOrEqual(1);
  });

  it('counts statuses, red-listing and tier/eligibility allocation', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/oversight/summary').set(bearer(dean.token));
    const b = res.body;
    expect(b.submissions.byStatus.FINAL_REVIEW).toBeGreaterThanOrEqual(1);
    expect(b.submissions.byStatus.HOLD).toBeGreaterThanOrEqual(1);
    const sum = Object.values(b.submissions.byStatus as Record<string, number>).reduce((a, n) => a + n, 0);
    expect(sum).toBe(b.submissions.total);
    expect(b.redListed).toBeGreaterThanOrEqual(1);
    expect(b.allocation.tier.decided + b.allocation.tier.undecided).toBe(b.allocation.faculty);
    expect(b.allocation.eligibility.decided + b.allocation.eligibility.undecided).toBe(b.allocation.faculty);
    expect(b.allocation.tier.decided).toBeGreaterThanOrEqual(1);
    expect(b.allocation.tier.undecided).toBeGreaterThanOrEqual(1); // FC2
    expect(b.allocation.eligibility.eligible).toBeGreaterThanOrEqual(1);
  });

  it('the principal gets the average grand total /550', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/oversight/summary').set(bearer(principal.token));
    expect(res.status).toBe(200);
    const agg = await prisma.appraisalReview.aggregate({
      where: { submission: { academicYearId: yearId }, grandTotal: { not: null } },
      _avg: { grandTotal: true },
    });
    expect(res.body.averageScore.outOf).toBe(550);
    expect(res.body.averageScore.value).toBe(round1(agg._avg.grandTotal));
  });

  it('the dean payload carries no /550 figure, only the reviewed /500', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/oversight/summary').set(bearer(dean.token));
    expect(res.status).toBe(200);
    const agg = await prisma.appraisalReview.aggregate({
      where: { submission: { academicYearId: yearId }, totalScore: { not: null } },
      _avg: { totalScore: true, grandTotal: true },
    });
    expect(res.body.averageScore.outOf).toBe(500);
    expect(res.body.averageScore.value).toBe(round1(agg._avg.totalScore));

    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/grandTotal/i);
    expect(json).not.toMatch(/cat6/i);
    // No 550 as a number anywhere (ids are hex, so match values, not substrings).
    expect(json).not.toMatch(/[:[,]550(\.\d+)?[,}\]]/);
    // Nor the grand-total average itself, under any key.
    const grandAvg = round1(agg._avg.grandTotal);
    if (grandAvg != null && grandAvg !== res.body.averageScore.value) {
      expect(json).not.toContain(`:${grandAvg}`);
    }
  });
});
