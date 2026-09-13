import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { TRACKING_INCLUDE, loadTrackingContext, computeRow } from '../services/trackingService';
import { buildQuarterlyPayload } from '../cron/quarterlySnapshot';
import { renderTemplate } from '../services/emailTemplates';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// Faculty own their score out of 500. Once the HoD has reviewed an appraisal,
// the tracking engine measures the total-score target against the reviewer's
// /550 grand total — right for the dean's tracking view, wrong for anything a
// faculty reads. Two faculty-facing texts are built from that machinery: the
// annual feedback draft (pre-filled for the HoD, then issued to the faculty)
// and the quarterly email, whose payload is stored and re-rendered on retry.
// Neither may carry the grand total.
//
// The grand total is a number nothing else here could produce, and the
// faculty's cadre has targets in the open year, so the total-score requirement
// row exists — without it these checks would pass with nothing to leak.

const GRAND = 537.5;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let faculty: FixtureUser;
let hod: FixtureUser;
let subId = '';

beforeAll(async () => {
  try {
    const year = await prisma.academicYear.findFirst({ where: { submissionOpen: true } });
    if (!year) return;
    const targets = await prisma.cadreTarget.count({ where: { academicYearId: year.id, cadre: 'ASSISTANT_PROFESSOR' } });
    if (!targets) return;

    fixture = await createFixture('FBT');
    faculty = await fixture.addUser({ name: 'FAC', designation: 'Assistant Professor' });
    hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD, designation: 'Professor' });
    if (!faculty.token || !hod.token) return;

    subId = await fixture.createSubmission(faculty, {
      status: 'APPROVED',
      review: {
        create: {
          reviewerId: hod.id, reviewerRole: 'HOD', status: 'APPROVED',
          cat1Score: 100, cat2Score: 100, cat3Score: 100, cat4Score: 40, cat5Score: 40,
          cat6Punctuality: 10, cat6Professionalism: 10, cat6Willingness: 10, cat6Cordiality: 10, cat6Classroom: 17.5,
          selfTotalScore: 0, totalScore: 380, grandTotal: GRAND,
        },
      },
    });
    ready = true;
  } catch (e) {
    console.error('[feedbackTotals] fixture failed:', e);
    ready = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('the reviewer\'s /550 grand total stays out of faculty-facing feedback', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });

  it('the tracking engine does carry it — so there is something to leak', async () => {
    if (!ready) return;
    const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId }, include: TRACKING_INCLUDE });
    const year = await prisma.academicYear.findUniqueOrThrow({ where: { id: sub.academicYearId } });
    const row = computeRow(sub, await loadTrackingContext(year.id), year.startDate);
    expect(row.actuals.totalScore).toBe(GRAND);
    expect(row.eligibility.requirements.find((r) => r.key === 'totalScore')?.actual).toBe(String(GRAND));
  });

  it('the annual feedback draft the HoD pre-fills (and issues) uses the faculty\'s own total', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}/feedback`).set(bearer(hod.token));
    expect(res.status).toBe(200);
    const total = res.body.autoSnapshot.requirements.find((r: any) => r.key === 'totalScore');
    expect(total).toBeTruthy();
    expect(total.actual).not.toBe(String(GRAND));
    expect(JSON.stringify(res.body.autoSnapshot)).not.toContain(String(GRAND));
    expect(JSON.stringify(res.body.suggested)).not.toContain(String(GRAND));
  });

  it('the quarterly email payload and its rendered mail never carry it', async () => {
    if (!ready) return;
    const sub = await prisma.appraisalSubmission.findUniqueOrThrow({ where: { id: subId }, include: TRACKING_INCLUDE });
    const year = await prisma.academicYear.findUniqueOrThrow({ where: { id: sub.academicYearId } });
    const row = computeRow(sub, await loadTrackingContext(year.id), year.startDate);
    const payload = buildQuarterlyPayload(sub, row, year.label, 'Q1');

    expect(JSON.stringify(payload)).not.toContain(String(GRAND));
    expect(renderTemplate('quarterly_feedback', payload)).not.toContain(String(GRAND));
    // Nor the machinery the faculty is not shown.
    expect(payload).not.toHaveProperty('cadre');
    expect(payload).not.toHaveProperty('tier');
    expect(payload).not.toHaveProperty('eligible');
    expect(payload).not.toHaveProperty('requirements');
  });
});
