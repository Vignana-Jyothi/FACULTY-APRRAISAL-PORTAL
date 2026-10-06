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

/** Institute-wide app maintenance only. No appraisal content, no Cat 6, no tier. */
export const MAINTENANCE: RoleType[] = [RoleType.ADMIN];

/**
 * Account maintenance: managing faculty accounts, resetting passwords, and
 * reading the email queue and audit log. The institute ADMIN does this across
 * every department; a DEPT_ADMIN does it only within their own department —
 * every route and controller below narrows a DEPT_ADMIN to their dept, so this
 * set grants *reach*, not *scope*. Role assignment, bulk import and the email
 * retry/trigger controls stay ADMIN-only (MAINTENANCE), never DEPT_ADMIN.
 */
export const ACCOUNT_ADMIN: RoleType[] = [RoleType.ADMIN, RoleType.DEPT_ADMIN];

/**
 * Who may create and list faculty accounts. The HoD is added here (on top of
 * ACCOUNT_ADMIN) so a HoD can add faculty to their OWN department — the
 * createUser/listUsers handlers confine a HoD to their department via
 * accountAdminScope, exactly as they do a DEPT_ADMIN. The destructive and
 * role-granting routes (update, deactivate, reset, role assignment) stay on
 * ACCOUNT_ADMIN / MAINTENANCE — a HoD creates and views, it does not edit or
 * stand down existing accounts.
 */
export const USER_MANAGE: RoleType[] = [RoleType.ADMIN, RoleType.DEPT_ADMIN, RoleType.HOD];

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
export const DEPARTMENT_SCOPED: RoleType[] = [RoleType.HOD, RoleType.REVIEWER, RoleType.DEPT_ADMIN];

/** Roles that must NOT be assigned with a departmentId. */
export const INSTITUTE_WIDE: RoleType[] = [
  RoleType.ADMIN,
  RoleType.FACULTY,
  RoleType.PRINCIPAL,
  RoleType.DEAN,
  RoleType.SCRUTINIZER,
  RoleType.SPECIAL_SCRUTINIZER,
];

/**
 * The departments a DEPT_ADMIN maintains. Empty for anyone who is not a
 * department admin (including the institute ADMIN, whose reach is every
 * department and is expressed by `isFullAdmin` instead).
 */
export function deptAdminScope(user: RoleHolder): string[] {
  return deptIdsFor(user, [RoleType.DEPT_ADMIN]);
}

/** True for the institute-wide maintenance admin (unrestricted by department). */
export function isFullAdmin(user: RoleHolder | undefined | null): boolean {
  return hasAnyRole(user, MAINTENANCE);
}

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
