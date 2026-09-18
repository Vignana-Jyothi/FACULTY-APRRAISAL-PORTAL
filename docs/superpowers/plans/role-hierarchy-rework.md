# Role hierarchy rework (2026-09-18)

## Target hierarchy

| Role | Scope |
|---|---|
| `ADMIN` | App maintenance only: accounts, bulk import, role assignment, password resets, email queue, audit log. **No appraisal content**, no Cat 6, no tier. |
| `PRINCIPAL` | Sees everything, institute-wide. **The only role that sees Cat 6 (+50) and the /550 grand total across departments.** Superset of dean + HoD reads. |
| `DEAN` | Tier allocation and tier decisions, cadre tier thresholds + tier windows, cadre targets, review windows, academic-year open/close, departments. Assigns scrutinizers. |
| `SCRUTINIZER` | Pool of 10-15. Cross-department. Assigned per submission by the dean (today's `FinalReview` layer). Sees /500 only. |
| `SPECIAL_SCRUTINIZER` | 2-3 of the pool. Scrutinizer powers **plus** tier allocation (tracking + `setFacultyTier`). |
| `HOD` | Unchanged. Own department: review, Cat 6 entry, reads back own entry, feedback, red list, dept reports. |
| `REVIEWER` | Unchanged. Department incharge: proof verification, review in own department. |
| `FACULTY` | Unchanged. |

## Decisions (owner, 2026-09-18)
1. HoD sees the Cat 6 marks they entered, for their own department. Principal sees them everywhere. Dean, scrutinizers, **admin** and faculty do not.
2. Scrutinizer = today's `FinalReview` layer, extended: dean assigns from a standing pool, cross-department, one approval finalises.
3. Admin keeps accounts + role assignment.
4. Dean owns review windows, cadre targets/eligibility rules, AY open/close, departments.
5. "Quartile date sets" = cadre tier thresholds + the date windows for tier decisions. Not journal quartiles.
6. Scrutinizers see /500 — Cat 6 and /550 stripped exactly as for faculty.
7. (2026-09-19) Red list and clear-hold admit `REVIEWER` as well as `HOD` — it is
   the department's proof-chasing workflow and the incharge does that work. The
   dean and special scrutinizers stay out: they allocate tiers, not proofs.
8. (2026-09-19) An assigned scrutinizer may read the appraisal, its `/review`,
   its `/score` and its PDF — all stripped. Unassigned pool members get 403.

## Phases

### P1 — Schema + role assignment
- `RoleType` += `PRINCIPAL`, `DEAN`, `SCRUTINIZER`, `SPECIAL_SCRUTINIZER`.
- `assignRole`: department required for `HOD`/`REVIEWER` only; new roles are institute-wide and must reject a `departmentId`.
- `npm run prisma:push` (backend app process stopped first).
- Bootstrap (owner decision 2026-09-18): **separate accounts per role.** `ADMIN001` stays `ADMIN` only and loses appraisal content. New demo accounts, all password `Demo@123`, mail to the user's Gmail + aliases:
  - `PRIN001` "Dr. Demo Principal" -> +principal
  - `DEAN001` "Dr. Demo Dean" -> +dean
  - `SCRU001` "Demo Scrutinizer One" -> +scru1 (SCRUTINIZER)
  - `SCRU002` "Demo Scrutinizer Two" -> +scru2 (SPECIAL_SCRUTINIZER)
  Created through the real API after the push, never by re-seeding.

### P2 — Authorization core (`backend/src/utils/roles.ts`, new)
One source of truth for role sets; every route and helper imports it.
- `MAINTENANCE = [ADMIN]`
- `SEES_ALL = [PRINCIPAL]`
- `CONFIG = [DEAN, PRINCIPAL]`
- `TIER = [DEAN, SPECIAL_SCRUTINIZER, PRINCIPAL]`
- `DEPT_REVIEW = [HOD, REVIEWER]`
- `CROSS_DEPT = [PRINCIPAL, DEAN, SCRUTINIZER, SPECIAL_SCRUTINIZER]`
Rewire: `roleGuard` route lists, `utils/access.canViewUserResource`, `reportController.reportUserWhere`, `appraisalController.listAppraisals`, red list / proofs overview scoping, `feedbackController.canAuthor`.
**Admin loses appraisal-content routes** (all-appraisals, reports, tracking, unlock/reopen) — they move to principal/dean.

### P3 — Cat 6 and /550 visibility
`utils/reviewVisibility.ts` is the one gate. New rule, keyed on ownership **and** role:
- Owner: stripped (unchanged).
- Principal: full.
- HoD/Reviewer of that faculty's department: full.
- Dean, scrutinizers, special scrutinizers, admin: stripped, /500 only.
Applies to the JSON endpoint, the appraisal PDF, the review page, the final-review payload, and every email template.

### P4 — Scrutinizer pool and assignment
- Assignment route moves `ADMIN` -> `DEAN` (+ principal).
- Pool listing endpoint: users holding `SCRUTINIZER`/`SPECIAL_SCRUTINIZER`.
- Assigned scrutinizer keeps cross-department read of that submission only; payload stripped per P3.

### P5 — Tier and tracking
- `GET /tracking`, `/tracking/export`: `HOD` (own dept), `DEAN`, `SPECIAL_SCRUTINIZER`, `PRINCIPAL`.
- `PUT /admin/faculty-tiers`, cadre tiers/targets, review windows: `TIER` / `CONFIG` sets.
- Snapshot trigger: `DEAN` + `PRINCIPAL`, dry-run default unchanged.

### P6 — Frontend
- `authStore`: `hasRole` helpers per new role; drop `isAdmin()` as the catch-all for power.
- `ProtectedRoute` role lists; `Layout` nav per role; admin pages split into maintenance (`/admin/*`) vs dean (`/dean/*`) vs principal (`/principal/*`).
- `TrackingPage` edit columns gated on the tier set, not `isAdmin()`.
- `FinalReviewPage` shows /500, never /550.
- `RoleAssignModal` offers the new roles, department only for HoD/Reviewer.

### P7 — Tests, seed, docs
- Guard tests per role set; a leak test that dean/scrutinizer/admin payloads carry no `cat6*` or `grandTotal`.
- Demo accounts for principal, dean, scrutinizer, special scrutinizer.
- Update `CLAUDE.md` department-isolation section and `docs/architecture.html`.

## Risks
- Every existing `isAdmin()` / `RoleType.ADMIN` check is a decision point — 39 admin routes, ~47 frontend refs.
- Admin losing content access locks ADMIN001 out of appraisal content by design; create PRIN001 before relying on the demo.
- Cat 6 stripping must not break the HoD review page that writes those marks.
