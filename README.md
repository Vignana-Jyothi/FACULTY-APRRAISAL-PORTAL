# Faculty Appraisal System

A full-stack web application for managing faculty self-appraisals, reviewer/HoD evaluation, Faculty Performance & Growth Planning (FPGP), and institutional reporting for VNRVJIET.

## Overview

Faculty record their yearly achievements across Categories 1–5; a server-side scoring engine computes the self-score. HoDs/Reviewers add Category 6 marks and comments and approve or reject. An FPGP module lets faculty set growth targets that are automatically reconciled against their appraisal actuals. Admins manage users, departments, academic years, reviewer assignment, notifications, and reports. Every mutation is written to an audit log.

## Features

- **Role-based access** — Admin, HoD, Reviewer, Faculty (multiple roles per user, department-scoped).
- **Appraisal workflow** — draft → submit → review → approve/reject, with strict visibility rules (reviewer numeric scores are never exposed to faculty; comments release only after a decision).
- **Scoring engine** — deterministic Category 1–6 scoring (self max 500 + reviewer Category 6).
- **FPGP** — target-setting per the official template; quarterly (or on-demand) auto-reconciliation → `ACCEPTED` / `NEEDS_REVIEW`.
- **Proof file uploads** — PDF/PNG/JPEG/WEBP attachments served only through an authenticated, ownership-checked route (no static serving).
- **Bulk user import** — upload a `.csv` or `.xlsx` faculty roster. The header row is auto-detected (title banners and section rows are skipped); every row is imported as Faculty into an admin-selected department with a shared default password.
- **User admin** — create/edit/delete users, assign roles, plus multi-select bulk delete in the users table.
- **PDF export** — appraisal and FPGP PDFs rendered from HTML via headless Chrome.
- **Email notifications** — queued in an outbox table and delivered by a background worker (idempotent, opt-in aware).
- **Reports** — department and institute reports, with Excel export.
- **Observability** — Prometheus metrics, liveness/readiness probes, structured JSON logs.
- **Audit log** — complete trail of all operations.

## Tech Stack

**Backend** — Node.js + TypeScript, Express 4, PostgreSQL + Prisma 6, JWT auth, Nodemailer (SMTP), Puppeteer (PDF), SheetJS (Excel export), Prometheus + pino, Vitest.

**Frontend** — React 18 + TypeScript, Vite, Tailwind CSS v4, Axios, Zustand (auth store), react-hook-form + Zod, SheetJS (client-side `.xlsx` parsing, lazy-loaded).

**DevOps** — Docker Compose, Nginx, Prometheus/Grafana/Loki-ready.

## Prerequisites

- Node.js **v18+** (uses global `fetch`/`FormData`)
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
cp .env.example .env        # then edit values (see Environment Variables)
npm run prisma:generate     # generate Prisma client
npm run prisma:push         # apply the schema (this project uses db push, not migrations)
npm run seed                # seed sample accounts - FRESH databases only, see Database below
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

> The bundled preview config (`.claude/launch.json`) runs the frontend on port **5180** (strict). If the backend blocks the origin, add that URL to `FRONTEND_URL` in `backend/.env` and restart the backend.

### Production (Docker)
```bash
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml logs -f
```

### Testing
```bash
cd backend
npm test               # Vitest (unit + integration)
npm run test:coverage  # coverage report
```

## Sample Accounts (after seeding)

| Code | Role | Password |
|------|------|----------|
| `ADMIN001` | Admin | `admin123` |
| `HOD001` / `HOD002` | HoD (CSE / ECE) | `hod123` |
| `FAC13`, `FAC15` … | Faculty | `faculty123` |

Open academic year: **2026-27**. (See the seed script for the full list.)

## Environment Variables

### Backend (`backend/.env`)
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
PUPPETEER_EXECUTABLE_PATH=   # path to Chrome, if not using bundled Chromium
```

### Frontend
No env required for local dev — Vite proxies `/api` to `http://localhost:5000` (see `vite.config.ts`).

## Bulk Faculty Import

Admin → **Users → Import CSV** accepts `.csv` or `.xlsx`.

- Expected columns (order-independent, header names fuzzy-matched): `S.NO, EMP ID, Name of the Faculty, Designation, D.O.J, Mobile Number, E - Mail ID`.
- Required per row: **EMP ID, Name, E-Mail ID**. `D.O.J` accepts `DD-MM-YYYY` or `YYYY-MM-DD`.
- The real header row is auto-detected — leading title rows (e.g. `CSE-TEACHING`) and mid-sheet section banners (e.g. `CSE-NON TEACHING`) are skipped.
- A target **department** is chosen in the UI and applied to every row; all rows import as **Faculty** with the default password `Welcome@123` (users change it on first login). Excel files use the first sheet.

## Project Structure

```
├── backend/                     # Express + Prisma API
│   ├── src/
│   │   ├── app.ts               # app wiring, CORS, security, workers
│   │   ├── controllers/         # request handlers
│   │   ├── services/            # scoring, email, pdf, fpgp reconciler
│   │   ├── middleware/          # auth, roleGuard, upload, rateLimit, metrics
│   │   ├── routes/              # API routes
│   │   ├── prisma/              # schema.prisma + migrations
│   │   ├── cron/                # reminders, FPGP evaluation
│   │   ├── scripts/             # live E2E drivers (live-workflow, smoke-all)
│   │   └── utils/               # access control, serializers
│   └── package.json
├── frontend/                    # React + Vite SPA
│   └── src/{pages,components,api,store}
├── docker-compose.prod.yml
├── prometheus.yml
└── *.md                         # documentation (see below)
```

## API Surface (by controller)

`authController` · `userController` · `departmentController` · `academicYearController` · `appraisalController` · `reviewController` · `fpgpController` · `reportController` · `emailController` · `auditController` · `uploadController`. Routes are declared in `backend/src/routes/index.ts`.

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
existing dataset that contains imported users; see `backend/src/prisma/seed.ts`.

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
| [FACULTY_APPRAISAL_SYSTEM_LLD.md](FACULTY_APPRAISAL_SYSTEM_LLD.md) | Low-level design — data model, scoring, workflows |
| [PROJECT_HISTORY.md](PROJECT_HISTORY.md) | Chronological log of everything built, fixed, and decided |
| [TUTORIAL.md](TUTORIAL.md) | End-user guide (faculty / HoD / admin) |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Docker Compose deployment instructions |
| [ENV_SETUP.md](ENV_SETUP.md) | Filling `.env` for the deployment team — every setting's format, source and checks |
| [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) | Pre-launch checklist |
| [IT_HANDOFF.md](IT_HANDOFF.md) | Operations / IT handoff notes |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Metrics, health probes, logging setup |
| [FILE_UPLOAD_PLAN.md](FILE_UPLOAD_PLAN.md) | Proof-file upload design |
| [FPGP_AUTOACCEPT_PLAN.md](FPGP_AUTOACCEPT_PLAN.md) | FPGP auto-accept / reconciliation design |
| [CAT_ALIGNMENT_PLAN.md](CAT_ALIGNMENT_PLAN.md) | Appraisal category alignment plan |
| [sample_appraisal.md](sample_appraisal.md) · [sample_fpgp.md](sample_fpgp.md) | Sample filled forms |
| [frontend/README.md](frontend/README.md) | Frontend-specific notes |

## License

Proprietary and confidential.
