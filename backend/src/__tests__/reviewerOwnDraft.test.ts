import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// A reviewer (incharge) is also a faculty member: they must be able to edit
// their OWN appraisal draft, and an uploaded proof must survive the save even
// before its row's title is typed. Owns its fixtures.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let reviewer: FixtureUser;
let subId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('ROD');
    // A reviewer who is also a faculty (the normal incharge setup).
    reviewer = await fixture.addUser({ name: 'REV', roles: [RoleType.REVIEWER, RoleType.FACULTY] });
    subId = await fixture.createSubmission(reviewer);
    ready = !!reviewer.token && !!subId;
  } catch (e) {
    console.error('ROD setup failed', e);
    ready = false;
  }
});

afterAll(async () => { await fixture?.destroy(); });

describe('reviewer editing their own draft', () => {
  it('has a working fixture', () => { expect(ready).toBe(true); });

  it('lets the reviewer-owner edit their own DRAFT', async () => {
    if (!ready) return;
    const res = await request(app).put(`/api/appraisals/${subId}`).set(bearer(reviewer.token))
      .send({ categories: { cat2Journals: [{ title: 'My Paper', journalName: 'IEEE', authors: 'REV', authorPosition: '1st', allAuthorsFromCampus: false, indexed: 'WOS' }] } });
    expect(res.status).toBe(200);
  });

  it('keeps a row whose only content is an uploaded proof (upload does not disappear)', async () => {
    if (!ready) return;
    // The form always sends the row's other fields as empty strings.
    const res = await request(app).put(`/api/appraisals/${subId}`).set(bearer(reviewer.token))
      .send({ categories: { cat2Journals: [{ title: '', journalName: '', authors: '', authorPosition: '', proofFile: '/uploads/file/proof-only.pdf' }] } });
    expect(res.status).toBe(200);

    // The proof-only row persisted (was not stripped as blank).
    const got = await request(app).get(`/api/appraisals/${subId}`).set(bearer(reviewer.token));
    expect(got.status).toBe(200);
    const journals = got.body.categories?.cat2Journals ?? got.body.cat2Journals ?? [];
    expect(journals.some((j: any) => j.proofFile === '/uploads/file/proof-only.pdf')).toBe(true);
  });
});
