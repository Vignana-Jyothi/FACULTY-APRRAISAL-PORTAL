import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Quarter, RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { runDueDeptReviewWindows } from '../cron/quarterlySnapshot';
import { createFixture, type Fixture } from './helpers/fixtures';

// W8b — per-department review windows: HoD sets a week inside the dean's quarter
// bounds, the department's drafts freeze during it, and the day AFTER it ends
// the department (only) gets its two quarterly mails. Owns its fixtures.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const dayMs = 24 * 60 * 60 * 1000;

let ready = false;
let fixture: Fixture | null = null;
let hodTok = '';
let facTok = '';
let facId = '';
let otherDeptId = '';
let yearId = '';
let subId = '';
const deanWindowIds: string[] = [];

beforeAll(async () => {
  try {
    fixture = await createFixture('DRW');
    const hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD });
    const fac = await fixture.addUser({ name: 'FAC' });
    hodTok = hod.token; facTok = fac.token; facId = fac.id;
    otherDeptId = await fixture.addDepartment('OTH');
    const year = await prisma.academicYear.findFirstOrThrow({ where: { submissionOpen: true } });
    yearId = year.id;
    subId = await fixture.createSubmission(fac);

    // Dean bounds: Q1 wide-and-active (covers now), Q2 wide (covers yesterday).
    for (const quarter of [Quarter.Q1, Quarter.Q2]) {
      const w = await prisma.reviewWindow.upsert({
        where: { academicYearId_quarter: { academicYearId: yearId, quarter } },
        create: { academicYearId: yearId, quarter, startDate: new Date(Date.now() - 30 * dayMs), endDate: new Date(Date.now() + 30 * dayMs), enabled: true },
        update: { startDate: new Date(Date.now() - 30 * dayMs), endDate: new Date(Date.now() + 30 * dayMs), enabled: true },
      });
      deanWindowIds.push(w.id);
    }
    ready = !!hodTok && !!facTok && !!yearId && !!subId;
  } catch (e) {
    console.error('DRW setup failed', e);
    ready = false;
  }
});

afterAll(async () => {
  if (facId) {
    await prisma.emailNotification.deleteMany({ where: { toUserId: facId } }).catch(() => {});
    await prisma.trackingSnapshot.deleteMany({ where: { userId: facId } }).catch(() => {});
  }
  // Dean windows hang off the real AY (not the fixture dept), so remove by id.
  for (const id of deanWindowIds) await prisma.reviewWindow.delete({ where: { id } }).catch(() => {});
  await fixture?.destroy(); // cascades the fixture dept's DeptReviewWindow rows
});

describe('W8b fixture', () => {
  it('has a working fixture', () => { expect(ready).toBe(true); });
});

describe('W8b access', () => {
  it('no token → 401', async () => {
    if (!ready) return;
    expect((await request(app).get('/api/dept-review-windows?academicYearId=' + yearId)).status).toBe(401);
  });
  it('faculty → 403', async () => {
    if (!ready) return;
    expect((await request(app).get('/api/dept-review-windows?academicYearId=' + yearId).set(bearer(facTok))).status).toBe(403);
  });
});

describe('W8b bounds', () => {
  it('HoD sets a window inside the dean bounds → 200', async () => {
    if (!ready) return;
    const res = await request(app).put('/api/dept-review-windows').set(bearer(hodTok)).send({
      academicYearId: yearId, departmentId: fixture!.deptId, quarter: 'Q1',
      startDate: new Date(Date.now() - dayMs).toISOString(), endDate: new Date(Date.now() + dayMs).toISOString(),
    });
    expect(res.status).toBe(200);
  });

  it('rejects a window that ends after the dean deadline → 400', async () => {
    if (!ready) return;
    const res = await request(app).put('/api/dept-review-windows').set(bearer(hodTok)).send({
      academicYearId: yearId, departmentId: fixture!.deptId, quarter: 'Q1',
      startDate: new Date(Date.now() - dayMs).toISOString(), endDate: new Date(Date.now() + 90 * dayMs).toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/within the dean/i);
  });

  it("rejects setting another department's window → 403", async () => {
    if (!ready) return;
    const res = await request(app).put('/api/dept-review-windows').set(bearer(hodTok)).send({
      academicYearId: yearId, departmentId: otherDeptId, quarter: 'Q1',
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + dayMs).toISOString(),
    });
    expect(res.status).toBe(403);
  });
});

describe('W8b freeze', () => {
  it('blocks a faculty edit while the dept window is active → 423', async () => {
    if (!ready) return;
    // Q1 window from the bounds test is active now (started yesterday, ends tomorrow).
    const res = await request(app).put(`/api/appraisals/${subId}`).set(bearer(facTok))
      .send({ categories: { cat1Courses: [] } });
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('REVIEW_WINDOW_FROZEN');
  });
});

describe('W8b day-after mail (per department)', () => {
  it('fires two mails for the dept the day after its window ends, once', async () => {
    if (!ready) return;
    // A Q2 window that ended yesterday → due today.
    await prisma.deptReviewWindow.upsert({
      where: { academicYearId_departmentId_quarter: { academicYearId: yearId, departmentId: fixture!.deptId, quarter: Quarter.Q2 } },
      create: { academicYearId: yearId, departmentId: fixture!.deptId, quarter: Quarter.Q2, startDate: new Date(Date.now() - 8 * dayMs), endDate: new Date(Date.now() - dayMs), enabled: true },
      update: { startDate: new Date(Date.now() - 8 * dayMs), endDate: new Date(Date.now() - dayMs), enabled: true, lastMailAt: null },
    });

    const r1 = await runDueDeptReviewWindows(new Date(), { academicYearIds: [yearId] });
    expect(r1.windows).toBeGreaterThanOrEqual(1);
    expect(r1.faculty).toBeGreaterThanOrEqual(1);

    const mails = await prisma.emailNotification.findMany({ where: { toUserId: facId } });
    const templates = new Set(mails.map((m) => m.template));
    expect(templates.has('quarterly_feedback')).toBe(true);
    expect(templates.has('feedback_issued')).toBe(true);

    // Re-run the same day → guarded by lastMailAt, nothing new fires.
    const before = mails.length;
    const r2 = await runDueDeptReviewWindows(new Date(), { academicYearIds: [yearId] });
    expect(r2.windows).toBe(0);
    const after = await prisma.emailNotification.count({ where: { toUserId: facId } });
    expect(after).toBe(before);
  });
});
