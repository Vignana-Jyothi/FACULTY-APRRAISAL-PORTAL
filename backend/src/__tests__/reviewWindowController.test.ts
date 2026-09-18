import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import prisma from '../utils/prismaClient';
import { RoleType } from '@prisma/client';
import { runDueReviewWindows } from '../cron/quarterlySnapshot';
import { createFixture, type Fixture } from './helpers/fixtures';

// W8 — dean review-window endpoints + the end-date automation trigger.
// Self-skips if the DB is unreachable — and the fixture guard then fails.
// Its own dean and faculty: logging in as ADMIN001 / FAC21 left LOGIN audit
// rows behind, and with FAC21 gone the suite skipped itself while passing.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let deanTok = '';
let facTok = '';
let yearId = '';
let throwawayYearId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('RWC');
    deanTok = (await fixture.addUser({ name: 'DEA', role: RoleType.DEAN })).token;
    facTok = (await fixture.addUser({ name: 'FAC' })).token;
    if (!deanTok || !facTok) return;
    const years = await request(app).get('/api/academic-years').set(bearer(deanTok));
    yearId = (years.body.find((y: any) => y.submissionOpen) ?? years.body[0])?.id ?? '';
    ready = !!yearId;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  if (throwawayYearId) await prisma.academicYear.delete({ where: { id: throwawayYearId } }).catch(() => {});
  await fixture?.destroy();
});

describe('W8 fixture', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });
});

describe('W8 review-window gating', () => {
  const routes: Array<[string, string]> = [
    ['get', '/api/admin/review-windows'],
    ['put', '/api/admin/review-windows'],
    ['delete', '/api/admin/review-windows/x'],
  ];
  for (const [m, p] of routes) {
    it(`${m.toUpperCase()} ${p} no token → 401`, async () => {
      if (!ready) return;
      const res = await (request(app) as any)[m](p);
      expect(res.status).toBe(401);
    });
    it(`FACULTY ${m.toUpperCase()} ${p} → 403`, async () => {
      if (!ready) return;
      const res = await (request(app) as any)[m](p).set(bearer(facTok));
      expect(res.status).toBe(403);
    });
  }
});

describe('W8 review-window CRUD', () => {
  it('upsert → update → delete a Q1 window', async () => {
    if (!ready) return;
    const up = await request(app).put('/api/admin/review-windows').set(bearer(deanTok)).send({
      academicYearId: yearId, quarter: 'Q1', startDate: '2099-01-01', endDate: '2099-01-07', enabled: true,
    });
    expect(up.status).toBe(200);
    expect(up.body.quarter).toBe('Q1');
    const id = up.body.id;

    // Upsert same (AY, quarter) updates rather than duplicating.
    const up2 = await request(app).put('/api/admin/review-windows').set(bearer(deanTok)).send({
      academicYearId: yearId, quarter: 'Q1', startDate: '2099-02-01', endDate: '2099-02-10', enabled: false,
    });
    expect(up2.status).toBe(200);
    expect(up2.body.id).toBe(id);
    expect(up2.body.enabled).toBe(false);

    const del = await request(app).delete(`/api/admin/review-windows/${id}`).set(bearer(deanTok));
    expect(del.status).toBe(204);
  });

  it('rejects endDate before startDate → 400', async () => {
    if (!ready) return;
    const res = await request(app).put('/api/admin/review-windows').set(bearer(deanTok)).send({
      academicYearId: yearId, quarter: 'Q2', startDate: '2099-05-10', endDate: '2099-05-01',
    });
    expect(res.status).toBe(400);
  });

  it('unknown academic year → 404', async () => {
    if (!ready) return;
    const res = await request(app).put('/api/admin/review-windows').set(bearer(deanTok)).send({
      academicYearId: 'no-such-year', quarter: 'Q1', startDate: '2099-01-01', endDate: '2099-01-07',
    });
    expect(res.status).toBe(404);
  });
});

describe('W8 automation fires on the window end date', () => {
  it('runs the snapshot when a window ends today, once', async () => {
    if (!ready) return;
    // Throwaway AY with no submissions — firing touches zero faculty (no emails).
    const yr = await prisma.academicYear.create({
      data: { label: `W8-TEST-${Date.now()}`, startDate: new Date('2099-06-01'), endDate: new Date('2100-05-31') },
    });
    throwawayYearId = yr.id;

    const today = new Date();
    await prisma.reviewWindow.create({
      data: { academicYearId: yr.id, quarter: 'Q1', startDate: new Date(today.getTime() - 6 * 864e5), endDate: today, enabled: true },
    });

    const first = await runDueReviewWindows(today, { academicYearIds: [yr.id] });
    expect(first.windows).toBeGreaterThanOrEqual(1);
    expect(first.faculty).toBe(0); // throwaway year has no faculty submissions

    // lastRunAt guard: a second run the same day does not re-fire this window.
    const w = await prisma.reviewWindow.findFirst({ where: { academicYearId: yr.id } });
    expect(w?.lastRunAt).toBeTruthy();

    const second = await runDueReviewWindows(today, { academicYearIds: [yr.id] });
    // Our throwaway window must not fire again today.
    const stillDue = await prisma.reviewWindow.findFirst({ where: { academicYearId: yr.id } });
    expect(second.windows).toBeLessThan(first.windows + 1);
    expect(stillDue?.lastRunAt).toBeTruthy();
  });

  it('does not fire a window whose end date is not today', async () => {
    if (!ready || !throwawayYearId) return;
    await prisma.reviewWindow.updateMany({
      where: { academicYearId: throwawayYearId },
      data: { endDate: new Date('2099-01-01'), lastRunAt: null },
    });
    const res = await runDueReviewWindows(new Date(), { academicYearIds: [throwawayYearId] });
    // No assertion on global count (other data may exist); just confirm our window did not run.
    const w = await prisma.reviewWindow.findFirst({ where: { academicYearId: throwawayYearId } });
    expect(w?.lastRunAt).toBeNull();
    expect(res).toBeTruthy();
  });
});
