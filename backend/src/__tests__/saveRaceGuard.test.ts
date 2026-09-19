import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// The server half of the appraisal-form save race (utils/wipeGuard). A form
// that saves before its draft loads sends every category empty, and
// updateAppraisal replaces whatever it is sent — so one early click used to
// wipe a whole draft. That save must be refused (409) and the rows kept, while
// a deliberate edit that empties ONE category still goes through.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let owner: FixtureUser;
let subId = '';

async function rowCounts() {
  const [admin, memberships] = await Promise.all([
    prisma.cat4AdminResp.count({ where: { submissionId: subId } }),
    prisma.cat5Membership.count({ where: { submissionId: subId } }),
  ]);
  return { admin, memberships };
}

beforeAll(async () => {
  try {
    fixture = await createFixture('SRG');
    owner = await fixture.addUser({ name: 'FAC', role: RoleType.FACULTY });
    if (!owner.token) return;
    // A DRAFT with rows in two categories.
    subId = await fixture.createSubmission(owner, {
      status: 'DRAFT',
      cat4AdminResp: {
        create: [{ responsibility: 'Timetable coordinator', level: 'Department', workInvolved: 'Weekly', period: '2025-26' }],
      },
      cat5Memberships: {
        create: [
          { association: 'IEEE', status: 'Member' },
          { association: 'CSI', status: 'Life Member' },
        ],
      },
    });
    ready = true;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('save-race guard on PUT /appraisals/:id', () => {
  it('has a working fixture (guards against a vacuous pass)', async () => {
    expect(ready).toBe(true);
    expect(await rowCounts()).toEqual({ admin: 1, memberships: 2 });
  });

  it('refuses a save that empties every category (409) and keeps the rows', async () => {
    if (!ready) return;
    const res = await request(app)
      .put(`/api/appraisals/${subId}`)
      .set(bearer(owner.token))
      .send({ categories: { cat4AdminResp: [], cat5Memberships: [], cat1Courses: [], cat2Journals: [] } });
    expect(res.status).toBe(409);
    expect(await rowCounts()).toEqual({ admin: 1, memberships: 2 });
  });

  it('accepts a save that empties just one category (200)', async () => {
    if (!ready) return;
    const res = await request(app)
      .put(`/api/appraisals/${subId}`)
      .set(bearer(owner.token))
      .send({
        categories: {
          cat4AdminResp: [],
          cat5Memberships: [
            { association: 'IEEE', status: 'Member' },
            { association: 'CSI', status: 'Life Member' },
          ],
        },
      });
    expect(res.status).toBe(200);
    expect(await rowCounts()).toEqual({ admin: 0, memberships: 2 });
  });
});
