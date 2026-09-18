import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// Category 6 (core values) and the /550 grand total are the reviewer's
// assessment OF the faculty. After the 2026-09-18 role rework exactly two kinds
// of caller may see them: the PRINCIPAL, institute-wide, and the HoD or
// incharge of that faculty's OWN department. The dean, the scrutinizer pool and
// the admin see the same appraisal out of 500 with those fields removed, and
// the owner sees neither — whatever else they hold.
//
// This suite is the leak test for that: every payload a non-seeing role can
// reach is asserted to carry no `cat6*` field and no `grandTotal`.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const ASSESSMENT_FIELDS = [
  'cat6Punctuality',
  'cat6Professionalism',
  'cat6Willingness',
  'cat6Cordiality',
  'cat6Classroom',
  'grandTotal',
];

/** Fails on any Cat 6 / grand-total field anywhere in the payload. */
function expectNoAssessment(body: unknown) {
  const seen = new Set<unknown>();
  const walk = (node: any) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [k, v] of Object.entries(node)) {
      expect(ASSESSMENT_FIELDS, `leaked "${k}"`).not.toContain(k);
      walk(v);
    }
  };
  walk(body);
}

let ready = false;
let fixture: Fixture | null = null;
let owner: FixtureUser;
let hodTok = '', deanTok = '', scrutinizerTok = '', principalTok = '', adminTok = '';
let scrutinizerId = '', subId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('RVS');
    owner = await fixture.addUser({ name: 'FAC' });
    hodTok = (await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' })).token;
    deanTok = (await fixture.addUser({ name: 'DEA', role: RoleType.DEAN })).token;
    principalTok = (await fixture.addUser({ name: 'PRI', role: RoleType.PRINCIPAL })).token;
    adminTok = (await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN })).token;

    // A scrutinizer from ANOTHER department: their reach over this submission
    // comes from the dean's assignment, never from a standing role.
    const otherDeptId = await fixture.addDepartment('RVX');
    const scrutinizer = await fixture.addUser({
      name: 'SCR', role: RoleType.SCRUTINIZER, deptId: otherDeptId,
    });
    scrutinizerId = scrutinizer.id;
    scrutinizerTok = scrutinizer.token;
    if (!hodTok || !deanTok || !principalTok || !adminTok || !scrutinizerTok) return;

    subId = await fixture.createSubmission(owner, { status: 'SUBMITTED' });

    // The HoD reviews it, entering the Cat 6 marks that everything below is
    // about. Without a review there is nothing to leak and the suite is vacuous.
    const reviewed = await request(app).post(`/api/appraisals/${subId}/review`).set(bearer(hodTok)).send({
      cat4Score: 20,
      cat6Punctuality: 9, cat6Professionalism: 9, cat6Willingness: 9,
      cat6Cordiality: 9, cat6Classroom: 9,
      overallComment: 'Solid year.', status: 'APPROVED',
    });

    // The dean assigns the scrutinizer, which is what gives them their read.
    const assigned = await request(app)
      .post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(deanTok)).send({ reviewerIds: [scrutinizerId] });

    ready = reviewed.status === 200 && assigned.status === 201;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('Cat 6 / grand total — who sees the reviewer assessment', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(subId).not.toBe('');
  });

  it('the HoD of the faculty\'s own department sees it', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}`).set(bearer(hodTok));
    expect(res.status).toBe(200);
    expect(res.body.review?.cat6Punctuality).toBe(9);
    expect(res.body.review?.grandTotal).toBeTypeOf('number');
  });

  it('the principal sees it across departments', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}`).set(bearer(principalTok));
    expect(res.status).toBe(200);
    expect(res.body.review?.cat6Punctuality).toBe(9);
    expect(res.body.review?.grandTotal).toBeTypeOf('number');
  });

  it('the dean gets the appraisal out of 500 and nothing of the assessment', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}`).set(bearer(deanTok));
    expect(res.status).toBe(200);
    // Still the reviewed appraisal — this is a strip, not a blanket denial.
    expect(res.body.review?.totalScore).toBeTypeOf('number');
    expectNoAssessment(res.body);
  });

  it('an assigned scrutinizer gets the same stripped payload', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}`).set(bearer(scrutinizerTok));
    expect(res.status).toBe(200);
    expect(res.body.review?.totalScore).toBeTypeOf('number');
    expectNoAssessment(res.body);
  });

  it('the owner gets neither, and the admin cannot reach it at all', async () => {
    if (!ready) return;
    const mine = await request(app).get(`/api/appraisals/${subId}`).set(bearer(owner.token));
    expect(mine.status).toBe(200);
    expectNoAssessment(mine.body);

    // The admin is a maintenance account and holds no appraisal content.
    const admin = await request(app).get(`/api/appraisals/${subId}`).set(bearer(adminTok));
    expect(admin.status).toBe(403);
    expectNoAssessment(admin.body);
  });

  it('GET /appraisals/:id/review is stripped for the dean and the scrutinizer', async () => {
    if (!ready) return;
    for (const tok of [deanTok, scrutinizerTok]) {
      const res = await request(app).get(`/api/appraisals/${subId}/review`).set(bearer(tok));
      expect(res.status).toBe(200);
      expect(res.body.totalScore).toBeTypeOf('number');
      expectNoAssessment(res.body);
    }
  });

  it('the list endpoint is stripped for the dean too', async () => {
    if (!ready) return;
    // Scoped to this suite's own faculty — the dean's unfiltered list is the
    // whole institute, which is far more than this assertion needs.
    const res = await request(app).get(`/api/appraisals?userId=${owner.id}`).set(bearer(deanTok));
    expect(res.status).toBe(200);
    const rows = Array.isArray(res.body) ? res.body : res.body.rows;
    expect(rows.some((r: any) => r.id === subId)).toBe(true);
    expectNoAssessment(res.body);
  });

  it('the department report is stripped for the dean and full for the HoD', async () => {
    if (!ready) return;
    const dean = await request(app)
      .get(`/api/reports/department?dept=${fixture!.deptId}`)
      .set(bearer(deanTok));
    expect(dean.status).toBe(200);
    expectNoAssessment(dean.body);

    const hod = await request(app).get('/api/reports/department').set(bearer(hodTok));
    expect(hod.status).toBe(200);
    const row = hod.body.find((r: any) => r.submission?.id === subId);
    expect(row?.grandTotal).toBeTypeOf('number');
  });
});
