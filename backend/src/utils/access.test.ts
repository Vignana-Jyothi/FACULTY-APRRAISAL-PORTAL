import { describe, it, expect } from 'vitest';
import { canViewUserResource } from './access';

const u = (id: string, roles: any[] = []) => ({ id, roles });
const OWNER = 'owner';
const DEPT = 'dept-cse';

describe('canViewUserResource — object-level authz (IDOR guard)', () => {
  it('owner sees own resource', () => {
    expect(canViewUserResource(u(OWNER), OWNER, DEPT)).toBe(true);
  });
  it('principal and dean see any resource', () => {
    expect(canViewUserResource(u('p', [{ role: 'PRINCIPAL', departmentId: null }]), OWNER, DEPT)).toBe(true);
    expect(canViewUserResource(u('d', [{ role: 'DEAN', departmentId: null }]), OWNER, DEPT)).toBe(true);
  });
  it('admin is denied — a maintenance account holds no appraisal content', () => {
    expect(canViewUserResource(u('a', [{ role: 'ADMIN', departmentId: null }]), OWNER, DEPT)).toBe(false);
  });
  it('a scrutinizer has no standing read — assignment grants it per submission', () => {
    expect(canViewUserResource(u('s', [{ role: 'SCRUTINIZER', departmentId: null }]), OWNER, DEPT)).toBe(false);
    expect(canViewUserResource(u('s2', [{ role: 'SPECIAL_SCRUTINIZER', departmentId: null }]), OWNER, DEPT)).toBe(false);
  });
  it('HoD/Reviewer of same dept sees it', () => {
    expect(canViewUserResource(u('h', [{ role: 'HOD', departmentId: DEPT }]), OWNER, DEPT)).toBe(true);
    expect(canViewUserResource(u('r', [{ role: 'REVIEWER', departmentId: DEPT }]), OWNER, DEPT)).toBe(true);
  });
  it('HoD/Reviewer of another dept is denied', () => {
    expect(canViewUserResource(u('h', [{ role: 'HOD', departmentId: 'dept-ece' }]), OWNER, DEPT)).toBe(false);
  });
  it('unrelated faculty is denied (IDOR case)', () => {
    expect(canViewUserResource(u('x', [{ role: 'FACULTY', departmentId: DEPT }]), OWNER, DEPT)).toBe(false);
  });
  it('null departments do not match', () => {
    expect(canViewUserResource(u('h', [{ role: 'HOD', departmentId: null }]), OWNER, null)).toBe(false);
  });
});
