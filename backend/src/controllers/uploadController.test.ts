import { describe, it, expect } from 'vitest';
import { canAccess } from './uploadController';

type Roles = Array<{ role: any; departmentId: string | null }>;
const u = (id: string, roles: Roles = []) => ({ id, employeeCode: id, roles });

describe('canAccess — proof file authorization (IDOR guard)', () => {
  const OWNER = 'user-owner';
  const DEPT = 'dept-cse';

  it('owner can access own file', () => {
    expect(canAccess(u(OWNER), OWNER, DEPT)).toBe(true);
  });

  // 2026-09-18 role rework: proof files are appraisal content, so the
  // maintenance admin no longer reaches them. The principal does.
  it('the maintenance admin cannot access a proof file', () => {
    expect(canAccess(u('admin', [{ role: 'ADMIN', departmentId: null }]), OWNER, DEPT)).toBe(false);
  });

  it('the principal can access any file', () => {
    expect(canAccess(u('principal', [{ role: 'PRINCIPAL', departmentId: null }]), OWNER, DEPT)).toBe(true);
  });

  it('HoD of the same department can access', () => {
    expect(canAccess(u('hod', [{ role: 'HOD', departmentId: DEPT }]), OWNER, DEPT)).toBe(true);
  });

  it('Reviewer of the same department can access', () => {
    expect(canAccess(u('rev', [{ role: 'REVIEWER', departmentId: DEPT }]), OWNER, DEPT)).toBe(true);
  });

  it('HoD of a DIFFERENT department is denied', () => {
    expect(canAccess(u('hod2', [{ role: 'HOD', departmentId: 'dept-ece' }]), OWNER, DEPT)).toBe(false);
  });

  it('another faculty cannot access (the IDOR case)', () => {
    expect(canAccess(u('stranger', [{ role: 'FACULTY', departmentId: DEPT }]), OWNER, DEPT)).toBe(false);
  });

  it('HoD with null department is denied even if uploader dept is null', () => {
    expect(canAccess(u('hod3', [{ role: 'HOD', departmentId: null }]), OWNER, null)).toBe(false);
  });
});
