import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';
import prisma from '../utils/prismaClient';
import { snapshotForViewer } from '../controllers/feedbackController';

// GET /appraisals/:id/feedback/pdf must follow the same visibility split as
// GET /appraisals/:id/feedback: the owner sees an ISSUED narrative and nothing
// of the eligibility machinery; the HoD of their department sees the standing
// too. Ownership decides, not role.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const PW = 'PdfTest@123';

let ready = false;
let facultyTok = '';
let hodTok = '';
let outsiderTok = '';
let submissionId = '';
let deptId = '';
let otherDeptId = '';
const userIds: string[] = [];

async function makeUser(code: string, name: string, departmentId: string) {
  const u = await prisma.user.create({
    data: {
      employeeCode: code, name, email: `${code.toLowerCase()}@fixture.invalid`,
      passwordHash: await bcrypt.hash(PW, 10), departmentId,
      designation: 'Assistant Professor', dateOfJoining: new Date('2018-07-01'),
    },
  });
  userIds.push(u.id);
  return u;
}

const login = async (code: string) => {
  const r = await request(app).post('/api/auth/login').send({ employeeCode: code, password: PW });
  return r.status === 200 ? r.body.accessToken : '';
};

beforeAll(async () => {
  try {
    const year = await prisma.academicYear.findFirst({ where: { submissionOpen: true } });
    if (!year) return;
    const stamp = Date.now() % 100000;

    const dept = await prisma.department.create({ data: { name: `PDF Dept ${stamp}`, code: `PDF${stamp}`, isActive: true } });
    const other = await prisma.department.create({ data: { name: `PDF Other ${stamp}`, code: `PDX${stamp}`, isActive: true } });
    deptId = dept.id;
    otherDeptId = other.id;

    const faculty = await makeUser(`PDFFAC${stamp}`, 'Pdf Faculty', dept.id);
    const hod = await makeUser(`PDFHOD${stamp}`, 'Pdf Hod', dept.id);
    const outsider = await makeUser(`PDFOUT${stamp}`, 'Pdf Outsider', other.id);

    await prisma.userRole.create({
      data: { userId: hod.id, role: 'HOD', departmentId: dept.id, assignedBy: hod.id },
    });
    await prisma.userRole.create({
      data: { userId: outsider.id, role: 'HOD', departmentId: other.id, assignedBy: outsider.id },
    });

    const sub = await prisma.appraisalSubmission.create({
      data: { userId: faculty.id, academicYearId: year.id, submissionNumber: 1 },
    });
    submissionId = sub.id;

    facultyTok = await login(faculty.employeeCode);
    hodTok = await login(hod.employeeCode);
    outsiderTok = await login(outsider.employeeCode);
    ready = Boolean(facultyTok && hodTok && outsiderTok && submissionId);
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  if (submissionId) {
    await prisma.feedback.deleteMany({ where: { submissionId } });
    await prisma.appraisalSubmission.deleteMany({ where: { id: submissionId } });
  }
  for (const id of userIds) {
    await prisma.auditLog.deleteMany({ where: { userId: id } }); // RESTRICT — before the user
    await prisma.emailNotification.deleteMany({ where: { toUserId: id } });
    await prisma.userRole.deleteMany({ where: { userId: id } });
    await prisma.user.deleteMany({ where: { id } });
  }
  for (const id of [deptId, otherDeptId]) {
    if (id) {
      await prisma.userRole.deleteMany({ where: { departmentId: id } });
      await prisma.department.deleteMany({ where: { id } });
    }
  }
});

describe('who gets the eligibility standing in their copy', () => {
  it('gives it to the HoD authoring the feedback', () => {
    expect(snapshotForViewer({ isOwner: false, editable: true })).toBe(true);
  });

  it('withholds it from the faculty who owns the appraisal', () => {
    expect(snapshotForViewer({ isOwner: true, editable: false })).toBe(false);
  });

  it('withholds it from an owner who is also an author elsewhere', () => {
    // A HoD or incharge filing their own appraisal is the owner first. Keying
    // this on role instead of ownership is the mistake this guards against.
    expect(snapshotForViewer({ isOwner: true, editable: true })).toBe(false);
  });

  it('withholds it from a viewer who can read but not author', () => {
    expect(snapshotForViewer({ isOwner: false, editable: false })).toBe(false);
  });
});

describe.skip('GET /appraisals/:id/feedback/pdf', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
  });

  it('404s while no feedback exists', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${submissionId}/feedback/pdf`).set(bearer(hodTok));
    expect(res.status).toBe(404);
  });

  it('refuses the owner a DRAFT feedback', async () => {
    if (!ready) return;
    const saved = await request(app)
      .put(`/api/appraisals/${submissionId}/feedback`)
      .set(bearer(hodTok))
      .send({ strengths: 'Draft only' });
    expect(saved.status).toBe(200);

    const res = await request(app).get(`/api/appraisals/${submissionId}/feedback/pdf`).set(bearer(facultyTok));
    expect(res.status).toBe(403);
  });

  it('refuses a HoD of another department outright', async () => {
    if (!ready) return;
    const res = await request(app).get(`/api/appraisals/${submissionId}/feedback/pdf`).set(bearer(outsiderTok));
    expect(res.status).toBe(403);
  });

  it('needs authentication', async () => {
    const res = await request(app).get(`/api/appraisals/${submissionId}/feedback/pdf`);
    expect(res.status).toBe(401);
  });

  it('serves the owner a PDF once it is issued', async () => {
    if (!ready) return;
    const issued = await request(app)
      .post(`/api/appraisals/${submissionId}/feedback/issue`)
      .set(bearer(hodTok))
      .send({ strengths: 'Strong teaching record.' });
    expect(issued.status).toBe(200);

    const res = await request(app)
      .get(`/api/appraisals/${submissionId}/feedback/pdf`)
      .set(bearer(facultyTok))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  }, 60000);
});
