import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import prisma from '../utils/prismaClient';
import { RoleType } from '@prisma/client';
import { runDueReviewWindows } from '../cron/quarterlySnapshot';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// Mass-mail gate (owner decision 2026-09-19): a review window only emails
// faculty if the dean armed it after a preview. Unarmed, it snapshots and holds
// the mail until released.
//
// Everything here is scoped to two throwaway academic years that only this
// suite's fixture faculty (all @fixture.invalid) have submissions in, and every
// runDueReviewWindows call passes that scope. No real window can fire.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let dean: FixtureUser;
let principal: FixtureUser;
const forbidden: Array<[string, FixtureUser]> = [];
let fac: FixtureUser[] = [];
let heldYearId = '';
let armedYearId = '';
let heldWindowId = '';
let armedWindowId = '';
const today = new Date();

const emailsFor = (academicYearId: string) =>
  prisma.emailNotification.findMany({
    where: { template: 'quarterly_feedback', dedupeKey: { contains: `:${academicYearId}:` } },
  });
const fixtureEmails = () =>
  prisma.emailNotification.findMany({ where: { toUserId: { in: fixture!.users.map((u) => u.id) } } });

async function makeYear(tag: string) {
  const yr = await prisma.academicYear.create({
    data: {
      label: `RWG-${tag}-${Date.now()}`,
      startDate: new Date('2099-07-01'),
      endDate: new Date('2100-06-30'),
    },
  });
  for (const f of fac) {
    const sub = await prisma.appraisalSubmission.create({
      data: { userId: f.id, academicYearId: yr.id, submissionNumber: 1 },
    });
    fixture!.track(sub.id);
  }
  return yr.id;
}

beforeAll(async () => {
  try {
    fixture = await createFixture('RWG');
    dean = await fixture.addUser({ name: 'DEA', role: RoleType.DEAN });
    principal = await fixture.addUser({ name: 'PRI', role: RoleType.PRINCIPAL });
    forbidden.push(['ADMIN', await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN })]);
    forbidden.push(['HOD', await fixture.addUser({ name: 'HOD', role: RoleType.HOD })]);
    forbidden.push(['SCRUTINIZER', await fixture.addUser({ name: 'SCR', role: RoleType.SCRUTINIZER })]);
    forbidden.push(['SPECIAL_SCRUTINIZER', await fixture.addUser({ name: 'SSC', role: RoleType.SPECIAL_SCRUTINIZER })]);
    fac = [
      await fixture.addUser({ name: 'FA1', role: RoleType.FACULTY }),
      await fixture.addUser({ name: 'FA2', role: RoleType.FACULTY }),
      await fixture.addUser({ name: 'FA3', role: RoleType.FACULTY }),
    ];
    forbidden.push(['FACULTY', fac[0]]);
    // FA3 opted out: snapshotted, never mailed.
    await prisma.user.update({ where: { id: fac[2].id }, data: { emailOptIn: false } });

    heldYearId = await makeYear('HELD');
    armedYearId = await makeYear('ARMED');
    heldWindowId = (await prisma.reviewWindow.create({
      data: { academicYearId: heldYearId, quarter: 'Q1', startDate: new Date(today.getTime() - 6 * 864e5), endDate: today },
    })).id;
    armedWindowId = (await prisma.reviewWindow.create({
      data: { academicYearId: armedYearId, quarter: 'Q2', startDate: new Date(today.getTime() - 6 * 864e5), endDate: today },
    })).id;

    ready = !!dean.token && !!principal.token && forbidden.every(([, u]) => !!u.token);
  } catch (e) {
    console.error(e);
    ready = false;
  }
});

afterAll(async () => {
  // Submissions, emails, audit rows and users go with the fixture; the years
  // take their windows and snapshots with them (cascade).
  await fixture?.destroy();
  for (const id of [heldYearId, armedYearId]) {
    if (id) await prisma.academicYear.delete({ where: { id } }).catch(() => {});
  }
});

describe('review-window gate fixture', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });
});

describe('role gating on the new endpoints', () => {
  const routes: Array<[string, string, object?]> = [
    ['get', 'preview'],
    ['post', 'arm', { expectedRecipients: 0 }],
    ['post', 'disarm'],
    ['post', 'release', { confirm: true }],
  ];
  for (const [m, action, body] of routes) {
    it(`${m.toUpperCase()} :id/${action} → 403 for admin, HoD, scrutinizers, faculty`, async () => {
      if (!ready) return;
      for (const [role, u] of forbidden) {
        const req = (request(app) as any)[m](`/api/admin/review-windows/${heldWindowId}/${action}`).set(bearer(u.token));
        const res = body ? await req.send(body) : await req;
        expect(res.status, `${role} ${action}`).toBe(403);
      }
    });
    it(`${m.toUpperCase()} :id/${action} no token → 401`, async () => {
      if (!ready) return;
      const res = await (request(app) as any)[m](`/api/admin/review-windows/${heldWindowId}/${action}`);
      expect(res.status).toBe(401);
    });
  }

  it('the principal (CONFIG) may preview', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/admin/review-windows/${heldWindowId}/preview`).set(bearer(principal.token));
    expect(res.status).toBe(200);
  });
});

describe('unarmed window: snapshot, mail held, then released', () => {
  it('preview counts the opted-in faculty, renders one mail, and queues nothing', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/admin/review-windows/${heldWindowId}/preview`).set(bearer(dean.token));
    expect(res.status).toBe(200);
    expect(res.body.recipients).toBe(2);
    expect(res.body.sample.to).toMatch(/@fixture\.invalid$/);
    expect(res.body.sample.subject).toContain('Q1 feedback');
    expect(res.body.sample.html).toContain('RWG FA');
    expect(await fixtureEmails()).toHaveLength(0);
  });

  it('fires on the end date: snapshot rows for every faculty, ZERO emails, heldAt + lastRunAt set', async () => {
    if (!ready) return;
    const out = await runDueReviewWindows(today, { academicYearIds: [heldYearId] });
    expect(out.windows).toBe(1);
    expect(out.faculty).toBe(3);
    expect((out as any).held).toBe(1);

    const snaps = await prisma.trackingSnapshot.count({ where: { academicYearId: heldYearId, quarter: 'Q1' } });
    expect(snaps).toBe(3);
    expect(await prisma.emailNotification.count({ where: { toUserId: { in: fac.map((f) => f.id) } } })).toBe(0);

    const w = await prisma.reviewWindow.findUniqueOrThrow({ where: { id: heldWindowId } });
    expect(w.heldAt).toBeTruthy();
    expect(w.lastRunAt).toBeTruthy();
    expect(w.releasedAt).toBeNull();
  });

  it('lastRunAt blocks a second run the same day', async () => {
    if (!ready) return;
    const again = await runDueReviewWindows(today, { academicYearIds: [heldYearId] });
    expect(again.windows).toBe(0);
    expect(await fixtureEmails()).toHaveLength(0);
  });

  it('a held window cannot be armed after the fact', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/admin/review-windows/${heldWindowId}/arm`)
      .set(bearer(dean.token)).send({ expectedRecipients: 2 });
    expect(res.status).toBe(409);
  });

  it('release without confirm is a dry run that writes nothing', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/admin/review-windows/${heldWindowId}/release`).set(bearer(dean.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.recipients).toBe(2);
    expect(await fixtureEmails()).toHaveLength(0);
    const w = await prisma.reviewWindow.findUniqueOrThrow({ where: { id: heldWindowId } });
    expect(w.releasedAt).toBeNull();
  });

  it('release with confirm queues the held mail once; a second release is refused', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/admin/review-windows/${heldWindowId}/release`)
      .set(bearer(dean.token)).send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(2);

    const rows = await emailsFor(heldYearId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.toUserId))).toEqual(new Set([fac[0].id, fac[1].id]));
    expect(rows.every((r) => r.toEmail.endsWith('@fixture.invalid'))).toBe(true);

    const again = await request(app).post(`/api/admin/review-windows/${heldWindowId}/release`)
      .set(bearer(dean.token)).send({ confirm: true });
    expect(again.status).toBe(409);
    expect(await emailsFor(heldYearId)).toHaveLength(2);

    const audit = await prisma.auditLog.count({ where: { entityId: heldWindowId, action: 'REVIEW_WINDOW_RELEASED' } });
    expect(audit).toBe(1);
  });
});

describe('armed window: preview, arm, edit disarms, fire', () => {
  it('arm with a stale expectedRecipients → 409, stays unarmed', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/admin/review-windows/${armedWindowId}/arm`)
      .set(bearer(dean.token)).send({ expectedRecipients: 5 });
    expect(res.status).toBe(409);
    expect(res.body.recipients).toBe(2);
    const w = await prisma.reviewWindow.findUniqueOrThrow({ where: { id: armedWindowId } });
    expect(w.armedAt).toBeNull();
  });

  it('arm with the previewed count sets armedAt/armedById and audits', async () => {
    if (!ready) return;
    const res = await request(app).post(`/api/admin/review-windows/${armedWindowId}/arm`)
      .set(bearer(dean.token)).send({ expectedRecipients: 2 });
    expect(res.status).toBe(200);
    const w = await prisma.reviewWindow.findUniqueOrThrow({ where: { id: armedWindowId } });
    expect(w.armedAt).toBeTruthy();
    expect(w.armedById).toBe(dean.id);
    expect(await prisma.auditLog.count({ where: { entityId: armedWindowId, action: 'REVIEW_WINDOW_ARMED' } })).toBe(1);

    const list = await request(app).get(`/api/admin/review-windows?academicYearId=${armedYearId}`).set(bearer(dean.token));
    expect(list.body[0].armedByName).toBe(dean.name);
  });

  it('editing the dates disarms the window', async () => {
    if (!ready) return;
    const w = await prisma.reviewWindow.findUniqueOrThrow({ where: { id: armedWindowId } });
    const put = await request(app).put('/api/admin/review-windows').set(bearer(dean.token)).send({
      academicYearId: armedYearId, quarter: 'Q2', startDate: w.startDate.toISOString(),
      endDate: new Date(today.getTime() + 864e5).toISOString(), enabled: true,
    });
    expect(put.status).toBe(200);
    expect(put.body.armedAt).toBeNull();
    expect(put.body.armedById).toBeNull();

    // Back to today; still unarmed until the dean arms again.
    const back = await request(app).put('/api/admin/review-windows').set(bearer(dean.token)).send({
      academicYearId: armedYearId, quarter: 'Q2', startDate: w.startDate.toISOString(),
      endDate: today.toISOString(), enabled: true,
    });
    expect(back.body.armedAt).toBeNull();
  });

  it('disarm clears the arm', async () => {
    if (!ready) return;
    await request(app).post(`/api/admin/review-windows/${armedWindowId}/arm`).set(bearer(dean.token)).send({ expectedRecipients: 2 });
    const res = await request(app).post(`/api/admin/review-windows/${armedWindowId}/disarm`).set(bearer(dean.token));
    expect(res.status).toBe(200);
    expect(res.body.armedAt).toBeNull();
  });

  it('armed and due: emails queued only to the suite\'s opted-in fixture faculty, once', async () => {
    if (!ready) return;
    const arm = await request(app).post(`/api/admin/review-windows/${armedWindowId}/arm`)
      .set(bearer(dean.token)).send({ expectedRecipients: 2 });
    expect(arm.status).toBe(200);

    const out = await runDueReviewWindows(today, { academicYearIds: [armedYearId] });
    expect(out.windows).toBe(1);
    expect((out as any).held).toBe(0);

    const rows = await emailsFor(armedYearId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.toUserId))).toEqual(new Set([fac[0].id, fac[1].id]));
    expect(rows.every((r) => r.toEmail.endsWith('@fixture.invalid'))).toBe(true);
    expect(await prisma.trackingSnapshot.count({ where: { academicYearId: armedYearId, quarter: 'Q2' } })).toBe(3);

    const w = await prisma.reviewWindow.findUniqueOrThrow({ where: { id: armedWindowId } });
    expect(w.heldAt).toBeNull();
    expect(w.lastRunAt).toBeTruthy();

    const again = await runDueReviewWindows(today, { academicYearIds: [armedYearId] });
    expect(again.windows).toBe(0);
    expect(await emailsFor(armedYearId)).toHaveLength(2);

    // Nothing to release on a window that sent normally.
    const rel = await request(app).post(`/api/admin/review-windows/${armedWindowId}/release`)
      .set(bearer(dean.token)).send({ confirm: true });
    expect(rel.status).toBe(409);
  });

  it('every email the suite caused went to its own fixture users', async () => {
    if (!ready) return;
    const all = await fixtureEmails();
    expect(all).toHaveLength(4);
    expect(all.every((r) => r.toEmail.endsWith('@fixture.invalid'))).toBe(true);
  });
});
