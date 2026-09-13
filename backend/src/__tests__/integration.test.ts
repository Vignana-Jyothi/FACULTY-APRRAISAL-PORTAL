import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import { createFixture, FIXTURE_PW, type Fixture, type FixtureUser } from './helpers/fixtures';

// Integration tests hit the real Express app + DB.
// If the DB is unreachable the suite skips itself (so CI without a database
// still passes `npm test`) — and the fixture guard below then fails, so a skip
// never reads as a pass.
//
// Every account is the suite's own: a throwaway dean, faculty and HoD in a
// private department. It used to log in as ADMIN001 and review as the seed
// account FAC11, and each run left their LOGIN / REVIEW_APPROVED audit rows
// and a password OTP mail behind.

let dbReady = false;
let fixture: Fixture | null = null;
let admin: FixtureUser;
let faculty: FixtureUser;
let reviewer: FixtureUser;

beforeAll(async () => {
  try {
    fixture = await createFixture('ITG');
    admin = await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN });
    faculty = await fixture.addUser({ name: 'FAC' });
    reviewer = await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' });
    dbReady = Boolean(admin.token && faculty.token && reviewer.token);
  } catch (e) {
    console.warn('[integration] DB unreachable — skipping integration suite.');
    dbReady = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('Fixture', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(dbReady).toBe(true);
  });
});

describe('Auth', () => {
  it('rejects bad credentials with 401', async () => {
    if (!dbReady) return;
    const res = await request(app).post('/api/auth/login').send({ employeeCode: faculty.employeeCode, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('valid admin login returns token + roles', async () => {
    if (!dbReady) return;
    const res = await request(app).post('/api/auth/login').send({ employeeCode: admin.employeeCode, password: FIXTURE_PW });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.roles.some((r: any) => r.role === 'ADMIN')).toBe(true);
  });

  it('forgot-password returns generic message (no enumeration)', async () => {
    if (!dbReady) return;
    const real = await request(app).post('/api/auth/forgot-password').send({ employeeCode: faculty.employeeCode });
    const fake = await request(app).post('/api/auth/forgot-password').send({ employeeCode: 'NOPE999' });
    expect(real.status).toBe(200);
    expect(fake.status).toBe(200);
    expect(real.body.message).toBe(fake.body.message);
  });
});

describe('Authorization guards', () => {
  it('protected route without token → 401', async () => {
    if (!dbReady) return;
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('faculty hitting admin route → 403', async () => {
    if (!dbReady) return;
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${faculty.token}`);
    expect(res.status).toBe(403);
  });

  it('admin can list users', async () => {
    if (!dbReady) return;
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Full appraisal workflow', () => {
  it('create → fill → submit → review → approve → visibility rules', async () => {
    if (!dbReady) return;

    const facTok = faculty.token;
    const revTok = reviewer.token; // HoD of the faculty's own department

    // Whichever year is actually open — this used to hardcode '2025-26', which
    // broke the moment that year was closed. A closed year rejects the create.
    const years = await request(app).get('/api/academic-years').set('Authorization', `Bearer ${facTok}`);
    const year = years.body.find((y: any) => y.submissionOpen);
    expect(year).toBeTruthy();

    // Create
    const created = await request(app)
      .post('/api/appraisals')
      .set('Authorization', `Bearer ${facTok}`)
      .send({ academicYearId: year.id });
    expect(created.status).toBe(201);
    const subId = created.body.id;
    fixture!.track(subId);

    // One-appraisal-per-year guard: a 2nd create while one is active → 400.
    const dup = await request(app)
      .post('/api/appraisals')
      .set('Authorization', `Bearer ${facTok}`)
      .send({ academicYearId: year.id });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/already have an appraisal/i);

    // Fill (minimal — one SCI journal = 15 pts)
    const fill = await request(app)
      .put(`/api/appraisals/${subId}`)
      .set('Authorization', `Bearer ${facTok}`)
      .send({
        categories: {
          cat2Journals: [{
            title: 'Test Paper', journalName: 'IEEE', authors: 'Integration Test Faculty', authorPosition: 'First',
            indexed: 'WOS', impactFactor: 3, volume: '1', issueNo: '1', pageNos: '1-10',
            dateOfPub: '2025-06-01', quartile: 'Q1', doi: '', issn: '',
          }],
        },
      });
    expect(fill.status).toBe(200);

    // Score (faculty self)
    const score = await request(app).get(`/api/appraisals/${subId}/score`).set('Authorization', `Bearer ${facTok}`);
    expect(score.status).toBe(200);
    expect(score.body.cat2.total).toBeGreaterThanOrEqual(15);

    // Submit
    const submitted = await request(app).post(`/api/appraisals/${subId}/submit`).set('Authorization', `Bearer ${facTok}`);
    expect(submitted.status).toBe(200);

    // The department's HoD approves
    const review = await request(app)
      .post(`/api/appraisals/${subId}/review`)
      .set('Authorization', `Bearer ${revTok}`)
      .send({
        cat6Punctuality: 9, cat6Professionalism: 9, cat6Willingness: 8, cat6Cordiality: 10, cat6Classroom: 9,
        overallComment: 'Approved', status: 'APPROVED',
      });
    expect(review.status).toBe(200);

    // Faculty visibility — scores must NOT leak
    const facReview = await request(app).get(`/api/appraisals/${subId}/review`).set('Authorization', `Bearer ${facTok}`);
    expect(facReview.status).toBe(200);
    // The faculty's own score out of 500 is theirs to see, including the
    // reviewer's per-category marks. What stays hidden is Category 6 and
    // the /550 grand total — the reviewer's assessment of them.
    expect(facReview.body.cat1Score).toBeTypeOf('number');
    expect(facReview.body.totalScore).toBeTypeOf('number');
    expect(facReview.body.grandTotal).toBeUndefined();
    expect(facReview.body.cat6Punctuality).toBeUndefined();
    expect(facReview.body.cat6Classroom).toBeUndefined();
    expect(facReview.body.overallComment).toBe('Approved');

    // Reviewer sees full scores
    const revReview = await request(app).get(`/api/appraisals/${subId}/review`).set('Authorization', `Bearer ${revTok}`);
    expect(revReview.body.grandTotal).toBeTypeOf('number');
  });
});
