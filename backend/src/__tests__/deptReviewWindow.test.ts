import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Quarter, RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { runDueDeptReviewWindows } from '../cron/quarterlySnapshot';
import { triggerReviewWeekReminders } from '../cron/reminders';
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
let fac2Id = '';
let otherDeptId = '';
let yearId = '';
let subId = '';
const cleanupUserIds: string[] = [];
const deanWindowIds: string[] = [];

beforeAll(async () => {
  try {
    fixture = await createFixture('DRW');
    const hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD });
    const fac = await fixture.addUser({ name: 'FAC', role: RoleType.FACULTY });
    const fac2 = await fixture.addUser({ name: 'FACB', role: RoleType.FACULTY });
    hodTok = hod.token; facTok = fac.token; facId = fac.id; fac2Id = fac2.id;
    cleanupUserIds.push(fac.id, fac2.id);
    otherDeptId = await fixture.addDepartment('OTH');
    const year = await prisma.academicYear.findFirstOrThrow({ where: { submissionOpen: true } });
    yearId = year.id;
    subId = await fixture.createSubmission(fac); // fac2 deliberately has no submission

    // Dean bounds: Q1 wide-and-active (covers now), Q2 wide (covers yesterday),
    // Q3 wide (covers a start three days out, for the approaching reminder).
    for (const quarter of [Quarter.Q1, Quarter.Q2, Quarter.Q3]) {
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
  if (cleanupUserIds.length) {
    await prisma.emailNotification.deleteMany({ where: { toUserId: { in: cleanupUserIds } } }).catch(() => {});
    await prisma.trackingSnapshot.deleteMany({ where: { userId: { in: cleanupUserIds } } }).catch(() => {});
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

describe('W8b inactivity list + manual reminder (Phase 2)', () => {
  it('HoD sees the department faculty with a status', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/dept-review-windows/activity?academicYearId=' + yearId).set(bearer(hodTok));
    expect(res.status).toBe(200);
    const rows: any[] = res.body.rows;
    expect(rows.find((r) => r.userId === facId)?.hasSubmission).toBe(true);
    // fac2 never created a submission → flagged not-started.
    expect(rows.find((r) => r.userId === fac2Id)?.status).toBe('no-submission');
  });

  it('HoD can send a manual reminder, deduped to once a day', async () => {
    if (!ready) return;
    const first = await request(app).post('/api/dept-review-windows/remind').set(bearer(hodTok))
      .send({ userId: fac2Id, academicYearId: yearId });
    expect(first.status).toBe(200);
    expect(first.body.queued).toBe(true);
    const mail = await prisma.emailNotification.findFirst({ where: { toUserId: fac2Id, template: 'draft_reminder' } });
    expect(mail).toBeTruthy();

    const second = await request(app).post('/api/dept-review-windows/remind').set(bearer(hodTok))
      .send({ userId: fac2Id, academicYearId: yearId });
    expect(second.body.queued).toBe(false); // same day → deduped
  });

  it("rejects reminding a faculty outside the HoD's department", async () => {
    if (!ready) return;
    const outsider = await prisma.user.findFirst({ where: { departmentId: otherDeptId } });
    // No such user exists (empty dept) → use a clearly foreign id: expect 404/403.
    const res = await request(app).post('/api/dept-review-windows/remind').set(bearer(hodTok))
      .send({ userId: outsider?.id ?? '00000000-0000-0000-0000-000000000000', academicYearId: yearId });
    expect([403, 404]).toContain(res.status);
  });
});

describe('W8b review-week-approaching reminder (Phase 2)', () => {
  it('mails the department faculty when the window starts in 3 days', async () => {
    if (!ready) return;
    const start = new Date(Date.now() + 3 * dayMs);
    await prisma.deptReviewWindow.upsert({
      where: { academicYearId_departmentId_quarter: { academicYearId: yearId, departmentId: fixture!.deptId, quarter: Quarter.Q3 } },
      create: { academicYearId: yearId, departmentId: fixture!.deptId, quarter: Quarter.Q3, startDate: start, endDate: new Date(Date.now() + 5 * dayMs), enabled: true },
      update: { startDate: start, endDate: new Date(Date.now() + 5 * dayMs), enabled: true },
    });
    await triggerReviewWeekReminders(new Date());
    const mail = await prisma.emailNotification.findFirst({ where: { toUserId: facId, template: 'review_week_approaching' } });
    expect(mail).toBeTruthy();
  });
});
