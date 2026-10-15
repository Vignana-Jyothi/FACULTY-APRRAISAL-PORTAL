import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { triggerReviewWeekReminders } from '../cron/reminders';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// Calendar-review model (2026-10-15): HoD sets per-quarter REMINDER dates (no
// lock, no bounds); faculty edit all year; the HoD reviews each quarter after
// its fixed calendar end, in order, issuing feedback one quarter at a time.
// Owns its fixtures. Academic year starts ~700 days ago so all four calendar
// quarters have ended, making the review order deterministic on any run date.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const dayMs = 24 * 60 * 60 * 1000;

let ready = false;
let fixture: Fixture | null = null;
let hodTok = '';
let facTok = '';
let facId = '';
let fac2User: FixtureUser | null = null;
let otherDeptId = '';
let yearId = '';
let subId = '';
const cleanupUserIds: string[] = [];

beforeAll(async () => {
  try {
    fixture = await createFixture('DRW');
    const hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD });
    const fac = await fixture.addUser({ name: 'FAC', role: RoleType.FACULTY });
    const fac2 = await fixture.addUser({ name: 'FACB', role: RoleType.FACULTY });
    hodTok = hod.token; facTok = fac.token; facId = fac.id; fac2User = fac2;
    cleanupUserIds.push(fac.id, fac2.id);
    otherDeptId = await fixture.addDepartment('OTH');
    // Own throwaway academic year, isolated from other suites (submissionOpen:false
    // keeps it out of their findFirst lookups). Start ~700d ago => all quarters ended.
    const year = await prisma.academicYear.create({
      data: { label: `DRW Year ${Date.now()}`, startDate: new Date(Date.now() - 700 * dayMs), endDate: new Date(Date.now() - 335 * dayMs), submissionOpen: false },
    });
    yearId = year.id;
    subId = await fixture.createSubmission(fac, { academicYearId: yearId });
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
  await fixture?.destroy();
  if (yearId) await prisma.academicYear.delete({ where: { id: yearId } }).catch(() => {});
});

describe('reminder dates — access + CRUD', () => {
  it('has a working fixture', () => { expect(ready).toBe(true); });

  it('no token -> 401, faculty -> 403', async () => {
    if (!ready) return;
    expect((await request(app).get('/api/dept-review-windows?academicYearId=' + yearId)).status).toBe(401);
    expect((await request(app).get('/api/dept-review-windows?academicYearId=' + yearId).set(bearer(facTok))).status).toBe(403);
  });

  it('HoD sets reminder dates freely (no dean bounds); rejects another department', async () => {
    if (!ready) return;
    const ok = await request(app).put('/api/dept-review-windows').set(bearer(hodTok)).send({
      academicYearId: yearId, departmentId: fixture!.deptId, quarter: 'Q1',
      startDate: new Date(Date.now() - dayMs).toISOString(), endDate: new Date(Date.now() + 2 * dayMs).toISOString(),
    });
    expect(ok.status).toBe(200);

    const forbidden = await request(app).put('/api/dept-review-windows').set(bearer(hodTok)).send({
      academicYearId: yearId, departmentId: otherDeptId, quarter: 'Q1',
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + dayMs).toISOString(),
    });
    expect(forbidden.status).toBe(403);
  });
});

describe('no faculty lock', () => {
  it('faculty can edit their draft any time (reminder dates do not lock it)', async () => {
    if (!ready) return;
    const res = await request(app).put(`/api/appraisals/${subId}`).set(bearer(facTok)).send({ categories: {} });
    expect(res.status).toBe(200);
  });
});

describe('calendar review gate — one quarter at a time, in order', () => {
  it('refuses Q2 before Q1 is done, allows Q1, then freezes Q1', async () => {
    if (!ready) return;
    // All quarters ended, so Q1 is the current one — Q2 is out of order.
    const early = await request(app).post(`/api/appraisals/${subId}/feedback/issue`).set(bearer(hodTok))
      .send({ period: 'Q2', strengths: 'out of order' });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('NOT_CURRENT_REVIEW_QUARTER');

    const q1 = await request(app).post(`/api/appraisals/${subId}/feedback/issue`).set(bearer(hodTok))
      .send({ period: 'Q1', strengths: 'Q1 reviewed' });
    expect(q1.status).toBe(200);

    // Re-issuing Q1 is frozen.
    const again = await request(app).post(`/api/appraisals/${subId}/feedback/issue`).set(bearer(hodTok))
      .send({ period: 'Q1', strengths: 'changed' });
    expect(again.status).toBe(409);
  });
});

describe('both mails fire on review', () => {
  it('issuing the current quarter emails the faculty the HoD feedback and the Cat 1-5 snapshot', async () => {
    if (!ready) return;
    // Q1 issued above, so Q2 is now current.
    const res = await request(app).post(`/api/appraisals/${subId}/feedback/issue`).set(bearer(hodTok))
      .send({ period: 'Q2', strengths: 'Q2 reviewed' });
    expect(res.status).toBe(200);
    const mails = await prisma.emailNotification.findMany({ where: { toUserId: facId } });
    const templates = new Set(mails.map((m) => m.template));
    expect(templates.has('feedback_issued')).toBe(true);
    expect(templates.has('quarterly_feedback')).toBe(true);
  });
});

describe('drafts list — current quarter + stacking', () => {
  it('shows issued quarters as verified and the next quarter as to-verify', async () => {
    if (!ready || !fac2User) return;
    const sub2 = await fixture!.createSubmission(fac2User, { academicYearId: yearId });

    const res = await request(app).get('/api/reviews/drafts').set(bearer(hodTok));
    expect(res.status).toBe(200);
    const rows: any[] = res.body;
    const reviewed = rows.find((r) => r.submissionId === subId);  // Q1 + Q2 issued
    const pending = rows.find((r) => r.submissionId === sub2);     // nothing issued
    expect(reviewed?.issuedQuarters).toEqual(expect.arrayContaining(['Q1', 'Q2']));
    expect(reviewed?.currentReviewQuarter).toBe('Q3');             // next unissued ended quarter
    expect(pending?.currentReviewQuarter).toBe('Q1');
    // Earliest current-quarter first: sub2 (Q1) before subId (Q3).
    expect(rows.indexOf(pending)).toBeLessThan(rows.indexOf(reviewed));
  });
});

describe('inactivity list + manual reminder', () => {
  it('HoD sees the department faculty with a status', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/dept-review-windows/activity?academicYearId=' + yearId).set(bearer(hodTok));
    expect(res.status).toBe(200);
    const rows: any[] = res.body.rows;
    expect(rows.find((r) => r.userId === facId)?.hasSubmission).toBe(true);
  });

  it('HoD can send a manual reminder, deduped to once a day', async () => {
    if (!ready) return;
    const first = await request(app).post('/api/dept-review-windows/remind').set(bearer(hodTok))
      .send({ userId: facId, academicYearId: yearId });
    expect(first.status).toBe(200);
    expect(first.body.queued).toBe(true);
    const second = await request(app).post('/api/dept-review-windows/remind').set(bearer(hodTok))
      .send({ userId: facId, academicYearId: yearId });
    expect(second.body.queued).toBe(false);
  });
});

describe('review-week-approaching reminder', () => {
  it('mails the department faculty when the reminder window starts in 3 days', async () => {
    if (!ready || !fac2User) return;
    const start = new Date(Date.now() + 3 * dayMs);
    await prisma.deptReviewWindow.upsert({
      where: { academicYearId_departmentId_quarter: { academicYearId: yearId, departmentId: fixture!.deptId, quarter: 'Q3' } },
      create: { academicYearId: yearId, departmentId: fixture!.deptId, quarter: 'Q3', startDate: start, endDate: new Date(Date.now() + 5 * dayMs), enabled: true },
      update: { startDate: start, endDate: new Date(Date.now() + 5 * dayMs), enabled: true },
    });
    await triggerReviewWeekReminders(new Date());
    const mail = await prisma.emailNotification.findFirst({ where: { toUserId: facId, template: 'review_week_approaching' } });
    expect(mail).toBeTruthy();
  });
});
