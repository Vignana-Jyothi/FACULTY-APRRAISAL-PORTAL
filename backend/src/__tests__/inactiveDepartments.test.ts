import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture } from './helpers/fixtures';

// GET /departments hides inactive departments from every form and picker. That
// also hid anything still attached to one: an incharge assigned before a
// department was switched off disappeared from the Incharges page and could no
// longer be revoked. The admin and the dean may now ask for the full list — and
// nobody else, whatever they pass.


const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const PW = 'DeptTest@123';

let ready = false;
let fixture: Fixture | null = null;
let deanTok = '';
let facultyTok = '';
let deadDeptId = '';
let liveDeptId = '';
let userId = '';

beforeAll(async () => {
  try {
    // A throwaway dean, not the seed ADMIN001: every login is audited, and so
    // is each reactivation below — the fixture removes both with the admin.
    fixture = await createFixture('IDP');
    deanTok = (await fixture.addUser({ name: 'DEA', role: RoleType.DEAN })).token;
    if (!deanTok) return;

    const stamp = Date.now() % 100000;
    // Own both fixtures rather than borrowing a real department.
    const dead = await prisma.department.create({
      data: { name: `Switched Off Dept ${stamp}`, code: `OFF${stamp}`, isActive: false },
    });
    const live = await prisma.department.create({
      data: { name: `Switched On Dept ${stamp}`, code: `ON${stamp}`, isActive: true },
    });
    deadDeptId = dead.id;
    liveDeptId = live.id;

    const u = await prisma.user.create({
      data: {
        employeeCode: `DEPTTEST${stamp}`,
        name: 'Dept Flag Fixture',
        email: `dept.flag.${stamp}@fixture.invalid`,
        passwordHash: await bcrypt.hash(PW, 10),
        departmentId: live.id,
      },
    });
    userId = u.id;

    const fr = await request(app)
      .post('/api/auth/login')
      .send({ employeeCode: u.employeeCode, password: PW });
    if (fr.status !== 200) return;
    facultyTok = fr.body.accessToken;
    ready = true;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  if (userId) {
    await prisma.auditLog.deleteMany({ where: { userId } }); // RESTRICT — before the user
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  for (const id of [deadDeptId, liveDeptId]) {
    if (id) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'Department', entityId: id } });
      await prisma.userRole.deleteMany({ where: { departmentId: id } });
      await prisma.department.deleteMany({ where: { id } });
    }
  }
  await fixture?.destroy();
});

const ids = (body: any[]) => body.map((d) => d.id);

describe('GET /departments — inactive departments', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(deadDeptId).not.toBe('');
    expect(facultyTok).not.toBe('');
  });

  it('hides inactive departments by default, even from the dean', async () => {
    if (!ready) return;
    const res = await request(app).get('/api/departments').set(bearer(deanTok));
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(liveDeptId);
    expect(ids(res.body)).not.toContain(deadDeptId);
  });

  it('includes them for a dean who asks', async () => {
    if (!ready) return;
    const res = await request(app)
      .get('/api/departments?includeInactive=true')
      .set(bearer(deanTok));
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(deadDeptId);
    expect(ids(res.body)).toContain(liveDeptId);
    expect(res.body.find((d: any) => d.id === deadDeptId).isActive).toBe(false);
  });

  it('ignores the flag for a plain faculty', async () => {
    if (!ready) return;
    const res = await request(app)
      .get('/api/departments?includeInactive=true')
      .set(bearer(facultyTok));
    expect(res.status).toBe(200);
    expect(ids(res.body)).not.toContain(deadDeptId);
  });

  it('needs authentication at all', async () => {
    const res = await request(app).get('/api/departments?includeInactive=true');
    expect(res.status).toBe(401);
  });
});

// Deactivating hid the department from every list, including the page that
// deactivated it, and updateDepartment only ever accepted name and code — so
// there was no way back. EEE, ECE and ME have been off by design since the
// project went CSE-only and nothing could have switched them on again.
describe('POST /admin/departments/:id/reactivate', () => {
  it('turns a deactivated department back on', async () => {
    if (!ready) return;
    const res = await request(app)
      .post(`/api/admin/departments/${deadDeptId}/reactivate`)
      .set(bearer(deanTok));
    expect(res.status).toBe(200);
    expect(res.body.department.isActive).toBe(true);

    // It is now in the plain list, with no flag needed.
    const list = await request(app).get('/api/departments').set(bearer(deanTok));
    expect(ids(list.body)).toContain(deadDeptId);
  });

  it('records it in the audit log', async () => {
    if (!ready) return;
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'Department', entityId: deadDeptId },
    });
    expect(rows.map((r) => r.action)).toContain('DEPARTMENT_REACTIVATED');
  });

  it('is idempotent on an already-active department', async () => {
    if (!ready) return;
    const res = await request(app)
      .post(`/api/admin/departments/${liveDeptId}/reactivate`)
      .set(bearer(deanTok));
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already active/i);
  });

  it('404s for a department that does not exist', async () => {
    if (!ready) return;
    const res = await request(app)
      .post('/api/admin/departments/00000000-0000-0000-0000-000000000000/reactivate')
      .set(bearer(deanTok));
    expect(res.status).toBe(404);
  });

  it('refuses a plain faculty', async () => {
    if (!ready) return;
    const res = await request(app)
      .post(`/api/admin/departments/${deadDeptId}/reactivate`)
      .set(bearer(facultyTok));
    expect(res.status).toBe(403);
  });
});
