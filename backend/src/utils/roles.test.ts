import { describe, it, expect } from 'vitest';
import { RoleType } from '@prisma/client';
import {
  MAINTENANCE,
  SEES_ALL,
  CONFIG,
  TIER,
  DEPT_REVIEW,
  CROSS_DEPT,
  INSTITUTE_READ,
  SCRUTINY_POOL,
  DEPT_CONTENT_READ,
  DEPARTMENT_SCOPED,
  INSTITUTE_WIDE,
  hasAnyRole,
  deptIdsFor,
  seesAllDepartments,
} from './roles';

const user = (...roles: Array<[RoleType, string | null]>) => ({
  roles: roles.map(([role, departmentId]) => ({ role, departmentId })),
});

describe('role sets', () => {
  it('the admin is maintenance only — in no content or config set', () => {
    for (const set of [SEES_ALL, CONFIG, TIER, DEPT_REVIEW, CROSS_DEPT, INSTITUTE_READ, DEPT_CONTENT_READ]) {
      expect(set).not.toContain(RoleType.ADMIN);
    }
    expect(MAINTENANCE).toEqual([RoleType.ADMIN]);
  });

  it('the principal is in every authority set', () => {
    for (const set of [SEES_ALL, CONFIG, TIER, CROSS_DEPT, INSTITUTE_READ, DEPT_CONTENT_READ]) {
      expect(set).toContain(RoleType.PRINCIPAL);
    }
  });

  it('a plain scrutinizer allocates no tier and configures nothing', () => {
    expect(TIER).not.toContain(RoleType.SCRUTINIZER);
    expect(TIER).toContain(RoleType.SPECIAL_SCRUTINIZER);
    expect(CONFIG).not.toContain(RoleType.SCRUTINIZER);
    expect(CONFIG).not.toContain(RoleType.SPECIAL_SCRUTINIZER);
  });

  it('scrutinizers have no standing cross-department read', () => {
    expect(CROSS_DEPT).toEqual(expect.arrayContaining(SCRUTINY_POOL));
    for (const r of SCRUTINY_POOL) expect(INSTITUTE_READ).not.toContain(r);
  });

  it('department-scoped and institute-wide roles partition the enum', () => {
    const all = [...DEPARTMENT_SCOPED, ...INSTITUTE_WIDE].sort();
    expect(all).toEqual(Object.values(RoleType).sort());
    for (const r of DEPARTMENT_SCOPED) expect(INSTITUTE_WIDE).not.toContain(r);
  });
});

describe('helpers', () => {
  it('hasAnyRole matches on any held role and tolerates no user', () => {
    expect(hasAnyRole(user([RoleType.DEAN, null]), CONFIG)).toBe(true);
    expect(hasAnyRole(user([RoleType.HOD, 'd1']), CONFIG)).toBe(false);
    expect(hasAnyRole(undefined, CONFIG)).toBe(false);
  });

  it('deptIdsFor returns only the departments of the roles asked for', () => {
    const u = user([RoleType.HOD, 'd1'], [RoleType.REVIEWER, 'd2'], [RoleType.DEAN, null]);
    expect(deptIdsFor(u, DEPT_REVIEW).sort()).toEqual(['d1', 'd2']);
    expect(deptIdsFor(u, [RoleType.HOD])).toEqual(['d1']);
    // A null department is never a match — it would read as "every department".
    expect(deptIdsFor(user([RoleType.HOD, null]), DEPT_REVIEW)).toEqual([]);
  });

  it('seesAllDepartments is the principal and the dean, nobody else', () => {
    expect(seesAllDepartments(user([RoleType.PRINCIPAL, null]))).toBe(true);
    expect(seesAllDepartments(user([RoleType.DEAN, null]))).toBe(true);
    expect(seesAllDepartments(user([RoleType.SCRUTINIZER, null]))).toBe(false);
    expect(seesAllDepartments(user([RoleType.ADMIN, null]))).toBe(false);
    expect(seesAllDepartments(user([RoleType.HOD, 'd1']))).toBe(false);
  });
});
