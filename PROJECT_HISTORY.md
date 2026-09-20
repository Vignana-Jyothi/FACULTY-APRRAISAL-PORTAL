# Project History — VNRVJIET Faculty Appraisal System

A chronological record of everything built, fixed, and decided across the development of this system. Newest phases at the bottom.

> **This log stops at Phase 10 (July 2026) and is history, not a description of
> the system as it stands.** Much of what it records has since been superseded —
> the four-role model became seven roles, the quarterly submission became one
> draft carried across the whole academic year, and the FPGP module was retired
> on 2026-09-13 (code deleted, database models kept). For the current system
> read [README.md](README.md), [TUTORIAL.md](TUTORIAL.md),
> [HANDOFF.md](HANDOFF.md) and `docs/architecture.html`; for what changed after
> July, read `git log`.

---

## Phase 0 — Foundation

Full-stack faculty appraisal portal implemented from the LLD in `FACULTY_APPRAISAL_SYSTEM_LLD.md`.

- **Stack chosen**: React 18 + Vite + TypeScript + Tailwind v4 (frontend), Node + Express 4 + TypeScript (backend), PostgreSQL + Prisma 6.
- **Roles**: Faculty, HoD, Reviewer, Admin (multi-role per user supported).
- **Core appraisal**: multi-step form for Categories 1–5, server-side scoring engine (max 550 incl. reviewer Cat 6), strict faculty-visibility rules (reviewer scores never leaked).
- **Review workflow**: reviewer/HoD scores Cat 6, writes comments, approves/rejects.

### Early fixes
- Prisma v7 config parse error → downgraded to Prisma 6, restored `url = env("DATABASE_URL")`.
- Express 5 type errors → downgraded to Express 4.
- TypeScript enum narrowing (RoleType, SubmissionStatus, PublicationIndex) → added `as` casts.
- Prisma 6 null-in-composite-unique (seed) → `ensureRole()` findFirst+create helper.
- Empty date strings → Prisma DateTime error → `cleanRow()` helper.
- NaN from blank number inputs → recursive `deNan()` scrubber.
- Backend crash on async Zod throw → added `express-async-errors`.

---

## Phase 1 — Appraisal Form Completion

Built out all 24 subsections of the appraisal form per `APPRAISAL_FORM_IMPL_PLAN.md`:
- 26 `useFieldArray` blocks across Cat 1–5.
- Auto-save with race-condition lock + NaN guards.
- Read-only fieldset once submitted.
- Preview step with score breakdown.
- Full E2E verified via `test-workflow.ps1` (login → fill → submit → review → approve → visibility check).

---

## Phase 2 — FPGP v2 (Faculty Performance Growth Plan)

Rebuilt FPGP to match the official VNRVJIET docx template (`FPGP_V2_IMPL_PLAN.md`):
- **4 categories, 21 subsections**, 7 renderer types (duoText, fixedRows, pgUgRows, dynamicRows, rigGroup, phdGuidance, memberships).
- Single source of truth in `fpgpTemplate.ts`.
- Profile snapshot on plan creation; min-2 professional-society memberships enforced on signing (subsection 3.2).
- Faculty digital sign → ACTIVE; HoD counter-sign → REVIEWED.
- Dropped old `FPGPTarget`/`FPGPProgress` + auto-progress engine + radar dashboard.
- E2E verified via `test-fpgp-v2.ps1`.

---

## Phase 3 — UI Redesign (6 stages, `UI_REDESIGN_PLAN.md`)

Shifted from generic SaaS look to a VNRVJIET institutional portal.

- **Stage 1** — Design tokens: navy primary + saffron/gold accent, EB Garamond serif headings + Lato body, tight radii, brand shadows (Tailwind v4 `@theme` in `index.css`).
- **Stage 2** — Shared component kit: `BrandHeader`, `Footer`, `PageHeader`, `Card`, `StatTile`, `StatusBadge`.
- **Stage 3** — Shell rewrite: `Layout` with navy brand header + sidebar + footer; split-pane `LoginPage` with institute hero.
- **Stage 4** — Dashboards (faculty + admin) + global `blue-*` → `primary-*`, `rounded-xl` → `rounded-md` swap across 11 files.
- **Stage 5** — Every page wrapped in PageHeader + Card; navy zebra tables; toast restyled navy; gold-underline section headers; `StatusBadge` everywhere; `gray-*` → token swap.
- **Stage 6** — QA: 0 stray blue/gray/rounded-xl, build clean.

### Fixes during redesign
- Double-header bug — `ProfilePage` wrapped itself in `<Layout>` while `ProtectedRoute` already did → removed inner Layout.
- Login college name too dark on navy → inline bright gold `#f5d680`.
- Vite/cache confusion on token changes → hard refresh / restart guidance.

---

## Phase 4 — Missing Pages (`MISSING_PAGES_PLAN.md`)

Sidebar links existed without routes/pages. Built 5:
1. **Dept FPGP** (`/fpgp/department`) — HoD view of department plans.
2. **Admin Appraisals** (`/admin/appraisals`) — all submissions, filters, assign/unlock.
3. **Admin Departments** (`/admin/departments`) — CRUD with inline edit + HoD lookup.
4. **Admin Reports** (`/admin/reports`) — institute stats + dept breakdown + Excel export.
5. **Dept Reports** (`/reports/department`) — HoD reviewed-appraisal stats + Excel export.

All reused existing backend endpoints; no backend work needed.

---

## Phase 5 — Email Notifications (`EMAIL_NOTIFICATIONS_PLAN.md`)

- **Schema**: `EmailNotification` (queue + audit), `EmailStatus` enum, `emailOptIn` on User.
- **Service**: `emailService` (enqueue + send via nodemailer/Gmail SMTP), `emailTemplates` (HTML templates, VNRVJIET branding), `emailWorker` (cron polls PENDING every 30 s, 3 retries).
- **Cron**: daily 09:00 draft reminders to faculty + pending-review digest to reviewers; per-day dedupe keys.
- **Triggers wired**: submit → `submission_received`; approve/reject → `submission_approved`/`submission_rejected`; admin unlock → `submission_unlocked`; HoD FPGP sign → `fpgp_signed`.
- **Admin UI**: `/admin/emails` — list, filter by status, retry failed, manual trigger.
- `EMAIL_DISABLED=true` short-circuits sends in dev (logs to console, marks SENT).

---

## Phase 6 — Remaining Tasks Backlog (`REMAINING_TASKS.md`, 18 items)

### High-leverage features
1. **CSV bulk user import** — multipart-free (CSV text), dry-run preview validates every row (email format, dup codes, dept exists, role enum), then commit. Reusable `CsvImportModal`.
2. **Role assignment UI** — `RoleAssignModal`: assign/revoke FACULTY/HOD/REVIEWER/ADMIN with department scoping.
3. **Password change with email OTP** — `PasswordOtp` model; request OTP → verify → update. 10-min expiry, 5 attempts, bcrypt-hashed OTP, audit-logged.
4. **PDF export** — `pdfService` (puppeteer) renders appraisal + FPGP with institute letterhead, score tables, signatures. Endpoints `/appraisals/:id/pdf`, `/fpgp/:id/pdf`. Faculty restricted to own; reviewer scores hidden until APPROVED/REJECTED.
5. **Audit log viewer** — `/admin/audit`: filter by action/entity/date, paginated, expandable JSON metadata.

### Medium
6. **Reviewer assignment UI** — `AssignReviewerModal` on Admin Appraisals.
7. **Forgot password** — public OTP flow from login (`/forgot-password`), no user enumeration.
8. **Department soft-delete** — `isActive=false`, blocked if active users remain.

### Polish
9. **Pagination** — server-side `limit/offset` on appraisals/users/emails + `<Pagination>` component.
10. **Mobile responsive** — sidebar → hamburger drawer < `lg`; responsive BrandHeader; table scroll.
11. **Loading skeletons** — `<Skeleton>` + presets, applied to dashboards/tables.
12. **Print stylesheets** — `@media print` strips chrome, institute header on appraisal/FPGP views.

### Backend hardening
13. **HoD reassignment audit trail** — `ROLE_REVOKED` logged with dept metadata.
14. **Rate limiting** — `express-rate-limit`: login/reset 10/15 min, OTP 3/min.
15. **CORS tighten + Helmet** — multi-origin allowlist, security headers, `trust proxy`.

### Testing & CI
16. **Unit tests** — Vitest: scoring engine (Cat 1–5 math + caps), FPGP template integrity, email renderer. 40 tests.
17. **Integration tests** — Supertest: auth, guards, full submit→review→approve + visibility. Self-skips without DB. 7 tests (47 total green).
18. **CI** — GitHub Actions: backend (postgres service → push → seed → build → test) + frontend (lint → build).

App refactored so `app.ts` skips `listen`/workers under `NODE_ENV=test` (supertest imports app directly).

---

## Phase 7 — Documentation

- `README.md` — setup, scripts, seeded accounts, email config, testing, security, production checklist.
- `DESCRIPTION.md` — roles, scoring model, visibility rules, lifecycles, architecture, data model.
- `TUTORIAL.md` — role-by-role walkthroughs + cheat-sheet.

---

## Phase 8 — Proof File Upload (`FILE_UPLOAD_PLAN.md`)

Curated proof-file attachments on high-value fields.

- **Stage 1** — `multer` upload middleware (PDF/PNG/JPEG/WEBP, 5 MB, uuid filenames → `./uploads/appraisals/`), `POST/DELETE /uploads/proof`, clean 400 on type/size errors.
- **Stage 2** — `proofFile` columns added to Cat2 journals/conferences/patents/projects, Cat3 training, Cat5 awards (6 new); Cat1 e-Content/ICT `evidenceFile` rewired from URL-text to real upload. Schema pushed. `cleanRow` nulls empty proofFile.
- **Stage 3** — `<FileUpload>` component (empty/uploading-%/uploaded/readonly states) + `uploadApi`.
- **Stage 4** — wired into 8 form rows via RHF `Controller`; "Proof Documents" card on ReviewAppraisalPage aggregating all attachments; PDF gains a Proof column with linked filename.

---

## Phase 9 — Observability (`OBSERVABILITY.md`)

- **Prometheus** — `GET /metrics`: default Node metrics + `http_request_duration_seconds` (histogram), `http_requests_total` (counter), `http_requests_in_flight` (gauge). Low-cardinality route labels (ids collapsed to `:id`).
- **Health probes** — `GET /health` (liveness, no DB), `GET /health/ready` (readiness, `SELECT 1`, 503 if down).
- **Loki** — `pino` structured JSON → stdout, `x-request-id` correlation, auth/cookie redacted, level via `LOG_LEVEL`. Promtail/file/`pino-loki` delivery documented per runtime.
- **Grafana** — consumes both; sample docker-compose + `prometheus.yml` + `promtail.yml` provided.
- Verified live: `/health` 200, `/health/ready` db up, `/metrics` emitting, HTTP histogram populating.

Endpoints mounted at root (before `/api`), no auth — intended for internal scrape network.

---

## Phase 10 — Full E2E Regression Test (2026-07-05)

End-to-end verification across all roles (read + mutating) against the live stack (backend `:5000`, frontend `:5180`, Postgres). **37/37 assertions passed, zero app bugs.** Driven via API (Node drivers) for form-heavy mutations + `preview_*` UI drive for screenshots/console/network.

- **Faculty (FAC13)** — create appraisal → fill Cat 1–5 (valid `indexed` = WOS/SCOPUS/ESCI/ICI; SCI correctly absent from enum) → proof upload (201, attached to journal) → submit. Self-score visible (Total 80.0/500); reviewer scores + grandTotal hidden pre-review (`review=null`); PDF export `%PDF` 200.
- **HoD (HOD001, CSE)** — FAC13 in review queue; proof docs visible + streamable; scored Cat 6 + comments → APPROVED; HoD sees full scores + **grandTotal=123**.
- **Faculty re-check** — post-decision comments released; scores **still stripped** (both `/appraisals/:id` and `/:id/review`, via `serializeSubmissionForFaculty`).
- **FPGP** — FAC13 sign → ACTIVE (no HoD-sign needed in current design); admin `/fpgp/evaluate` → FAC13 **ACCEPTED** (2.1:2/2, 2.2:1/1, 3.2:2/2 all met), FAC15 **NEEDS_REVIEW** (2.1:1/3 missed); `fpgp_evaluated` email enqueued (FAILED — SMTP creds invalid, won't send, expected).
- **Reviewer (FAC11)** — pending queue scoped to reviewer dept (ECE) only, excludes CSE; cross-dept GET appraisal + POST review → 403.
- **Admin** — assign-reviewer (→UNDER_REVIEW) + unlock (→DRAFT).
- **Guards** — faculty→`/admin/users` 403; no-token→`/appraisals` 401; faculty cannot read reviewer scores.
- **Proof-file access** (`uploadController.canAccess` = owner / admin / HoD-or-Reviewer same-dept) — verified: owner 200, same-dept **REVIEWER** (non-HoD) 200, same-dept HoD 200, cross-dept faculty 403. Files served only via authenticated ownership-checked `GET /api/uploads/file/:filename`.
- **UI** — login FAC13/HOD001, dashboard, appraisal detail (self-score + comments card, no numeric reviewer scores rendered for any role — grandTotal lives in review API + PDF). No console errors, no failed network requests.

Notes: `scripts/live-workflow.mjs` includes a `hod-sign` step that is now optional (design auto-approves via target eval); route still exists (→REVIEWED). Seed reality: **FAC11 = CSE faculty with REVIEWER role scoped to ECE** (not ECE faculty). All test data reverted (appraisals + FPGP cascade, uploaded proof row + disk file, own email rows targeted by dedupeKey); pre-existing rows preserved; baseline verified (appraisals 3, fpgp 2, emails 37, uploads 1). AuditLog left intact (immutable trail).

---

## Database Maintenance

The dev database was cleared to **ADMIN001 only** multiple times on request (deletes all non-admin users + their submissions, FPGP plans, reviews, emails, OTPs, audit logs, roles in one transaction; departments + academic years retained). `npm run seed` repopulates sample accounts.

---

## Cross-Cutting Fixes

- **assignRole 500 (P2002)** — Prisma 6 nullable composite-unique broke `upsert` → switched to findFirst + create/update; added user/dept existence + HOD/REVIEWER-needs-dept validation.
- **Department column blank for HoD** — User.departmentId null for role-scoped HoDs → display falls back to first UserRole department.
- **Create-user 500 on duplicate code** — Prisma P2002 uncaught → `errorHandler` now maps P2002→400, P2025→404, P2003→400.
- **Create-user form** — added Department dropdown with "+ Create new department…" redirect.

---

## State as of Phase 10 (2026-07-05)

_A snapshot of where things stood when this log was last appended to. Kept as
written; every line below has since moved on._

- Backend + frontend both build clean.
- 47 tests passing (40 unit + 7 integration), CI configured.
- Observability live (Prometheus/health/Loki-ready).
- DB: ADMIN001 / admin123 only.
- **Before deploy**: set real Gmail SMTP creds + `EMAIL_DISABLED=false`, rotate JWT secrets + seeded passwords, restart backend to load latest changes.

## Plan / Reference Files

As referenced during those phases. Several have since been deleted from the
repository (`APPRAISAL_FORM_IMPL_PLAN.md`, `FPGP_V2_IMPL_PLAN.md`,
`UI_REDESIGN_PLAN.md`, `MISSING_PAGES_PLAN.md`, `EMAIL_NOTIFICATIONS_PLAN.md`,
`REMAINING_TASKS.md`, `DESCRIPTION.md`); [README.md](README.md) carries the
current documentation index.

`FACULTY_APPRAISAL_SYSTEM_LLD.md` · `APPRAISAL_FORM_IMPL_PLAN.md` · `FPGP_V2_IMPL_PLAN.md` · `UI_REDESIGN_PLAN.md` · `MISSING_PAGES_PLAN.md` · `EMAIL_NOTIFICATIONS_PLAN.md` · `REMAINING_TASKS.md` · `FILE_UPLOAD_PLAN.md` · `OBSERVABILITY.md` · `README.md` · `DESCRIPTION.md` · `TUTORIAL.md`
