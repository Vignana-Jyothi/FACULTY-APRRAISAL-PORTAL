import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture } from './helpers/fixtures';

// W7 — per-cadre tier threshold endpoints (dean/principal only). Real app + DB.
// Self-skips if the DB is unreachable — and the fixture guard then fails.
//
// Everything is the suite's own: a dean, a faculty, and a throwaway academic
// year carrying one cadre target. It used to work on the OPEN year and "restore"
// by deleting every cadre-tier cell in it — real configuration included — and
// logged in as ADMIN001 / FAC21. Deleting the year cascades its cells and target.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let deanTok = '';
let facTok = '';
let yearId = '';

async function listCells() {
  const res = await request(app).get(`/api/admin/cadre-tiers?academicYearId=${yearId}`).set(bearer(deanTok));
  return res.body as Array<{ id: string; cadre: string; tier: string; criteria: any }>;
}

beforeAll(async () => {
  try {
    fixture = await createFixture('CTC');
    deanTok = (await fixture.addUser({ name: 'DEA', role: RoleType.DEAN })).token;
    facTok = (await fixture.addUser({ name: 'FAC' })).token;
    if (!deanTok || !facTok) return;
    const year = await prisma.academicYear.create({
      data: { label: `W7-TEST-${Date.now()}`, startDate: new Date('2098-07-01'), endDate: new Date('2099-06-30'), submissionOpen: false },
    });
    yearId = year.id;
    // One target, so seed-defaults has exactly one cadre to seed.
    await prisma.cadreTarget.create({
      data: {
        academicYearId: year.id, cadre: 'PROFESSOR', minExpYears: 0, maxExpYears: null,
        totalScoreTarget: 375, feedbackTarget: 3.5, indexedCount: 2, minJournal: 1,
        quartileSet: null, ppcRule: 'MANDATORY', ppcCount: 1,
      },
    });
    ready = true;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  if (yearId) await prisma.academicYear.delete({ where: { id: yearId } }).catch(() => {});
  await fixture?.destroy();
});

describe('W7 fixture', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });
});

describe('W7 cadre-tiers gating', () => {
  const routes: Array<[string, string]> = [
    ['get', '/api/admin/cadre-tiers'],
    ['put', '/api/admin/cadre-tiers'],
    ['post', '/api/admin/cadre-tiers/seed-defaults'],
    ['delete', '/api/admin/cadre-tiers/some-id'],
  ];
  for (const [m, p] of routes) {
    it(`${m.toUpperCase()} ${p} without token → 401`, async () => {
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

describe('W7 cadre-tiers upsert', () => {
  it('dean lists cells (array)', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/admin/cadre-tiers?academicYearId=${yearId}`).set(bearer(deanTok));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('upsert one cell → echoes cadre/tier/criteria, then delete', async () => {
    if (!ready) return;
    const criteria = {
      totalScore: { enabled: true, value: 400 },
      feedback: { enabled: true, value: 4 },
      patentCount: { enabled: false, value: 0 },
    };
    const up = await request(app)
      .put('/api/admin/cadre-tiers')
      .set(bearer(deanTok))
      .send({ academicYearId: yearId, cadre: 'PROFESSOR', tier: 'T1', criteria });
    expect(up.status).toBe(200);
    expect(up.body.cadre).toBe('PROFESSOR');
    expect(up.body.tier).toBe('T1');
    expect(up.body.criteria).toEqual(criteria);

    // Upsert again (same key) updates rather than duplicating.
    const up2 = await request(app)
      .put('/api/admin/cadre-tiers')
      .set(bearer(deanTok))
      .send({ academicYearId: yearId, cadre: 'PROFESSOR', tier: 'T1', criteria: { totalScore: { enabled: true, value: 450 } } });
    expect(up2.status).toBe(200);
    expect(up2.body.id).toBe(up.body.id);
    expect(up2.body.criteria).toEqual({ totalScore: { enabled: true, value: 450 } });

    const del = await request(app).delete(`/api/admin/cadre-tiers/${up.body.id}`).set(bearer(deanTok));
    expect(del.status).toBe(204);
  });

  it('unknown academic year → 404', async () => {
    if (!ready) return;
    const res = await request(app)
      .put('/api/admin/cadre-tiers')
      .set(bearer(deanTok))
      .send({ academicYearId: 'no-such-year', cadre: 'PROFESSOR', tier: 'T1', criteria: { totalScore: { enabled: true, value: 1 } } });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown criterion key → 400 (strict)', async () => {
    if (!ready) return;
    const res = await request(app)
      .put('/api/admin/cadre-tiers')
      .set(bearer(deanTok))
      .send({ academicYearId: yearId, cadre: 'PROFESSOR', tier: 'T1', criteria: { bogusMetric: { enabled: true, value: 1 } } });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed criterion shape → 400', async () => {
    if (!ready) return;
    const res = await request(app)
      .put('/api/admin/cadre-tiers')
      .set(bearer(deanTok))
      .send({ academicYearId: yearId, cadre: 'PROFESSOR', tier: 'T1', criteria: { totalScore: { enabled: 'yes' } } });
    expect(res.status).toBe(400);
  });
});

describe('W7 seed-defaults → tracking', () => {
  it('seeds cadre×tier cells from targets', async () => {
    if (!ready) return;
    expect(await listCells()).toHaveLength(0);

    const seed = await request(app)
      .post('/api/admin/cadre-tiers/seed-defaults')
      .set(bearer(deanTok))
      .send({ academicYearId: yearId });
    expect(seed.status).toBe(201);
    // The throwaway year has one target (PROFESSOR), so exactly one cadre seeds.
    expect(seed.body.seededCadres).toEqual(['PROFESSOR']);

    // Each seeded cadre gets 3 tier cells; defaults enable totalScore.
    const cells = await listCells();
    expect(cells.map((c) => c.tier).sort()).toEqual(['T1', 'T2', 'T3']);
    expect(cells[0].criteria.totalScore.enabled).toBe(true);
    // NOTE: thresholds no longer drive tracking — tiers are assigned manually
    // (PUT /admin/faculty-tiers). This test only covers the threshold endpoints.
    // No clean-up here: deleting the throwaway year in afterAll removes them.
  });
});
