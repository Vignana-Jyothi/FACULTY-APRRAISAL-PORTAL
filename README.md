# Faculty Appraisal System

A full-stack web application for managing faculty self-appraisals, departmental
and institute-level review, criteria tracking, and reporting for VNRVJIET.

## Overview

Faculty record the year's achievements across Categories 1–5 in a single draft
that stays open for the whole academic year; a server-side scoring engine
computes the self-score out of 500. During the year the department (HoD or
incharge) verifies the proof files attached to that draft and the HoD may note a
provisional draft review. The draft can be submitted only once the year's Q4
review window has ended — after which the HoD files the real review (Categories
1–5 overrides plus Category 6 core values out of 50), and dean-assigned
scrutinizers from other departments sign it off. Configuration (academic years,
review windows, cadre targets and tiers, departments) belongs to the dean; the
admin account is maintenance only. Every mutation is written to an audit log.

## Roles

Seven roles (`backend/src/utils/roles.ts` is the single source of the role
sets). A user can hold several at once.

| Role | What it is |
|------|------------|
| `FACULTY` | Files their own appraisal; sees their own score out of 500. |
| `REVIEWER` | The department "incharge" — verifies proofs and uploads for their own department. |
| `HOD` | Head of one department: reviews its appraisals, records Cat 6, reads its reports and tracking. |
| `DEAN` | Configuration (years, review windows, cadre targets/tiers, departments), tier allocation, assigns scrutinizers, institute-wide reads out of 500. |
| `PRINCIPAL` | Sees everything institute-wide, Category 6 and the /550 grand total included. |
| `SCRUTINIZER` | Cross-department final-review pool; reaches a submission only through a dean-made `FinalReview` assignment. |
| `SPECIAL_SCRUTINIZER` | Scrutinizer powers plus tier allocation. |

Rules worth knowing:

- **Departments are isolated.** `HOD` and `REVIEWER` are held per department and
  only for that department; `assignRole` rejects a `departmentId` on the
  institute-wide roles. Cross-department authority belongs to the principal and
  the dean, and to scrutinizers per assignment.
- **Category 6 and the /550 are withheld from the faculty who owns the
  appraisal** — from the API, the PDF, the emails and the UI. The one gate is
  `utils/reviewVisibility.canSeeReviewerAssessment`: the principal anywhere, and
  the faculty's own department HoD/incharge. The dean, the scrutinizers, the
  admin and the owner see the /500 only. The check keys on **ownership**, not
  role, so a HoD reading their own appraisal is restricted too.
- **The admin holds no appraisal content** — accounts, role assignment, the
  email queue and the audit log, nothing else.

## Appraisal lifecycle

```
DRAFT ──(proofs verified + draft review during the year)──┐
  │                                                       │
  └─ submit (opens the day after the Q4 window ends) ──► SUBMITTED / UNDER_REVIEW
                                                          │
                          HoD review (blocked while any proof is unverified)
                                                          │
                          approve ──► FINAL_REVIEW ──► APPROVED
                                       (dean-assigned scrutinizers;
                                        one approval finalises)
```

Other statuses: `HOLD` (a proof was rejected on a *submitted* appraisal — the
faculty is red-listed until it is corrected, or until the 14-day deadline voids
the marks), `REJECTED`, `WITHDRAWN`. Rejecting a proof on a **draft** only marks
the proof and emails the faculty: no hold, no red list.

## Features

- **Role-based access** — seven roles, department-scoped where it matters, with
  one shared source of truth for the role sets on both the server and the SPA.
- **One draft per faculty per academic year** — carried across Q1–Q4, auto-saving,
  with a server-side guard that refuses a save which would wipe a populated draft.
- **Scoring engine** — deterministic Category 1–5 scoring out of 500, plus the
  reviewer's Category 6 out of 50 for a /550 grand total. Every division and
  band chain is guarded so an unfilled row earns nothing.
- **Proof file uploads and verification** — PDF/PNG/JPEG/WEBP attachments served
  only through an authenticated, ownership-checked route (no static serving).
  The department verifies them on the draft and through review; uncorrected
  rejections are voided after the deadline so the review can proceed.
- **Criteria tracking, cadre and tier** — per-faculty standing against
  dean-configured cadre targets; the dean (or a special scrutinizer) sets the
  T1/T2/T3 tier and eligibility by hand.
- **Quarterly feedback** — a snapshot on each review window's end date, with the
  faculty's quarterly feedback email **gated**: it goes out only for a window the
  dean armed after a preview. An unarmed window snapshots and holds the mail
  until released.
- **Annual HoD feedback** — auto-drafted, editable, issued to the faculty, with
  a PDF export.
- **Oversight dashboard** — institute-wide status board for the dean and the
  principal (the principal's carries the /550 average, the dean's does not).
- **Forced password change** — accounts created by an admin or bulk-imported
  must choose their own password at first sign-in before reaching anything else.
- **Bulk faculty import** — upload a `.csv` or `.xlsx` roster; the header row is
  auto-detected, and every row imports as Faculty into an admin-selected
  department with a shared default password.
- **PDF export** — appraisal and feedback PDFs rendered from HTML via headless Chrome.
- **Email notifications** — queued in an outbox table and delivered by a
  background worker (idempotent, opt-in aware, reserved test domains never sent to).
- **Reports** — department, criteria-ranking and institute reports with Excel
  export; every score column names its scale (Self /500, Reviewed /500, Core
  values /50, Grand total /550) and the HoD's decision is shown separately from
  the appraisal's status.
- **Observability** — Prometheus metrics, liveness/readiness probes, structured JSON logs.
- **Audit log** — complete trail of all operations.

> The FPGP (Faculty Performance & Growth Planning) module was retired on
> 2026-09-13; its controllers, services and UI were deleted. Only the database
> models remain, so historical plans survive. It is not a feature of the system.

## Tech Stack

**Backend** — Node.js 24 + TypeScript, Express 4, PostgreSQL + Prisma 6, JWT
auth, Nodemailer (SMTP), Puppeteer (PDF), SheetJS (Excel export), node-cron,
Prometheus + pino, Vitest.

**Frontend** — React 19 + TypeScript, Vite, Tailwind CSS v4, Axios, Zustand
(auth store), react-hook-form + Zod, Recharts, SheetJS (client-side `.xlsx`
parsing, lazy-loaded).

**DevOps** — Docker Compose, Nginx, Prometheus / Loki / Alloy / Grafana.

## Prerequisites

- Node.js **24** (the Docker images and CI both use `node:24`)
- PostgreSQL v12+
- Docker & Docker Compose (production)
- npm

## Installation

### 1. Clone
```bash
git clone <repository-url>
cd faculty-appraisal-system
```

### 2. Backend
```bash
cd backend
npm install
cp .env.example .env         # then edit values (see ENV_SETUP.md)
npm run prisma:generate      # generate Prisma client
npm run prisma:push          # apply the schema (this project uses db push, not migrations)
npm run seed                 # seed sample accounts - FRESH databases only, see Database below
```

### 3. Frontend
```bash
cd ../frontend
npm install
```

## Running the Project

### Development

**Backend** (hot-reload via `tsx watch`):
```bash
cd backend
npm run dev          # http://localhost:5000
```

**Frontend**:
```bash
cd frontend
npm run dev          # http://localhost:5173  (proxies /api → :5000)
```

> The bundled preview config (`.claude/launch.json`) runs the frontend on port
> **5180** (strict). If the backend blocks the origin, add that URL to
> `FRONTEND_URL` in `backend/.env` and restart the backend.

### Production (Docker)
```bash
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml logs -f
```

### Testing
```bash
cd backend
npm test               # Vitest (unit + integration)

cd ../frontend
npm test               # type-check + Vitest
```

> The backend suites run against the configured database. Each suite owns its
> own fixtures (`src/__tests__/helpers/fixtures.ts`) and leaves the database as
> it found it; fixture users live on `@fixture.invalid`, which the email worker
> never sends to.

## Sample Accounts (after seeding)

| Code | Role | Password |
|------|------|----------|
| `ADMIN001` | Admin | `admin123` (override with `SEED_ADMIN_PW`) |
| `HOD001` / `HOD002` / `HOD003` | HoD (CSE / ECE / EEE) | `hod123` (override with `SEED_HOD_PW`) |
| `FAC11`–`FAC15`, `FAC21`–`FAC25`, `FAC31`–`FAC35` | Faculty (CSE / ECE / EEE); `FAC11`, `FAC12` also Reviewer for CSE | `faculty123` (override with `SEED_FACULTY_PW`) |

Seeded academic year: **2025-26**, submission window open.

The seed creates no principal, dean or scrutinizer — grant those roles from
Admin → Users → Roles once you are logged in as `ADMIN001`.

## Environment Variables

The authoritative list, with each setting's format, source and failure mode, is
[ENV_SETUP.md](ENV_SETUP.md). `backend/.env.example` is the template for local
development; the `.env.example` at the repo root is the one
`docker-compose.prod.yml` reads. The minimum for local development:

```
DATABASE_URL=postgresql://user:password@localhost:5432/faculty_appraisal
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:5173,http://localhost:5180   # comma-separated allowed CORS origins

# Auth
JWT_SECRET=change-me
JWT_EXPIRES_IN=8h
REFRESH_TOKEN_SECRET=change-me-too
REFRESH_TOKEN_EXPIRES_IN=7d

# Email (SMTP). Set EMAIL_DISABLED=true to log instead of send.
EMAIL_DISABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Faculty Appraisal <no-reply@vnrvjiet.in>"

# Optional
LOG_LEVEL=info
TZ=Asia/Kolkata               # the 09:00 cron jobs run on the Node clock
QUARTERLY_AUTOSEND=true       # false stops the daily review-window job entirely
DEFAULT_IMPORT_PASSWORD=      # blank falls back to Welcome@123
PUPPETEER_EXECUTABLE_PATH=    # path to Chrome, if not using bundled Chromium
```

### Frontend
No env required for local dev — Vite proxies `/api` to `http://localhost:5000`
(see `vite.config.ts`).

## Bulk Faculty Import

Admin → **Users → Import CSV** accepts `.csv` or `.xlsx` (max 500 rows).

- Expected columns (order-independent, header names fuzzy-matched):
  `S.NO, EMP ID, Name of the Faculty, Designation, D.O.J, Mobile Number, E - Mail ID`.
- Required per row: **EMP ID, Name, E-Mail ID**. `D.O.J` accepts `DD-MM-YYYY` or `YYYY-MM-DD`.
- The real header row is auto-detected — leading title rows (e.g. `CSE-TEACHING`)
  and mid-sheet section banners (e.g. `CSE-NON TEACHING`) are skipped.
- A target **department** is chosen in the UI and applied to every row; all rows
  import as **Faculty** with the default password from `DEFAULT_IMPORT_PASSWORD`
  (`Welcome@123` when unset). Imported accounts are flagged `mustChangePassword`
  and cannot use the portal until they choose their own. Excel files use the
  first sheet.

## Project Structure

```
├── backend/                     # Express + Prisma API
│   ├── src/
│   │   ├── app.ts               # app wiring, CORS, security, workers
│   │   ├── controllers/         # request handlers
│   │   ├── services/            # scoring, tracking, cadre/tier, email, pdf, proofs
│   │   ├── middleware/          # auth, roleGuard, reviewerGuard, upload, rateLimit, metrics, logger
│   │   ├── routes/              # index.ts — the whole API surface
│   │   ├── prisma/              # schema.prisma + seed.ts
│   │   ├── cron/                # reminders, quarterly snapshot, proof deadline
│   │   ├── scripts/             # flag-default-passwords
│   │   ├── utils/               # roles, reviewVisibility, access, serializers, guards
│   │   └── __tests__/           # integration suites + fixtures
│   ├── scripts/                 # live E2E drivers (live-workflow, smoke-all, wipe-except-admin…)
│   └── package.json
├── frontend/                    # React + Vite SPA
│   └── src/
│       ├── pages/{auth,faculty,reviewer,admin,oversight}
│       ├── components/          # Layout, ProtectedRoute, shared UI
│       ├── api/                 # axios client + typed request functions
│       └── store/               # Zustand auth store
├── docs/architecture.html       # system map
├── docker-compose.prod.yml
├── monitoring/                  # Alloy + Grafana provisioning
├── prometheus.yml
└── *.md                         # documentation (see below)
```

## API Surface (by controller)

`authController` · `userController` · `departmentController` ·
`academicYearController` · `appraisalController` · `reviewController` ·
`draftReviewController` · `finalReviewController` · `verificationController` ·
`trackingController` · `cadreTargetController` · `cadreTierController` ·
`reviewWindowController` · `feedbackController` · `oversightController` ·
`reportController` · `emailController` · `auditController` ·
`uploadController` · `healthController`.

Routes are declared in `backend/src/routes/index.ts`, each guarded with a role
set imported from `backend/src/utils/roles.ts`.

## Database

This project applies schema changes with `prisma db push`, **not** the migration
workflow. The schema has drifted from the migration history, so `prisma migrate
dev` and `prisma migrate reset` will offer to reset the database — on a working
dev box that destroys the bulk-imported faculty accounts and every appraisal in
it. `npm run prisma:migrate` is deliberately wired to a guard that refuses to run.

```bash
cd backend
npm run prisma:push       # apply schema.prisma to the database
npm run prisma:generate   # regenerate the client (stop the dev server first - Windows locks the DLL)
npm run prisma:studio     # browse the data
```

`npm run seed` is for a **fresh, empty** database. It refuses to run over an
existing dataset that contains users it does not own; see
`backend/src/prisma/seed.ts`.

After restoring real data, run `npm run flag-default-passwords -- --confirm=<db>`
to flag every account still on the shared default password so it is forced to
change at next sign-in.

## Monitoring

```bash
curl http://localhost:5000/metrics        # Prometheus
curl http://localhost:5000/health         # liveness
curl http://localhost:5000/health/ready   # readiness (DB ping)
```

## Documentation

| File | What it covers |
|------|----------------|
| [docs/architecture.html](docs/architecture.html) | System architecture map — deployment, request path, modules, lifecycle, scoring, email, auth, data model. Open in a browser (download it, or view it through a raw-HTML previewer) |
| [TUTORIAL.md](TUTORIAL.md) | End-user guide, per role |
| [HANDOFF.md](HANDOFF.md) | Developer handoff — environment, conventions, hazards |
| [FACULTY_APPRAISAL_SYSTEM_LLD.md](FACULTY_APPRAISAL_SYSTEM_LLD.md) | The original (June 2026) low-level design. Historical: superseded on roles, workflow and FPGP — see the banner at its top |
| [PROJECT_HISTORY.md](PROJECT_HISTORY.md) | Chronological log of what was built and decided, through Phase 10 (July 2026) |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Docker Compose deployment instructions |
| [ENV_SETUP.md](ENV_SETUP.md) | Filling `.env` for the deployment team — every setting's format, source and checks |
| [SECRETS.md](SECRETS.md) | Rules around secret values (no values live in the repo) |
| [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) | Pre-launch checklist |
| [IT_HANDOFF.md](IT_HANDOFF.md) | Operations / IT handoff notes |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Metrics, health probes, logging setup |
| [FILE_UPLOAD_PLAN.md](FILE_UPLOAD_PLAN.md) | Proof-file upload design |
| [CAT_ALIGNMENT_PLAN.md](CAT_ALIGNMENT_PLAN.md) | Appraisal category alignment plan |
| [VERIFY_CHECKLIST.md](VERIFY_CHECKLIST.md) | Historical verification record; no longer appended to (retired 2026-08-28) |
| [sample_appraisal.md](sample_appraisal.md) | Sample filled form |
| [FPGP_AUTOACCEPT_PLAN.md](FPGP_AUTOACCEPT_PLAN.md) · [sample_fpgp.md](sample_fpgp.md) | Historical — the retired FPGP module |
| [frontend/README.md](frontend/README.md) | Frontend-specific notes |

## License

Proprietary and confidential.
