import { RoleType } from '@prisma/client';

/**
 * One source of truth for "which roles may do this".
 *
 * Before the 2026-09-18 rework every powerful route was `roleGuard([ADMIN])`
 * and every scoping helper asked `isAdmin`. The admin is now a maintenance
 * account (accounts, roles, email queue, audit log) and the appraisal-content
 * powers are split between the principal, the dean and the scrutinizer pool.
 * Routes and helpers import these sets instead of naming roles inline, so a
 * change of policy is one edit here rather than forty.
 *
 * See docs/superpowers/plans/role-hierarchy-rework.md.
 */

/** App maintenance only. No appraisal content, no Cat 6, no tier. */
export const MAINTENANCE: RoleType[] = [RoleType.ADMIN];

/** Institute-wide sight of everything, Cat 6 and the /550 grand total included. */
export const SEES_ALL: RoleType[] = [RoleType.PRINCIPAL];

/** Configuration: review windows, cadre targets/tiers, academic years, departments. */
export const CONFIG: RoleType[] = [RoleType.DEAN, RoleType.PRINCIPAL];

/** Tier allocation: tracking edits and `setFacultyTier`. */
export const TIER: RoleType[] = [RoleType.DEAN, RoleType.SPECIAL_SCRUTINIZER, RoleType.PRINCIPAL];

/** Department-level review: the HoD and the department incharge. */
export const DEPT_REVIEW: RoleType[] = [RoleType.HOD, RoleType.REVIEWER];

/** Every role whose authority crosses department lines. */
export const CROSS_DEPT: RoleType[] = [
  RoleType.PRINCIPAL,
  RoleType.DEAN,
  RoleType.SCRUTINIZER,
  RoleType.SPECIAL_SCRUTINIZER,
];

/**
 * Cross-department roles that may read ANY submission unprompted.
 *
 * Deliberately narrower than CROSS_DEPT: a scrutinizer's cross-department reach
 * is per submission, granted by the dean through `FinalReview`, not standing.
 */
export const INSTITUTE_READ: RoleType[] = [RoleType.PRINCIPAL, RoleType.DEAN];

/** The standing scrutinizer pool the dean assigns from. */
export const SCRUTINY_POOL: RoleType[] = [RoleType.SCRUTINIZER, RoleType.SPECIAL_SCRUTINIZER];

/** Reads of a whole department's appraisal content: reports, red list, tracking. */
// Reading a department's SCORE report is the HoD's, not the incharge's: an
// incharge verifies proofs and reviews, but the per-faculty totals and the
// criteria ranking stay with the HoD (owner decision 2026-09-19).
export const DEPT_CONTENT_READ: RoleType[] = [RoleType.HOD, ...CONFIG];

/** Roles that carry a departmentId. Everything else is institute-wide. */
export const DEPARTMENT_SCOPED: RoleType[] = [RoleType.HOD, RoleType.REVIEWER];

/** Roles that must NOT be assigned with a departmentId. */
export const INSTITUTE_WIDE: RoleType[] = [
  RoleType.ADMIN,
  RoleType.FACULTY,
  RoleType.PRINCIPAL,
  RoleType.DEAN,
  RoleType.SCRUTINIZER,
  RoleType.SPECIAL_SCRUTINIZER,
];

export interface RoleHolder {
  roles: Array<{ role: RoleType; departmentId?: string | null }>;
}

/** True when the caller holds any of `allowed`. */
export function hasAnyRole(user: RoleHolder | undefined | null, allowed: RoleType[]): boolean {
  if (!user) return false;
  return user.roles.some((r) => allowed.includes(r.role));
}

/** The departments the caller holds one of `roles` in (nulls dropped). */
export function deptIdsFor(user: RoleHolder, roles: RoleType[] = DEPT_REVIEW): string[] {
  return user.roles
    .filter((r) => roles.includes(r.role))
    .map((r) => r.departmentId)
    .filter((d): d is string => !!d);
}

/** True when the caller's reads are not limited to their own department(s). */
export function seesAllDepartments(user: RoleHolder): boolean {
  return hasAnyRole(user, INSTITUTE_READ);
}
