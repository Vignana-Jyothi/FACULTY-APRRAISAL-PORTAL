import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import prisma from '../utils/prismaClient';
import { renderTemplate } from '../services/emailTemplates';

// Faculty own their score out of 500 and must be told it, including after a
// reviewer changes it. Category 6 (core values) and the /550 grand total are
// the reviewer's assessment of them and belong to the HoD and dean only.

const payload = {
  name: 'Test Faculty', year: '2026-27', submissionNumber: 1, submissionId: 'sub-1',
  reviewerName: 'HoD', reviewedAt: '01-01-2026',
  cat1: '120.0', cat2: '90.0', cat3: '70.0', cat4: '40.0', cat5: '30.0',
  selfTotal: '400.0', reviewedTotal: '390.0',
  overallComment: 'Evidence for two journals was thin.',
  teachingComment: '', researchComment: '', developmentComment: '',
  governanceComment: '', supplementaryComment: '',
};

describe('approval email — what the faculty is shown', () => {
  const html = renderTemplate('submission_approved', payload);

  it('shows both totals out of 500 so a changed score is visible', () => {
    expect(html).toContain('400.0 / 500');
    expect(html).toContain('390.0 / 500');
    expect(html).toMatch(/Self-assessed total/i);
    expect(html).toMatch(/Reviewed total/i);
  });

  it('carries the reviewer comments', () => {
    expect(html).toContain('Evidence for two journals was thin.');
  });

  it('never mentions Category 6 or the 550 grand total', () => {
    expect(html).not.toMatch(/Cat\s*6/i);
    expect(html).not.toMatch(/Core Values/i);
    expect(html).not.toContain('550');
    expect(html).not.toMatch(/Grand Total/i);
  });

  it('leaks nothing even if a cat6 or grandTotal value is passed by mistake', () => {
    const leaky = renderTemplate('submission_approved', { ...payload, cat6: '45.0', grandTotal: '435.0' });
    expect(leaky).not.toContain('45.0');
    expect(leaky).not.toContain('435.0');
    expect(leaky).not.toContain('550');
  });

  it('before review, shows only the self total', () => {
    const { reviewedTotal, ...beforeReview } = payload;
    const received = renderTemplate('submission_received', beforeReview);
    expect(received).toContain('400.0 / 500');
    expect(received).not.toMatch(/Reviewed total/i);
    expect(received).not.toContain('550');
  });
});


// The visibility rule keys off OWNERSHIP, not role. A HoD or incharge submits an
// appraisal of their own, and a role-only check handed them the core-values
// marks and grand total recorded against it. Nobody sees the reviewer's
// assessment of themselves, whatever roles they hold.
//
// So the owner here holds HOD, and the reviewer holds HOD in the same
// department: ownership is the only thing separating them. An earlier version
// of this suite used a plain faculty account as the owner, which cannot
// distinguish the two rules at all — and the leak in GET /appraisals/:id and in
// the PDF survived underneath it.
//
// It also owns its subjects. It used to build the fixture on the seed account
// FAC11 and tidy up in afterAll; an aborted run then left an APPROVED
// submission behind on a shared account.
describe('own appraisal — staff viewing their own submission', () => {
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PW = 'OwnView@123';
  const login = async (c: string) => {
    const r = await request(app).post('/api/auth/login').send({ employeeCode: c, password: PW });
    return r.status === 200 ? r.body.accessToken : '';
  };
  const asBuffer = (req: request.Test) =>
    req.buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  let ready = false, ownerTok = '', reviewerTok = '', subId = '', deptId = '';
  const userIds: string[] = [];

  beforeAll(async () => {
    try {
      const year = await prisma.academicYear.findFirst({ where: { submissionOpen: true } });
      if (!year) return;
      const stamp = Date.now() % 100000;
      const hash = await bcrypt.hash(PW, 10);

      const dept = await prisma.department.create({
        data: { name: `Own View Dept ${stamp}`, code: `OWV${stamp}`, isActive: true },
      });
      deptId = dept.id;

      const mkHod = async (code: string, name: string) => {
        const u = await prisma.user.create({
          data: {
            employeeCode: code, name, email: `${code.toLowerCase()}@fixture.invalid`,
            passwordHash: hash, departmentId: dept.id, designation: 'Professor',
            dateOfJoining: new Date('2010-07-01'),
          },
        });
        userIds.push(u.id);
        await prisma.userRole.create({
          data: { userId: u.id, role: 'HOD', departmentId: dept.id, assignedBy: u.id },
        });
        return u;
      };

      const owner = await mkHod(`OWVOWN${stamp}`, 'Own View Owner');
      const reviewer = await mkHod(`OWVREV${stamp}`, 'Own View Reviewer');

      const mk = (r: string) => ({ responsibility: r, level: 'Department', workInvolved: 'Committee', period: '2026' });
      const sub = await prisma.appraisalSubmission.create({
        data: {
          userId: owner.id, academicYearId: year.id, submissionNumber: 1, status: 'SUBMITTED',
          cat4AdminResp: { create: [mk('A'), mk('B'), mk('C')] },
        },
      });
      subId = sub.id;

      ownerTok = await login(owner.employeeCode);
      reviewerTok = await login(reviewer.employeeCode);
      if (!ownerTok || !reviewerTok) return;

      const reviewed = await request(app).post(`/api/appraisals/${subId}/review`).set(bearer(reviewerTok)).send({
        cat4Score: 20, cat6Punctuality: 9, cat6Professionalism: 9, cat6Willingness: 9,
        cat6Cordiality: 9, cat6Classroom: 9, overallComment: 'Thin evidence.', status: 'APPROVED',
      });
      ready = reviewed.status === 200;
    } catch {
      ready = false;
    }
  });

  afterAll(async () => {
    if (subId) {
      await prisma.auditLog.deleteMany({ where: { entityId: subId } });
      await prisma.appraisalReview.deleteMany({ where: { submissionId: subId } });
      await prisma.appraisalSubmission.deleteMany({ where: { id: subId } });
    }
    for (const id of userIds) {
      await prisma.appraisalSubmission.deleteMany({ where: { userId: id } });
      await prisma.auditLog.deleteMany({ where: { userId: id } }); // RESTRICT — before the user
      await prisma.emailNotification.deleteMany({ where: { toUserId: id } });
      await prisma.userRole.deleteMany({ where: { userId: id } });
      await prisma.user.deleteMany({ where: { id } });
    }
    if (deptId) {
      await prisma.userRole.deleteMany({ where: { departmentId: deptId } });
      await prisma.department.deleteMany({ where: { id: deptId } });
    }
  });

  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });

  it('gets their reviewed score out of 500 and the comments', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}/review`).set(bearer(ownerTok));
    expect(res.status).toBe(200);
    expect(res.body.totalScore).toBe(20);
    expect(res.body.cat4Score).toBe(20);
    expect(res.body.overallComment).toBe('Thin evidence.');
  });

  it('does not get Category 6 or the grand total from GET /review', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}/review`).set(bearer(ownerTok));
    expect(res.body.grandTotal).toBeUndefined();
    expect(res.body.cat6Punctuality).toBeUndefined();
    expect(res.body.cat6Classroom).toBeUndefined();
  });

  it('does not get them from GET /appraisals/:id either', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${subId}`).set(bearer(ownerTok));
    expect(res.status).toBe(200);
    for (const f of ['cat6Punctuality', 'cat6Professionalism', 'cat6Willingness',
                     'cat6Cordiality', 'cat6Classroom', 'grandTotal']) {
      expect(res.body.review?.[f]).toBeUndefined();
    }
  });

  it('gets a PDF without the reviewer assessment the other HoD gets', async () => {
    if (!ready) return;
    const mine = await asBuffer(request(app).get(`/api/appraisals/${subId}/pdf`).set(bearer(ownerTok)));
    const theirs = await asBuffer(request(app).get(`/api/appraisals/${subId}/pdf`).set(bearer(reviewerTok)));
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    // Same appraisal, same renderer — the only difference is the Cat 6 block and
    // the grand total, which the owner's copy must not contain.
    expect(mine.body.length).toBeLessThan(theirs.body.length);
  }, 90000);

  it('the HoD who does not own it still sees everything', async () => {
    if (!ready) return;
    const review = await request(app).get(`/api/appraisals/${subId}/review`).set(bearer(reviewerTok));
    expect(review.body.grandTotal).toBeTypeOf('number');
    expect(review.body.cat6Punctuality).toBe(9);

    const full = await request(app).get(`/api/appraisals/${subId}`).set(bearer(reviewerTok));
    expect(full.body.review?.grandTotal).toBeTypeOf('number');
    expect(full.body.review?.cat6Punctuality).toBe(9);
  });
});
