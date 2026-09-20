# Session Handoff — VNRVJIET Faculty Appraisal System

_Last updated: 2026-09-20, against `main` at `0f82705`. Paste this into a new
session to resume context._

## Environment

- **Repo:** `C:/dev/p1` — use this absolute path. (The agent's session cwd may
  point at a stale OneDrive path; ignore it. A relative path silently resolves
  to an empty directory.)
- **Git:** branch `main`, remote `origin` =
  `github.com/dheerajpatel56/FACULTY-APRRAISAL-PORTAL`.
- **Backend:** `cd backend && npm run dev` → `http://localhost:5000` (runs
  `tsx watch`, hot-reloads on `src/` save; dependency changes need a manual
  restart). Health: `GET /health`, `GET /health/ready`.
- **Frontend:** `cd frontend && npm run dev` → `http://localhost:5173` (proxies
  `/api` → :5000). The preview launch config `appraisal-frontend` in
  `.claude/launch.json` runs it on `:5180` (strictPort); that origin is already
  in `FRONTEND_URL`.
- **DB:** PostgreSQL, database `faculty_appraisal`. Credentials live in
  `backend/.env` (`DATABASE_URL`) — not in this file and not in Git. The Prisma
  CLI does **not** pick `DATABASE_URL` up on its own here; export it from
  `backend/.env` first, and grep out that single line rather than dot-sourcing
  the file (one value contains `<`, which breaks a bash source).
- **Email:** `EMAIL_DISABLED=false` in `backend/.env` — **SMTP is live and mail
  goes to real `@vnrvjiet.in` addresses.** See "Hazards" below.
- **Stack:** Backend = Node 24 + TS, Express 4, Prisma 6, Postgres, JWT,
  Nodemailer, Puppeteer (PDF), SheetJS (Excel), node-cron, pino, Vitest.
  Frontend = React 19 + TS, Vite, Tailwind v4, Axios, Zustand, react-hook-form +
  Zod, Recharts, SheetJS.

## Where the rules live

Four files carry policy that is easy to re-derive wrongly. Import from them;
never restate the rule inline.

| File | Owns |
|---|---|
| `backend/src/utils/roles.ts` | Every "which roles may do this" set. Routes and helpers import these. |
| `backend/src/utils/reviewVisibility.ts` | The single gate for Category 6 and the /550 grand total. |
| `backend/src/services/submitGate.ts` | When a year's draft may be submitted. |
| `backend/src/services/scoringEngine.ts` | The scoring rules — see the banner at its top: a scoring change moves four files together. |

`frontend/src/App.tsx` mirrors the role sets for routing, and
`frontend/src/components/Layout.tsx` builds the menu additively per role.

## The model, in short

- **Seven roles.** `ADMIN` is maintenance only (accounts, role assignment, email
  queue, audit) and holds no appraisal content. `PRINCIPAL` sees everything
  institute-wide including Cat 6 and the /550. `DEAN` owns configuration and
  tier allocation and assigns scrutinizers. `SCRUTINIZER` /
  `SPECIAL_SCRUTINIZER` are the cross-department final-review pool (the special
  ones also allocate tiers). `HOD`, `REVIEWER` (department incharge) and
  `FACULTY` are unchanged.
- **Departments are isolated.** `HOD`/`REVIEWER` carry a `departmentId` and only
  for their own department; `assignRole` rejects anything else and rejects a
  `departmentId` on the institute-wide roles. A scrutinizer reaches a submission
  only through a `FinalReview` assignment, never through a standing role. Only
  **CSE** is active right now — EEE, ECE and ME are switched off by design.
- **One draft per faculty per academic year**, carried across Q1–Q4. It may be
  submitted only from the day after the enabled Q4 review window ends (the
  academic year's end date stands in when there is no enabled Q4 window) —
  `submitGate.submitOpensAt`.
- **During the year** the HoD/incharge verify proofs on the draft (a rejection
  there only marks the proof and emails the faculty — no HOLD, no red list), and
  the HoD may record a **draft review** (Cat 1–5 overrides + Cat 6 + comment)
  that pre-fills the real review. It is never shown to the owner.
- **After submission:** HoD review (approval is blocked while any proof is
  unverified, minus voided ones) → dean-assigned scrutinizers → one approval
  finalises.
- **Cat 6 and the /550 are withheld by ownership, not role.** The owner never
  sees them, whatever else they are — including a HoD reading their own row. The
  principal sees them everywhere; a faculty's own department HoD/incharge sees
  theirs. The dean, the scrutinizers and the admin get the /500.
  `GET /appraisals/:id` strips *all* reviewer scores for the owner;
  `GET /appraisals/:id/review` gives the owner the Cat 1–5 marks and the
  reviewed /500 once the decision is made, stripped of Cat 6 and the grand total.
- **Forced password change.** Bulk-imported and admin-created accounts are
  flagged `mustChangePassword`; `middleware/auth.ts` blocks every route but
  `/users/me` and the password change until it is done, and `ProtectedRoute`
  pins the SPA to `/profile`. After restoring real data, run
  `npm run flag-default-passwords -- --confirm=<dbname>` to backfill the flag
  for accounts imported before it existed.
- **Anything a scorer reads can be blank.** Guard every division and every band
  chain — an empty "Periods Planned" once divided by zero and paid full marks
  for 1.1.

## Hazards

- **Mail is live.** Two paths send in bulk and both are gated:
  - the dean's **Run quarterly snapshot** button on `/tracking` — a dry run that
    reports the recipient count and only sends on explicit confirmation;
  - the daily 09:00 review-window job (`cron/quarterlySnapshot.ts`) — it mails
    only for a window the dean **armed** after a preview. An unarmed window that
    comes due still takes its snapshot but **holds** the mail until the dean
    releases it (`341cbb5`). `QUARTERLY_AUTOSEND=false` stops the job entirely.

  Never arm or release a window against real faculty to "test" it. Test suites
  mail only `@fixture.invalid` users, which the worker never sends to.
- **Never run `prisma migrate dev` or `migrate reset`.** The schema has drifted
  from the migration history, so migrate offers to reset — which destroys the
  real bulk-imported faculty accounts. Use `npm run prisma:push`.
  `npm run prisma:migrate` is wired to a guard that refuses.
- **Never re-seed a populated database.** `npm run seed` blocks when it finds
  users it does not own; `--force` would put fake HOD001–003 accounts alongside
  the real heads of department.
- `backend/scripts/wipe-except-admin.ts` deletes every non-admin user and all
  appraisals. Dry-run by default; needs `--confirm=<dbname>`.
- Start the dev servers with the Browser pane's launch entries rather than Bash,
  and never kill node processes you did not start — the backend may be running
  in the user's own terminal.

## Testing

```bash
cd backend  && npm test    # Vitest, unit + integration
cd frontend && npm test    # tsc --noEmit + Vitest
```

The backend suites run against the **real configured database**. Every suite
owns its fixtures through `src/__tests__/helpers/fixtures.ts` and leaves the
database as it found it; no suite uses seed accounts. Fixture users live on
`@fixture.invalid` (the email worker never sends to reserved domains), and the
global cron/sweep functions take a scope so a test cannot void or mail real
faculty's rows.

Build/typecheck/test after each change and report pass/fail before moving on.
Test changes **live** — start the servers, drive the real API or the browser,
report actual before/after numbers, then clean up the test data and confirm the
database is as you found it. Do **not** append to `VERIFY_CHECKLIST.md`; that
practice was retired on 2026-08-28 and the file stays only as a record.

## Recent work on `main`

| Commit | What |
|---|---|
| `acc8a49` | Seven-role hierarchy — admin/principal/dean/scrutinizer split |
| `775251a` | Save-race guard: a save that would wipe a populated draft is refused (409) |
| `6141728` | Oversight dashboard for dean + principal, with a department picker |
| `b5dfdfe` | Forced password change when someone else chose the password |
| `341cbb5` | The dean arms each review window before any quarterly mail |
| `40e0d96` | Every exported score names its scale; HoD decision vs appraisal status |
| `b33413c`, `133395d` | One draft carries the year; proofs and a draft review on it; draft reminders at most weekly |
| `8e86059`, `0f82705` | Docs: system map, deployment and IT handoff follow the above |

## Gotchas when driving the app in a browser

- The login form uses react-hook-form; setting inputs by simple fill can race
  it. Reliable pattern: native value setter + dispatch an `input` event, then
  `form.requestSubmit()`.
- The frontend preview runs on **:5180** (`:5173` belongs to another project).
- Prefer `read_page` / DOM inspection over screenshots — the screenshot tool has
  timed out intermittently.
- Bash heredocs eat backslashes in regexes; write such scripts to a file instead.
- `.claude/launch.json` currently defines only the `appraisal-frontend` entry.

## Docs in the repo

Current: `README.md`, `TUTORIAL.md`, this file, `docs/architecture.html`,
`DEPLOYMENT.md`, `ENV_SETUP.md`, `SECRETS.md`, `GO_LIVE_CHECKLIST.md`,
`IT_HANDOFF.md`, `OBSERVABILITY.md`.

Historical, kept for the record and **not** descriptions of the system as it
stands: `FACULTY_APPRAISAL_SYSTEM_LLD.md` (the original June 2026 build spec),
`PROJECT_HISTORY.md` (through Phase 10, July 2026), `VERIFY_CHECKLIST.md`,
`CAT_ALIGNMENT_PLAN.md`, `FILE_UPLOAD_PLAN.md`, `FPGP_AUTOACCEPT_PLAN.md`,
`sample_appraisal.md`, `sample_fpgp.md`.

FPGP was retired on 2026-09-13: controllers, services and UI deleted, the
database models kept so historical plans survive. It is not a feature.
