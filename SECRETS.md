# Secrets & deployment configuration

**No secret values belong in this file, or anywhere else in this repository.**
It lists *which* settings exist, where each value comes from, and exactly what
reads it. The values are set on the host at deploy time, in the server's `.env`
(git-ignored, `chmod 600`), which `docker-compose.prod.yml` reads. Anything
committed to Git stays in history even after it is deleted, so a leaked value
means rotation, not a revert.

Names are the ones the **code actually reads** (`process.env.*`); the file and
line in "Read by" is where. `.env.example` has the same keys, annotated.

**Required** means compose refuses to start while the value is empty
(`required variable X is missing a value`).

---

## 1. Get these from someone else

| Variable | Required | Read by | What it controls | Where to get it |
|---|---|---|---|---|
| `FRONTEND_URL` | **yes** | `app.ts:44` (CORS allowlist) · `services/emailTemplates.ts:5` (links + logo in every email) · `services/pdfService.ts:129` (proof links in PDFs) | The only address browsers may call the API from, and the base of every link sent out | Decided: `https://appraisal.vjstartup.com`. Needs the DNS record and TLS certificate from whoever runs `vjstartup.com` |
| `SMTP_HOST` | no — `smtp.gmail.com` | `services/emailService.ts:13` | Outgoing mail server | Mailbox owner / college IT (institute relay preferred for volume) |
| `SMTP_PORT` | no — `587` | `services/emailService.ts:14` | Mail server port | Same. 587 pairs with `SMTP_SECURE=false`, 465 with `true` |
| `SMTP_SECURE` | no — `false` | `services/emailService.ts:15` | Implicit TLS (465) vs STARTTLS (587) | Same |
| `SMTP_USER` | no* | `services/emailService.ts:17` | Login for the sending mailbox | The sending mailbox address |
| `SMTP_PASS` | no* | `services/emailService.ts:18` | Its password | Gmail: a 16-character **app password** (Google account → Security → App passwords), never the account password |
| `SMTP_FROM` | no* | `services/emailService.ts:154` | The `From:` on every mail | e.g. `"VNRVJIET Faculty Portal <sender@…>"` — must be an address the mailbox may send as. Quote it in `.env` |
| `HTTP_BIND` | no — `80` | compose → frontend `ports:` | Where the site listens on the host | The network team: `80` if the TLS proxy is on another machine, `127.0.0.1:8080` if it is on this host |

\* Not enforced by compose, but with `EMAIL_DISABLED=false` and these empty,
every mail fails (visible on the admin **Emails** page).

## 2. Generate these yourself

Generate each one fresh on the server. **None may be copied from development.**

| Variable | Required | Read by | What it controls | How |
|---|---|---|---|---|
| `DB_PASSWORD` | **yes** | compose → postgres `POSTGRES_PASSWORD`, and inside `DATABASE_URL` → Prisma (`schema.prisma`) | The database password | `openssl rand -hex 24`. **Hex only:** it sits inside a URL, where `@ : / # + =` break the connection string |
| `JWT_SECRET` | **yes** | `utils/jwt.ts:3` | Signs and verifies access tokens (HS256) | `openssl rand -hex 32`. The backend refuses to start if it is under 32 characters (`jwt.ts:10`). Rotating it logs everyone out |
| `REFRESH_TOKEN_SECRET` | **yes** | `utils/jwt.ts:5` | Signs the refresh-token cookie | `openssl rand -hex 32`, different from `JWT_SECRET` — the backend refuses to start if they match (`jwt.ts:15`) |
| `DEFAULT_IMPORT_PASSWORD` | **yes** | `controllers/userController.ts:436` | Initial password of every account created by CSV bulk import | A strong shared password; tell imported faculty to change it at first login (the portal does not force it yet) |
| `GRAFANA_PASSWORD` | **yes** — even without monitoring | compose → grafana `GF_SECURITY_ADMIN_PASSWORD` | Grafana's `admin` login | `openssl rand -hex 24` |
| `METRICS_TOKEN` | no | `app.ts:27` | If set, `/metrics` requires `Authorization: Bearer <token>` | `openssl rand -hex 32`. Optional — `/metrics` is internal anyway |
| `SEED_ADMIN_PW` / `SEED_HOD_PW` / `SEED_FACULTY_PW` | fresh install only | `prisma/seed.ts:24-26` | Passwords of the accounts `seed:prod` creates | Passed with `-e` on the one seed run (DEPLOYMENT.md §6A) — **not** put in `.env`. Without them the seed uses the public defaults `admin123` / `hod123` / `faculty123` |

## 3. Decide these (defaults are sensible)

| Variable | Default | Read by | What it controls |
|---|---|---|---|
| `EMAIL_DISABLED` | none — **required** | `services/emailService.ts:6` | `true`: queued mail is marked sent without contacting SMTP. `false`: real mail to real faculty. `true` on staging |
| `QUARTERLY_AUTOSEND` | `true` | `cron/quarterlySnapshot.ts:196` | `false` stops the daily 09:00 job that mails every opted-in faculty member when a review window ends |
| `TZ` | `Asia/Kolkata` | Node's clock → the 09:00 jobs in `cron/reminders.ts` and `cron/quarterlySnapshot.ts`, and dates printed in emails and PDFs | Without it the container runs on UTC and "09:00" fires at 14:30 IST |
| `MAX_UPLOAD_MB` | `5` | `middleware/upload.ts:39` | Per-file upload limit; pasted links are exempt. An unparseable value warns and falls back to 5. Keep nginx's `client_max_body_size` (10m) above it |
| `JWT_EXPIRES_IN` | `8h` | `utils/jwt.ts:4` | Access-token lifetime |
| `REFRESH_TOKEN_EXPIRES_IN` | `7d` | `utils/jwt.ts:6` | How long a login lasts without re-entering the password |
| `LOG_LEVEL` | `info` | `middleware/logger.ts:10` | `trace` / `debug` / `info` / `warn` / `error` |
| `PROMETHEUS_RETENTION` | `30d` | compose → prometheus `--storage.tsdb.retention.time` | How long metrics are kept (monitoring profile only) |

## 4. Set by the stack — do not put these in `.env`

| Variable | Set where | Read by | Value |
|---|---|---|---|
| `DATABASE_URL` | compose, built from `DB_PASSWORD` | Prisma | `postgresql://appraisal_user:…@postgres:5432/faculty_appraisal` |
| `NODE_ENV` | compose / Dockerfile | `app.ts:79`, `authController.ts:24` (secure cookies), `middleware/rateLimit.ts:28`, `middleware/logger.ts:5` | `production` |
| `PORT` | compose | `app.ts:80` | `5000` — the frontend's nginx expects it |
| `UPLOAD_DIR` | compose | `utils/uploadPaths.ts:16` | `/app/uploads`, bound to `./backend/uploads` on the host. Proof files live here, not in the database |
| `PUPPETEER_EXECUTABLE_PATH` | backend Dockerfile | `services/pdfService.ts:18` | `/usr/bin/chromium-browser` — PDF export fails without it |

**Not a variable:** the number of proxies in front of the backend is hard-coded
(`app.set('trust proxy', 1)`, `backend/src/app.ts:72`). Behind the campus proxy
and the frontend nginx it must be `2`; the deployment team edits that line
(DEPLOYMENT.md §7).

---

## Before the first production deploy

- [ ] Every value in §2 generated fresh — **none reused from development**.
- [ ] `.env` is `chmod 600` and not in Git.
- [ ] `FRONTEND_URL` is the real HTTPS address, first in the list.
- [ ] SMTP credentials tested: "Forgot password" for an inbox you control.
- [ ] `ADMIN001`'s password changed at first login. If the seed ran without
      `SEED_ADMIN_PW`, it is the public `admin123` until then.
- [ ] Imported faculty told to change `DEFAULT_IMPORT_PASSWORD` (or
      `Welcome@123`, for the 73 accounts imported before it existed).
- [x] Dev scripts take credentials from `ADMIN_PW` / `HOD_PW` / `FACULTY_PW` /
      `TEST_EMAIL`, with no fallback.
- [x] A blank `SEED_*_PW` or `DEFAULT_IMPORT_PASSWORD` falls back instead of
      becoming an empty password.

## ⚠️ Mail

`EMAIL_DISABLED=false` makes the application send real mail to real addresses.
Two paths send in bulk: the admin "Run quarterly snapshot" button (a dry run
until explicitly confirmed) and the daily 09:00 review-window job, which fires
on a window's end date **with nobody clicking anything** — `QUARTERLY_AUTOSEND=false`
stops that one. Point a staging deployment at a catch-all mailbox, or keep
`EMAIL_DISABLED=true` there.

## If a secret leaks

1. Rotate at the source (new app password, new JWT secret, new DB password).
2. Redeploy. Rotating `JWT_SECRET` or `REFRESH_TOKEN_SECRET` invalidates every
   session — expect all users to be logged out.
3. Do not rewrite Git history and assume that is sufficient; treat the value as
   compromised from the moment it was pushed.
