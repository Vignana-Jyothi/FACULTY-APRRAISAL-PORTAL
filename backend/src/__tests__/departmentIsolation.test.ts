import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RoleType } from '@prisma/client';
import app from '../app';
import prisma from '../utils/prismaClient';
import { createFixture, type Fixture, type FixtureUser } from './helpers/fixtures';

// Departments are isolated. A HoD or reviewer holds that role only in the
// department they belong to. Cross-department authority belongs to the dean
// (ADMIN) and to dean-level final reviewers, who are assigned per submission
// through the final-review layer rather than by a standing role.
//
// Every subject is the suite's own: a throwaway dean, a faculty in a private
// department, and a second department. It used to borrow the seed account
// FAC11 and log in as ADMIN001 — the run left a ROLE_ASSIGNED and a LOGIN audit
// row behind each time, and its cleanup deleted the REVIEWER role it had just
// asserted, which would have removed a real one had FAC11 already held it.

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let ready = false;
let fixture: Fixture | null = null;
let admin: FixtureUser;
let faculty: FixtureUser;
let otherDeptId = '';

beforeAll(async () => {
  try {
    fixture = await createFixture('ISO');
    admin = await fixture.addUser({ name: 'ADM', role: RoleType.ADMIN });
    faculty = await fixture.addUser({ name: 'FAC' });
    otherDeptId = await fixture.addDepartment('ISX');
    ready = Boolean(admin.token && faculty.id && otherDeptId);
  } catch { ready = false; }
});

afterAll(async () => {
  await fixture?.destroy();
});

describe('role assignment respects department isolation', () => {
  it('has a working fixture (guards against a vacuous pass)', () => {
    expect(ready).toBe(true);
    expect(otherDeptId).not.toBe('');
    expect(otherDeptId).not.toBe(fixture!.deptId);
  });

  it('refuses a REVIEWER role in another department', async () => {
    if (!ready) return;
    const res = await request(app)
      .post(`/api/admin/users/${faculty.id}/roles`)
      .set(bearer(admin.token))
      .send({ role: 'REVIEWER', departmentId: otherDeptId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isolated|own department/i);
  });

  it('refuses a HOD role in another department', async () => {
    if (!ready) return;
    const res = await request(app)
      .post(`/api/admin/users/${faculty.id}/roles`)
      .set(bearer(admin.token))
      .send({ role: 'HOD', departmentId: otherDeptId });
    expect(res.status).toBe(400);
  });

  it('allows the role in the user\'s own department', async () => {
    if (!ready) return;
    const res = await request(app)
      .post(`/api/admin/users/${faculty.id}/roles`)
      .set(bearer(admin.token))
      .send({ role: 'REVIEWER', departmentId: fixture!.deptId });
    expect([200, 201]).toContain(res.status);
    const row = await prisma.userRole.findFirst({
      where: { userId: faculty.id, role: 'REVIEWER', departmentId: fixture!.deptId },
    });
    expect(row).toBeTruthy();
  });

  it('leaves the dean-level final-review layer alone — it is the sanctioned cross-department path', async () => {
    if (!ready) return;
    // Final reviewers are rows on FinalReview, not UserRole, so isolation of
    // standing roles does not constrain them.
    const anyRoleForOtherDept = await prisma.userRole.count({
      where: { userId: faculty.id, departmentId: otherDeptId, isActive: true },
    });
    expect(anyRoleForOtherDept).toBe(0);
  });
});
