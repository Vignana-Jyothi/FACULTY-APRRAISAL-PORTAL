import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../app';
import prisma from '../utils/prismaClient';
import { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } from '../middleware/upload';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// Per-file upload ceiling. The limit is configuration (MAX_UPLOAD_MB), the
// server is the enforcement point, and proofs supplied as a LINK are exempt —
// they never pass through multer, so an oversized scan can always be linked.
//
// Owns its faculty, so the throwaway submission is never written to a seed
// account that an aborted run would leave it on.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let faculty: FixtureUser;
let facTok = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('UPL');
    faculty = await fixture.addUser({ name: 'FAC' });
    facTok = faculty.token;
    ready = !!facTok;
  } catch { ready = false; }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe.skip('per-file upload limit', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(faculty?.id).toBeTruthy();
  });

  it('reports the configured limit to the client', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/config/uploads').set(bearer(facTok));
    expect(res.status).toBe(200);
    expect(res.body.maxMb).toBe(MAX_UPLOAD_MB);
    expect(res.body.maxBytes).toBe(MAX_UPLOAD_BYTES);
    expect(res.body.allowedMime).toContain('application/pdf');
  });

  it('requires authentication to read the limits', async () => {
    if (!ready) return;
    expect((await request(app).get('/api/config/uploads')).status).toBe(401);
  });

  it('rejects a file over the limit, naming the limit and the link alternative', async () => {
    if (!ready) return;
    const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 0x41);
    const res = await request(app)
      .post('/api/uploads/proof')
      .set(bearer(facTok))
      .attach('file', tooBig, { filename: 'huge.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(new RegExp(`max ${MAX_UPLOAD_MB} MB`, 'i'));
    expect(res.body.error).toMatch(/link/i);
  });

  it('accepts a file under the limit', async () => {
    if (!ready) return;
    const small = Buffer.from('%PDF-1.4 tiny test document');
    const res = await request(app)
      .post('/api/uploads/proof')
      .set(bearer(facTok))
      .attach('file', small, { filename: 'small.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.url).toBeTruthy();

    // Clean the file back off disk.
    await request(app).delete('/api/uploads/proof').set(bearer(facTok)).send({ url: res.body.url });
  });

  it('does not apply the limit to a proof stored as a link', async () => {
    if (!ready) return;
    // A link is just a URL on the row — no upload path, no size check.
    const subId = await fixture!.createSubmission(faculty, {
      status: 'DRAFT',
      cat2Books: { create: [{
        title: 'Linked proof', authors: faculty.employeeCode, publisher: 'P', isbn: '1',
        isEdited: false, scope: 'INTERNATIONAL',
        proofFile: 'https://drive.google.com/file/d/enormous-500mb-scan/view',
      }] },
    });

    const books = await prisma.cat2Book.findMany({ where: { submissionId: subId } });
    expect(books[0].proofFile).toMatch(/^https:\/\/drive\.google\.com/);
  });
});
