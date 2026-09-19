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

/** Buffer a binary (PDF) response instead of letting supertest parse it. */
const asBuffer = (req: request.Test) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });

let ready = false;
let fixture: Fixture | null = null;
let owner: FixtureUser;
let hod: FixtureUser;
let hodTok = '', deanTok = '', scrutinizerTok = '', principalTok = '', adminTok = '', inchargeTok = '';
let scrutinizerId = '', subId = '';
// The HoD's OWN appraisal, reviewed by the department incharge. A HoD files one
// like everybody else, and it is the row a role-only visibility rule leaks back
// to them.
let hodSubId = '';
// { totalScore /500, grandTotal /550 } per submission, read as the principal.
let ownerScores: { totalScore: number; grandTotal: number };
let hodScores: { totalScore: number; grandTotal: number };

beforeAll(async () => {
  try {
    fixture = await createFixture('RVS');
    owner = await fixture.addUser({ name: 'FAC' });
    hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' });
    hodTok = hod.token;
    inchargeTok = (await fixture.addUser({ name: 'INC', role: RoleType.REVIEWER })).token;
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
    if (!hodTok || !deanTok || !principalTok || !adminTok || !scrutinizerTok || !inchargeTok) return;

    subId = await fixture.createSubmission(owner, { status: 'SUBMITTED' });
    hodSubId = await fixture.createSubmission(hod, { status: 'SUBMITTED' });

    // The HoD reviews it, entering the Cat 6 marks that everything below is
    // about. Without a review there is nothing to leak and the suite is vacuous.
    const reviewed = await request(app).post(`/api/appraisals/${subId}/review`).set(bearer(hodTok)).send({
      cat4Score: 20,
      cat6Punctuality: 9, cat6Professionalism: 9, cat6Willingness: 9,
      cat6Cordiality: 9, cat6Classroom: 9,
      overallComment: 'Solid year.', status: 'APPROVED',
    });

    // The incharge reviews the HoD's own appraisal — a HoD may not review
    // themselves (reviewerGuard), and without this row there is nothing for the
    // ownership check on /tracking to get wrong.
    const hodReviewed = await request(app).post(`/api/appraisals/${hodSubId}/review`).set(bearer(inchargeTok)).send({
      cat4Score: 18,
      cat6Punctuality: 8, cat6Professionalism: 8, cat6Willingness: 8,
      cat6Cordiality: 8, cat6Classroom: 8,
      overallComment: 'Good year.', status: 'APPROVED',
    });

    // The dean assigns the scrutinizer, which is what gives them their read.
    const assigned = await request(app)
      .post(`/api/admin/appraisals/${subId}/final-reviewers`)
      .set(bearer(deanTok)).send({ reviewerIds: [scrutinizerId] });

    // Read the two halves back as the principal, the one caller entitled to
    // both, so the assertions below compare against real numbers rather than
    // restating the arithmetic the scoring engine does.
    const read = async (id: string) => {
      const r = await request(app).get(`/api/appraisals/${id}/review`).set(bearer(principalTok));
      return { totalScore: r.body?.totalScore, grandTotal: r.body?.grandTotal };
    };
    ownerScores = await read(subId);
    hodScores = await read(hodSubId);

    ready = reviewed.status === 200
      && hodReviewed.status === 200
      && assigned.status === 201
      && typeof ownerScores.grandTotal === 'number'
      && typeof hodScores.grandTotal === 'number'
      // Cat 6 was actually scored, so the two totals differ and a mask is
      // observable. Equal totals would make every assertion below vacuous.
      && ownerScores.grandTotal > ownerScores.totalScore
      && hodScores.grandTotal > hodScores.totalScore;
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

    const hodRes = await request(app).get('/api/reports/department').set(bearer(hodTok));
    expect(hodRes.status).toBe(200);
    const row = hodRes.body.find((r: any) => r.submission?.id === subId);
    expect(row?.grandTotal).toBeTypeOf('number');
  });
});

// The tracking view does not carry `cat6*` or a literal `grandTotal` field — it
// carries the SAME NUMBER as `actuals.totalScore`. A field-name sweep sees
// nothing, so these assert the value instead.
describe('GET /tracking — the /550 is masked per row, by ownership', () => {
  it('shows a HoD the /550 for faculty in their department', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/tracking').set(bearer(hodTok));
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.faculty.id === owner.id);
    expect(row).toBeDefined();
    expect(row.actuals.totalScoreSource).toBe('HOD');
    expect(row.actuals.totalScore).toBe(ownerScores.grandTotal);
  });

  it('does NOT show a HoD the /550 on their OWN row', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/tracking').set(bearer(hodTok));
    expect(res.status).toBe(200);
    const mine = res.body.rows.find((r: any) => r.faculty.id === hod.id);
    expect(mine).toBeDefined();
    // The reviewed /500 they are entitled to, never the incharge's /550
    // assessment of them. Masking by role alone handed them the /550 here.
    expect(mine.actuals.totalScore).toBe(hodScores.totalScore);
    expect(mine.actuals.totalScore).not.toBe(hodScores.grandTotal);
  });

  it('gives the principal the /550 everywhere, including rows they review', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/tracking').set(bearer(principalTok));
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.faculty.id === owner.id);
    expect(row?.actuals.totalScore).toBe(ownerScores.grandTotal);
  });

  it('gives the dean the reviewed /500 on every row', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/tracking').set(bearer(deanTok));
    expect(res.status).toBe(200);
    for (const [id, s] of [[owner.id, ownerScores], [hod.id, hodScores]] as const) {
      const row = res.body.rows.find((r: any) => r.faculty.id === id);
      expect(row?.actuals.totalScore).toBe(s.totalScore);
      expect(row?.actuals.totalScore).not.toBe(s.grandTotal);
    }
    expectNoAssessment(res.body);
  });

  it('masks /tracking/export the same way, own row included', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/tracking/export').set(bearer(hodTok));
    expect(res.status).toBe(200);
    const find = (code: string) => res.body.find((r: any) => r['Employee Code'] === code);
    expect(find(owner.employeeCode)?.['Total Score']).toBe(ownerScores.grandTotal);
    expect(find(hod.employeeCode)?.['Total Score']).toBe(hodScores.totalScore);

    const dean = await request(app).get('/api/tracking/export').set(bearer(deanTok));
    expect(dean.status).toBe(200);
    const deanRow = dean.body.find((r: any) => r['Employee Code'] === owner.employeeCode);
    expect(deanRow?.['Total Score']).toBe(ownerScores.totalScore);
  });
});

describe('the remaining report surfaces', () => {
  it('/reports/criteria: HoD sees the /550 for their faculty but not for themselves', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/reports/criteria').set(bearer(hodTok));
    expect(res.status).toBe(200);
    const row = (id: string) => res.body.rows.find((r: any) => r.faculty.id === id);
    expect(row(owner.id)?.grandTotal).toBe(ownerScores.grandTotal);
    expect(row(hod.id)?.grandTotal).toBeNull();
    // Their own /500 is still theirs.
    expect(row(hod.id)?.reviewedTotal).toBe(hodScores.totalScore);
  });

  it('/reports/criteria: the dean gets no grand total at all', async () => {
    if (!ready) return;
    const res = await request(app)
      .get(`/api/reports/criteria?dept=${fixture!.deptId}`)
      .set(bearer(deanTok));
    expect(res.status).toBe(200);
    for (const r of res.body.rows) expect(r.grandTotal).toBeNull();
  });

  it('/reports/export: the Cat 6 columns are blank for the dean and on a HoD\'s own row', async () => {
    if (!ready) return;
    const hodRes = await request(app).get('/api/reports/export').set(bearer(hodTok));
    expect(hodRes.status).toBe(200);
    const find = (body: any[], code: string) => body.find((r: any) => r['Employee Code'] === code);
    expect(find(hodRes.body, owner.employeeCode)?.['Grand total /550']).toBe(ownerScores.grandTotal);
    expect(find(hodRes.body, hod.employeeCode)?.['Grand total /550']).toBe('');
    expect(find(hodRes.body, hod.employeeCode)?.['Core values (Cat 6) /50']).toBe('');

    const dean = await request(app)
      .get(`/api/reports/export?dept=${fixture!.deptId}`)
      .set(bearer(deanTok));
    expect(dean.status).toBe(200);
    expect(find(dean.body, owner.employeeCode)?.['Grand total /550']).toBe('');
    expect(find(dean.body, owner.employeeCode)?.['Core values (Cat 6) /50']).toBe('');
  });

  it('a department incharge is refused the score report outright', async () => {
    if (!ready) return;
    // Owner decision 2026-09-19: an incharge verifies proofs and reviews, but
    // the department's per-faculty totals and the criteria ranking stay with
    // the HoD. The guard refuses them rather than returning an empty report.
    for (const path of ['/api/reports/department', '/api/reports/criteria', '/api/reports/export']) {
      const res = await request(app).get(path).set(bearer(inchargeTok));
      expect(res.status).toBe(403);
    }
  });
});

describe('the appraisal PDF', () => {
  it('is stripped for the dean and full for the principal', async () => {
    if (!ready) return;
    const dean = await asBuffer(request(app).get(`/api/appraisals/${subId}/pdf`).set(bearer(deanTok)));
    const principal = await asBuffer(request(app).get(`/api/appraisals/${subId}/pdf`).set(bearer(principalTok)));
    expect(dean.status).toBe(200);
    expect(principal.status).toBe(200);
    // Same appraisal, same renderer: the only difference is the Cat 6 block and
    // the grand total, which the dean's copy must not contain.
    expect(dean.body.length).toBeLessThan(principal.body.length);
  }, 120000);

  it('an assigned scrutinizer may download it; the admin may not', async () => {
    if (!ready) return;
    const scr = await asBuffer(request(app).get(`/api/appraisals/${subId}/pdf`).set(bearer(scrutinizerTok)));
    expect(scr.status).toBe(200);

    const admin = await request(app).get(`/api/appraisals/${subId}/pdf`).set(bearer(adminTok));
    expect(admin.status).toBe(403);

    // The scrutinizer's assignment is to `subId` only — it is not a standing
    // cross-department read of everything.
    const other = await request(app).get(`/api/appraisals/${hodSubId}/pdf`).set(bearer(scrutinizerTok));
    expect(other.status).toBe(403);
  }, 120000);

  it('GET /appraisals/:id/score opens for the assigned scrutinizer only', async () => {
    if (!ready) return;
    const mine = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(scrutinizerTok));
    expect(mine.status).toBe(200);
    expectNoAssessment(mine.body);

    // Unassigned submission, same scrutinizer: still forbidden.
    const other = await request(app).get(`/api/appraisals/${hodSubId}/score`).set(bearer(scrutinizerTok));
    expect(other.status).toBe(403);

    // The admin holds no appraisal content.
    const admin = await request(app).get(`/api/appraisals/${subId}/score`).set(bearer(adminTok));
    expect(admin.status).toBe(403);
  });
});
