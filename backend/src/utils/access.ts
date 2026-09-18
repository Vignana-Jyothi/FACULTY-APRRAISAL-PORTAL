import { RoleType } from '@prisma/client';
import { INSTITUTE_READ } from './roles';

export interface AccessUser {
  id: string;
  roles: Array<{ role: RoleType; departmentId: string | null }>;
}

/**
 * Object-level authorization for a resource owned by a faculty member.
 * Prevents IDOR — changing an :id in the URL must not reach another account.
 *
 * Allowed: the owner, the principal or the dean (institute-wide), or a
 * HoD/Reviewer of the owner's department.
 *
 * The ADMIN is deliberately NOT here any more — it is a maintenance account and
 * holds no appraisal content (2026-09-18 role rework). A scrutinizer is not
 * here either: their cross-department reach is granted per submission through
 * `FinalReview`, and the callers that allow it check that assignment
 * explicitly after this returns false.
 */
export function canViewUserResource(
  user: AccessUser,
  ownerId: string,
  ownerDepartmentId: string | null,
): boolean {
  if (user.id === ownerId) return true;
  if (user.roles.some((r) => INSTITUTE_READ.includes(r.role))) return true;
  return user.roles.some(
    (r) =>
      (r.role === RoleType.HOD || r.role === RoleType.REVIEWER) &&
      r.departmentId != null &&
      r.departmentId === ownerDepartmentId,
  );
}
