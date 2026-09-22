import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// V2 workflow (W1–W6) endpoint tests — real Express app + DB.
// Covers the controllers that were previously only smoke-tested by hand:
// cadreTarget, verification/red-list, tracking, feedback, /reports/criteria.
//
// Every account is the suite's own — a throwaway dean, a HoD and a faculty with
// a draft in a private department. It used to log in as ADMIN001, the real HoD
// 00CSE003 and seed FAC21: each run left their LOGIN audit rows behind, the
// manual-tier cases wrote onto whichever real faculty sorted first, and with
// those accounts absent the whole suite skipped itself and still reported green.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let principalTok = '';
let adminTok = '';
let hodTok = '';
let facTok = '';
let faculty: FixtureUser;
let openYearId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('V2C');
    principalTok = (await fixture.addUser({ name: 'PRI', role: RoleType.PRINCIPAL })).token;
    adminTok = (await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN })).token;
    hodTok = (await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' })).token;
    faculty = await fixture.addUser({ name: 'FAC' });
    facTok = faculty.token;
    if (!principalTok || !hodTok || !facTok) return;

    // This suite's own year, not the shared open one. /tracking and
    // /tracking/export scan every submission in the year they are given
    // (trackingService.buildTrackingRows), and other suites create submissions
    // in the shared open year and delete their users on teardown. vitest runs
    // the files in parallel, so borrowing that year let /tracking/export read a
    // submission whose user was already gone — the TRACKING_INCLUDE user join
    // returned null and the endpoint 500'd. A private year holds only this
    // suite's rows, so nothing else can be mid-teardown inside it.
    // submissionOpen stays false: this suite addresses the year by id in every
    // call, so it needs no "open" status — and a second open year would be
    // picked up by other suites' createSubmission (findFirstOrThrow on
    // submissionOpen), landing their rows here and colliding with the teardown
    // below that deletes this year.
    const year = await prisma.academicYear.create({
      data: {
        label: 'V2 Test Year',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        submissionOpen: false,
      },
    });
    openYearId = year.id;
    // A draft in that year, so the faculty has a row on /tracking.
    await fixture.createSubmission(faculty, { academicYearId: openYearId });
    ready = !!openYearId;
  } catch {
    console.warn('[v2] DB unreachable — skipping V2 suite.');
    ready = false;
  }
});

afterAll(async () => {
  // Submissions reference the year, so the fixture goes first. The year is
  // created straight through prisma, so destroy() knows nothing about it.
  await fixture?.destroy();
  if (openYearId) await prisma.academicYear.delete({ where: { id: openYearId } }).catch(() => {});
});

describe('V2 fixture', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });
});

// ─── Auth / role gating ────────────────────────────────────────────────────
describe('V2 auth & role gating', () => {
  const noToken: Array<[string, string]> = [
    ['get', '/api/admin/cadre-targets'],
    ['post', '/api/admin/cadre-targets'],
    ['get', '/api/tracking'],
    ['get', '/api/tracking/export'],
    ['post', '/api/admin/tracking/snapshot'],
    ['get', '/api/red-list'],
    ['get', '/api/reports/criteria'],
  ];
  for (const [method, path] of noToken) {
    it(`${method.toUpperCase()} ${path} without token → 401`, async () => {
      if (!ready) return;
      const res = await (request(app) as any)[method](path);
      expect(res.status).toBe(401);
    });
  }

  const facForbidden: Array<[string, string]> = [
    ['get', '/api/admin/cadre-targets'],
    ['post', '/api/admin/cadre-targets'],
    ['post', '/api/admin/cadre-targets/seed-defaults'],
    ['get', '/api/tracking'],
    ['get', '/api/tracking/export'],
    ['post', '/api/admin/tracking/snapshot'],
    ['get', '/api/red-list'],
    ['get', '/api/reports/criteria'],
  ];
  for (const [method, path] of facForbidden) {
    it(`FACULTY ${method.toUpperCase()} ${path} → 403`, async () => {
      if (!ready) return;
      const res = await (request(app) as any)[method](path).set(bearer(facTok));
      expect(res.status).toBe(403);
    });
  }

  // The admin is a maintenance account — accounts, roles, email queue, audit
  // log. Every appraisal-content route below moved to the principal or the dean
  // in the 2026-09-18 role rework.
  const adminForbidden: Array<[string, string]> = [
    ['get', '/api/admin/cadre-targets'],
    ['get', '/api/admin/cadre-tiers'],
    ['get', '/api/admin/review-windows'],
    ['get', '/api/tracking'],
    ['get', '/api/tracking/export'],
    ['put', '/api/admin/faculty-tiers'],
    ['post', '/api/admin/tracking/snapshot'],
    ['get', '/api/red-list'],
    ['get', '/api/proofs/overview'],
    ['get', '/api/reports/criteria'],
    ['get', '/api/reports/department'],
    ['get', '/api/reports/institute'],
    ['get', '/api/reports/export'],
    ['get', '/api/reviews/pending'],
  ];
  for (const [method, path] of adminForbidden) {
    it(`ADMIN ${method.toUpperCase()} ${path} → 403 (holds no appraisal content)`, async () => {
      if (!ready || !adminTok) return;
      const res = await (request(app) as any)[method](path).set(bearer(adminTok));
      expect(res.status).toBe(403);
    });
  }
});

// ─── W1: cadre eligibility targets (dean/principal CRUD) ───────────────────
describe('W1 cadre targets', () => {
  it('principal can list targets for the open year', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/admin/cadre-targets?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('create → update → delete lifecycle (throwaway 99yr band)', async () => {
    if (!ready) return;
    // Self-heal: drop any leftover 99-band row from a crashed prior run so the
    // POST (which is create, not upsert) doesn't hit a P2002 duplicate.
    const existing = await request(app).get(`/api/admin/cadre-targets?academicYearId=${openYearId}`).set(bearer(principalTok));
    for (const r of existing.body.filter((x: any) => x.cadre === 'ASSISTANT_PROFESSOR' && x.minExpYears === 99)) {
      await request(app).delete(`/api/admin/cadre-targets/${r.id}`).set(bearer(principalTok));
    }
    const payload = {
      academicYearId: openYearId,
      cadre: 'ASSISTANT_PROFESSOR',
      minExpYears: 99, // unused band — avoids clobbering seeded rows (0 / 3)
      maxExpYears: null,
      totalScoreTarget: 300,
      feedbackTarget: 3.5,
      indexedCount: 1,
      minJournal: 0,
      quartileSet: null,
      ppcRule: 'DESIRABLE',
      ppcCount: 0,
    };
    const created = await request(app).post('/api/admin/cadre-targets').set(bearer(principalTok)).send(payload);
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    const id = created.body.id;

    // Regression: a single-field PUT must NOT reset the defaulted columns.
    // (updateTargetSchema has no Zod defaults, so omitted keys are untouched.)
    const updated = await request(app)
      .put(`/api/admin/cadre-targets/${id}`)
      .set(bearer(principalTok))
      .send({ totalScoreTarget: 320 });
    expect(updated.status).toBe(200);
    expect(updated.body.totalScoreTarget).toBe(320);
    // Band + other fields preserved, not reset to defaults.
    expect(updated.body.minExpYears).toBe(99);
    expect(updated.body.maxExpYears).toBeNull();
    expect(updated.body.indexedCount).toBe(1);
    expect(updated.body.feedbackTarget).toBe(3.5);

    const del = await request(app).delete(`/api/admin/cadre-targets/${id}`).set(bearer(principalTok));
    expect(del.status).toBe(204);
  });

  it('rejects maxExpYears <= minExpYears with 400', async () => {
    if (!ready) return;
    const res = await request(app).post('/api/admin/cadre-targets').set(bearer(principalTok)).send({
      academicYearId: openYearId,
      cadre: 'PROFESSOR',
      minExpYears: 5,
      maxExpYears: 5,
      totalScoreTarget: 300,
      feedbackTarget: 3.5,
      indexedCount: 1,
      ppcRule: 'MANDATORY',
      ppcCount: 1,
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid body with 400 (zod)', async () => {
    if (!ready) return;
    const res = await request(app).post('/api/admin/cadre-targets').set(bearer(principalTok)).send({ cadre: 'NOPE' });
    expect(res.status).toBe(400);
  });

  it('update / delete of a nonexistent id → 404', async () => {
    if (!ready) return;
    const upd = await request(app).put('/api/admin/cadre-targets/does-not-exist').set(bearer(principalTok)).send({ totalScoreTarget: 1 });
    expect(upd.status).toBe(404);
    const del = await request(app).delete('/api/admin/cadre-targets/does-not-exist').set(bearer(principalTok));
    expect(del.status).toBe(404);
  });
});

// W7 per-cadre tier thresholds are covered in cadreTierController.test.ts.

// ─── W3/W5: tracking ────────────────────────────────────────────────────────
describe('W3/W5 tracking', () => {
  it('principal GET /tracking returns the segregation payload', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(res.status).toBe(200);
    expect(res.body.year?.id).toBe(openYearId);
    expect(typeof res.body.hasTargets).toBe('boolean');
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.aggregates).toBeTruthy();
  });

  it('principal sets a manual tier by hand and tracking reflects it', async () => {
    if (!ready) return;
    const track1 = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(principalTok));
    // The suite's own faculty — never a real one.
    const row = track1.body.rows?.find((r: any) => r.faculty.id === faculty.id);
    expect(row).toBeTruthy();
    if (!row) return; // no faculty in scope
    const userId = row.faculty.id;

    const set = await request(app).put('/api/admin/faculty-tiers').set(bearer(principalTok))
      .send({ userId, academicYearId: openYearId, tier: 'T2' });
    expect(set.status).toBe(200);
    expect(set.body.tier).toBe('T2');

    const track2 = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(track2.body.rows.find((r: any) => r.faculty.id === userId).tier).toBe('T2');

    // Clear it back to unassigned (restore).
    const clr = await request(app).put('/api/admin/faculty-tiers').set(bearer(principalTok))
      .send({ userId, academicYearId: openYearId, tier: null });
    expect(clr.status).toBe(200);
    const track3 = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(track3.body.rows.find((r: any) => r.faculty.id === userId).tier).toBeNull();
  });

  it('principal sets eligibility by hand and tracking + aggregates reflect it', async () => {
    if (!ready) return;
    const track1 = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(principalTok));
    // The suite's own faculty — never a real one.
    const row = track1.body.rows?.find((r: any) => r.faculty.id === faculty.id);
    expect(row).toBeTruthy();
    if (!row) return;
    const userId = row.faculty.id;

    const on = await request(app).put('/api/admin/faculty-tiers').set(bearer(principalTok))
      .send({ userId, academicYearId: openYearId, eligible: true });
    expect(on.status).toBe(200);
    expect(on.body.eligible).toBe(true);

    const t2 = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(t2.body.rows.find((r: any) => r.faculty.id === userId).eligible).toBe(true);
    expect(t2.body.aggregates.eligible).toBeGreaterThanOrEqual(1);

    // Toggling off is distinct from never having decided.
    const off = await request(app).put('/api/admin/faculty-tiers').set(bearer(principalTok))
      .send({ userId, academicYearId: openYearId, eligible: false });
    expect(off.status).toBe(200);
    const t3 = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(t3.body.rows.find((r: any) => r.faculty.id === userId).eligible).toBe(false);

    // Clearing restores the undecided state, and leaves the tier untouched.
    await request(app).put('/api/admin/faculty-tiers').set(bearer(principalTok))
      .send({ userId, academicYearId: openYearId, eligible: null });
    const t4 = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(t4.body.rows.find((r: any) => r.faculty.id === userId).eligible).toBeNull();
  });

  it('rejects a faculty-tiers call carrying neither tier nor eligible (400)', async () => {
    if (!ready) return;
    const res = await request(app).put('/api/admin/faculty-tiers').set(bearer(principalTok))
      .send({ userId: 'x', academicYearId: openYearId });
    expect(res.status).toBe(400);
  });

  it('non-principal cannot set a manual tier (403)', async () => {
    if (!ready || !hodTok) return;
    const res = await request(app).put('/api/admin/faculty-tiers').set(bearer(hodTok))
      .send({ userId: 'x', academicYearId: openYearId, tier: 'T1' });
    expect(res.status).toBe(403);
  });

  it('GET /proofs/overview returns per-faculty upload counts, dept-scoped', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/proofs/overview?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(res.status).toBe(200);
    expect(res.body.year?.id).toBe(openYearId);
    expect(Array.isArray(res.body.rows)).toBe(true);
    for (const r of res.body.rows) {
      expect(r.faculty?.employeeCode).toBeTruthy();
      const c = r.counts;
      // total is the sum of the three states — no proof is double-counted or lost
      expect(c.verified + c.rejected + c.pending).toBe(c.total);
    }
    // A HoD only ever sees their own department.
    if (hodTok) {
      const scoped = await request(app).get(`/api/proofs/overview?academicYearId=${openYearId}`).set(bearer(hodTok));
      expect(scoped.status).toBe(200);
      const depts = new Set(scoped.body.rows.map((r: any) => r.faculty.department?.code));
      expect(depts.size).toBeLessThanOrEqual(1);
    }
  });

  it('FACULTY cannot read the uploads overview (403)', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/proofs/overview').set(bearer(facTok));
    expect(res.status).toBe(403);
  });

  it('principal GET /tracking/export?format=excel returns an xlsx buffer', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/tracking/export?academicYearId=${openYearId}&format=excel`).set(bearer(principalTok));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('principal GET /tracking/export (json default) returns rows', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/tracking/export?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('HOD GET /tracking is scoped (200)', async () => {
    if (!ready || !hodTok) return;
    const res = await request(app).get(`/api/tracking?academicYearId=${openYearId}`).set(bearer(hodTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('unknown academic year → 404', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/tracking?academicYearId=no-such-year').set(bearer(principalTok));
    expect(res.status).toBe(404);
  });
});

// ─── W2: verification / red-list ────────────────────────────────────────────
describe('W2 verification & red-list', () => {
  it('principal GET /red-list returns an array', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/red-list').set(bearer(principalTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('HOD GET /red-list returns an array (dept-scoped)', async () => {
    if (!ready || !hodTok) return;
    const res = await request(app).get('/api/red-list').set(bearer(hodTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET proofs of a nonexistent submission → 404', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/appraisals/no-such-sub/proofs').set(bearer(principalTok));
    expect(res.status).toBe(404);
  });

  it('verify proof on a nonexistent submission → 404', async () => {
    if (!ready || !hodTok) return;
    const res = await request(app)
      .post('/api/appraisals/no-such-sub/proofs/verify')
      .set(bearer(hodTok))
      .send({ url: 'x', status: 'VERIFIED' });
    expect(res.status).toBe(404);
  });

  it('clear-hold on a nonexistent submission → 404', async () => {
    if (!ready) return;
    const res = await request(app).post('/api/appraisals/no-such-sub/clear-hold').set(bearer(principalTok));
    expect(res.status).toBe(404);
  });
});

// ─── W6: annual HoD feedback ────────────────────────────────────────────────
describe('W6 feedback', () => {
  it('GET feedback of a nonexistent submission → 404', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/appraisals/no-such-sub/feedback').set(bearer(principalTok));
    expect(res.status).toBe(404);
  });

  it('save feedback on a nonexistent submission → 404', async () => {
    if (!ready) return;
    const res = await request(app)
      .put('/api/appraisals/no-such-sub/feedback')
      .set(bearer(principalTok))
      .send({ strengths: 'x' });
    expect(res.status).toBe(404);
  });

  it('FACULTY cannot save feedback (roleGuard) → 403', async () => {
    if (!ready) return;
    const res = await request(app)
      .put('/api/appraisals/whatever/feedback')
      .set(bearer(facTok))
      .send({ strengths: 'x' });
    expect(res.status).toBe(403);
  });
});

// ─── A1–A3: criteria report ─────────────────────────────────────────────────
describe('reports/criteria', () => {
  it('principal GET /reports/criteria returns ranked rows', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/reports/criteria?academicYearId=${openYearId}`).set(bearer(principalTok));
    expect(res.status).toBe(200);
    expect(res.body.year?.id).toBe(openYearId);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('HOD GET /reports/criteria is dept-scoped (200)', async () => {
    if (!ready || !hodTok) return;
    const res = await request(app).get(`/api/reports/criteria?academicYearId=${openYearId}`).set(bearer(hodTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });
});

// getDeptReport / exportReport used to read ?dept straight from the query with no
// ownership check: a HoD could pass a foreign dept id (cross-dept read), and the
// no-filter default returned EVERY department. Now a HoD is hard-scoped to their
// own dept(s); the dean and principal keep the optional filter.
describe('reports/department dept-scope', () => {
  const bogus = '00000000-0000-0000-0000-000000000000';

  it('HoD report ignores a foreign ?dept — no cross-dept leak, no all-dept spill', async () => {
    if (!ready || !hodTok) return;
    const own = await request(app).get('/api/reports/department').set(bearer(hodTok));
    const injected = await request(app).get(`/api/reports/department?dept=${bogus}`).set(bearer(hodTok));
    expect(own.status).toBe(200);
    expect(injected.status).toBe(200);
    // ?dept is ignored for a HoD → identical result set (pre-fix the bogus dept
    // filter returned [], and an unfiltered call spilled all departments).
    expect(injected.body.length).toBe(own.body.length);
    // A HoD only ever sees their own single department.
    const deptIds = new Set(own.body.map((r: any) => r.submission.user.departmentId));
    expect(deptIds.size).toBeLessThanOrEqual(1);
  });

  it('principal report still honours an explicit dept filter', async () => {
    if (!ready) return;
    const filtered = await request(app).get(`/api/reports/department?dept=${bogus}`).set(bearer(principalTok));
    expect(filtered.status).toBe(200);
    // The principal has no own-dept scoping, so a bogus filter is honoured → empty.
    expect(filtered.body.length).toBe(0);
  });
});

// ─── Quarterly snapshot send-gate ──────────────────────────────────────────
// The manual trigger mass-emails every opted-in faculty at their real college
// address, so it must stay a dry run unless the caller passes `confirm: true`.
// Only the dry-run path is exercised here on purpose — asserting the confirmed
// path would queue real mail into the dev database.
describe('quarterly snapshot send-gate', () => {
  // Scoped to this fixture's own users, not to the template alone. The template
  // is not exclusive to this suite — reviewWindowGate releases a window and
  // queues quarterly_feedback for its own faculty, and vitest runs the files in
  // parallel, so a table-wide count picks up its rows between the two reads
  // here and the test fails on mail it did not send. A send by the endpoint
  // under test could only ever reach these users, so this is the exact scope.
  const queuedHere = () => prisma.emailNotification.count({
    where: {
      template: 'quarterly_feedback',
      toUserId: { in: fixture!.users.map((u) => u.id) },
    },
  });

  it('defaults to a dry run and queues nothing', async () => {
    if (!ready) return;
    const before = await queuedHere();

    const res = await request(app)
      .post('/api/admin/tracking/snapshot')
      .set(bearer(principalTok))
      .send({ academicYearId: openYearId });

    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(typeof res.body.recipients).toBe('number');
    expect(res.body.message).toMatch(/Dry run/i);
    expect(await queuedHere()).toBe(before);
  });

  it('treats a non-true confirm as a dry run', async () => {
    if (!ready) return;
    const before = await queuedHere();

    const res = await request(app)
      .post('/api/admin/tracking/snapshot')
      .set(bearer(principalTok))
      .send({ academicYearId: openYearId, confirm: 'yes' });

    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(await queuedHere()).toBe(before);
  });
});
