import { RoleType } from '@prisma/client';

/**
 * Who may see the reviewer's own assessment of a faculty member.
 *
 * An appraisal carries two halves. Categories 1-5 and the total out of 500 are
 * the faculty's score and they are entitled to it. Category 6 (core values) and
 * the /550 grand total are the reviewer's assessment OF them, and belong to the
 * HoD (and incharge) of their own department and to the principal. The dean,
 * the scrutinizer pool and the admin see the /500 only.
 *
 * The check is on OWNERSHIP, not role. Every HoD files their own appraisal, and
 * a role-only test ("is this caller a reviewer anywhere?") hands them the
 * core-values marks recorded against themselves. Nobody sees the reviewer's
 * assessment of their own appraisal, whatever else they are.
 *
 * This lives in one place because the rule was previously restated at each
 * endpoint and the copies drifted — the PDF kept printing Cat 6 and the grand
 * total for owners long after the JSON stopped.
 */

// Fields that carry the reviewer's assessment of the person, not their score.
export const REVIEWER_ASSESSMENT_FIELDS = [
  'cat6Punctuality',
  'cat6Professionalism',
  'cat6Willingness',
  'cat6Cordiality',
  'cat6Classroom',
  'grandTotal',
] as const;

type Viewer = { id: string; roles: { role: RoleType; departmentId?: string | null }[] };

/** Roles whose holders are not plain faculty when looking at someone else's appraisal. */
const PRIVILEGED: RoleType[] = [
  RoleType.ADMIN,
  RoleType.HOD,
  RoleType.REVIEWER,
  RoleType.PRINCIPAL,
  RoleType.DEAN,
  RoleType.SCRUTINIZER,
  RoleType.SPECIAL_SCRUTINIZER,
];

/** True when this caller must be shown the faculty's view of the appraisal. */
export function isOwnerView(viewer: Viewer, ownerId: string): boolean {
  if (viewer.id === ownerId) return true;
  return !viewer.roles.some((r) => PRIVILEGED.includes(r.role));
}

/**
 * True when this caller may see Category 6 and the /550 grand total for this
 * faculty. The single gate for the reviewer's assessment (2026-09-18 rework).
 *
 * - Owner: never, whatever else they are.
 * - Principal: everywhere — the only institute-wide holder of this.
 * - HoD / incharge of the faculty's OWN department: yes, they entered it.
 * - Dean, scrutinizers, special scrutinizers, admin, everyone else: no. /500 only.
 */
export function canSeeReviewerAssessment(
  viewer: Viewer,
  ownerId: string,
  ownerDepartmentId: string | null,
): boolean {
  if (viewer.id === ownerId) return false;
  if (viewer.roles.some((r) => r.role === RoleType.PRINCIPAL)) return true;
  return viewer.roles.some(
    (r) =>
      (r.role === RoleType.HOD || r.role === RoleType.REVIEWER) &&
      r.departmentId != null &&
      r.departmentId === ownerDepartmentId,
  );
}

/** The same review with the reviewer's assessment of the person removed. */
export function stripReviewerAssessment<T extends Record<string, any> | null>(review: T): T {
  if (!review) return review;
  const out: Record<string, any> = { ...review };
  for (const f of REVIEWER_ASSESSMENT_FIELDS) delete out[f];
  return out as T;
}
