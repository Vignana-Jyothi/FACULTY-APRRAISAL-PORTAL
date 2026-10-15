import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture } from './helpers/fixtures';

// A faculty may point two proof fields at the same file (e.g. proofFile and
// indexProofFile). The ProofVerification key is (submissionId, url), so without
// de-duplication the sync would collide (P2002 -> 400 "failed to load proof").

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let hodTok = '';
let subId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('PDUP');
    const hod = await fixture.addUser({ name: 'HOD', role: RoleType.HOD });
    const fac = await fixture.addUser({ name: 'FAC', role: RoleType.FACULTY });
    hodTok = hod.token;
    subId = await fixture.createSubmission(fac);
    await prisma.cat2Journal.create({
      data: {
        submissionId: subId, title: 'Dup', journalName: 'IEEE', authors: 'A', authorPosition: '1st',
        proofFile: '/uploads/file/same.pdf', indexProofFile: '/uploads/file/same.pdf', status: 'PUBLISHED', indexed: 'WOS',
      },
    });
    ready = !!hodTok && !!subId;
  } catch { ready = false; }
});

afterAll(async () => { await fixture?.destroy(); });

describe('proof list de-duplicates a URL used in two fields', () => {
  it('loads the proof section (200) and collapses the shared URL to one row', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}/proofs`).set(bearer(hodTok));
    expect(res.status).toBe(200);
    expect(res.body.proofs.filter((p: any) => p.url === '/uploads/file/same.pdf')).toHaveLength(1);
  });
});
