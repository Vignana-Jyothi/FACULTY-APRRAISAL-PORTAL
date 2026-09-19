# Deployment Guide — VNRVJIET Faculty Appraisal System

How to put the portal on a server and keep it running. The target is **one
Docker host running `docker compose`, behind the campus reverse proxy that
terminates TLS, on the subdomain `appraisal.vjstartup.com`**. A subdomain
needs no code changes — the public address is one setting, `FRONTEND_URL`.

Related documents:
- [IT_HANDOFF.md](IT_HANDOFF.md) — one-page brief for college IT
- [docs/architecture.html](docs/architecture.html) — system map: deployment, request path, modules, lifecycle, scoring, email, auth, data model (open in a browser)
- [ENV_SETUP.md](ENV_SETUP.md) — **filling `.env`**: every setting's format, example, source, what reads it, what breaks if it is wrong
- [SECRETS.md](SECRETS.md) — security rules for those values (rotation, leaks, mail)
- [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) — sign-off list
- [OBSERVABILITY.md](OBSERVABILITY.md) — metrics, logs, dashboards

Every variable name in this guide is the one the **code actually reads**
(`process.env.*`). If an example file disagrees, the code wins.

---

## 1. What runs

```
Browser ──HTTPS──▶ campus proxy (TLS) ──HTTP──▶ frontend (nginx :80)
                                                   ├─ /          → React app (static files)
                                                   ├─ /api/      → backend :5000
                                                   └─ /uploads/  → backend :5000
                                               backend (Node 24 + Express) ──▶ postgres :5432
```

| Service | Built from | Port in container | Public? |
|---|---|---|---|
| `frontend` | `./frontend` (Vite build served by nginx) | 80 | Yes — on `HTTP_BIND`, reached through the campus proxy |
| `backend` | `./backend` (Node 24, Prisma, system Chromium for PDFs) | 5000 | No host port |
| `postgres` | `postgres:15-alpine` | 5432 | No host port |
| `prometheus`, `loki`, `grafana` | `v3.5.5` / `3.7.7` / `13.2.1` | 9090 / 3100 / 3000 | `127.0.0.1` only, `--profile monitoring` |
| `alloy` (ships logs to Loki) | `grafana/alloy:v1.19.2` | 12345 | No host port, `--profile monitoring` |

The frontend needs no API URL: it calls the relative path `/api`, and its nginx
forwards `/api/` and `/uploads/` to the backend. The frontend takes no
environment variables at all (`VITE_API_URL` was never read).

The backend also runs the scheduled jobs itself (email sending, reminders,
review-window mail, proof deadlines) — see §9. **Run exactly one backend
container**; two would run every job twice.

---

## 2. Requirements

- Linux host with Docker Engine and the Compose plugin (`docker compose`).
- About 2 vCPU / 4 GB RAM. PDF export runs headless Chromium inside the backend.
- Disk for the database plus proof files (each upload is capped at 5 MB by default).
- A DNS name pointing at the host, and the campus proxy set up to terminate TLS.
- A sending mailbox with an app password (Gmail) or institute SMTP credentials,
  and outbound access to its port (587 or 465).
- Node.js is **not** needed on the host — the images build everything.
- One free host port for the frontend (`HTTP_BIND`, default 80). Postgres and
  the backend publish nothing, so a PostgreSQL already on the host does not clash.

---

## 3. Get the code and configure it

```bash
git clone https://github.com/dheerajpatel56/FACULTY-APRRAISAL-PORTAL.git faculty-appraisal
cd faculty-appraisal
cp .env.example .env
chmod 600 .env
```

(The repository name really is spelled `APRRAISAL`.)

Edit `.env`. Compose reads it and injects the backend's settings — you do not
write a `backend/.env` on the server.

| Key | Value | Notes |
|---|---|---|
**[ENV_SETUP.md](ENV_SETUP.md) walks through this step by step**, including a
command that generates the secrets and the format traps to avoid. The table
below is the summary.

Keys marked **required** are enforced by compose itself: `up` stops with
`required variable X is missing a value` instead of starting the app with a
blank secret.

| Key | Value | Notes |
|---|---|---|
| `DB_PASSWORD` | `openssl rand -hex 24` | **Required.** Compose builds `DATABASE_URL` from it, so it must be URL-safe — `@ : / #` break the URL. Hex is safe. |
| `JWT_SECRET` | `openssl rand -hex 32` | **Required.** At least 32 characters. Rotating it logs everyone out. |
| `REFRESH_TOKEN_SECRET` | `openssl rand -hex 32` | **Required.** Must differ from `JWT_SECRET`. |
| `JWT_EXPIRES_IN` / `REFRESH_TOKEN_EXPIRES_IN` | `8h` / `7d` | Defaults in compose. |
| `FRONTEND_URL` | `https://appraisal.vjstartup.com` | **Required.** CORS allowlist, comma-separated. The **first** origin is also the base of every link in emails and PDFs, so put the real public URL first. |
| `HTTP_BIND` | `80` or `127.0.0.1:8080` | Where the frontend listens on the host (§4). |
| `EMAIL_DISABLED` | `false` in production | **Required.** `false` sends real mail to real people — read §8 first. Use `true` on staging. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.gmail.com` / `587` / `false` (or `465` / `true`) | Port and `SECURE` must match: 587 → `false`, 465 → `true`. |
| `SMTP_USER` | the sending mailbox | |
| `SMTP_PASS` | Gmail 16-character **app password** | Not `SMTP_PASSWORD`, and not the account password. |
| `SMTP_FROM` | `"VNRVJIET Faculty Portal <sender@…>"` | Contains `<` `>` — keep it quoted. |
| `QUARTERLY_AUTOSEND` | `true` | `false` stops the daily review-window mail to all faculty (§8). |
| `DEFAULT_IMPORT_PASSWORD` | a strong shared password | **Required.** Given to faculty created by CSV import. |
| `MAX_UPLOAD_MB` | `5` | Per-file upload limit (links are exempt). |
| `TZ` | `Asia/Kolkata` | Default in compose; the scheduled jobs use it (§9). |
| `LOG_LEVEL` | `info` | |
| `METRICS_TOKEN` | optional | Bearer token for `/metrics`, which is internal anyway (§12). |
| `GRAFANA_PASSWORD` | `openssl rand -hex 24` | **Required** — compose checks it even when the monitoring profile is off. |
| `PROMETHEUS_RETENTION` | `30d` | Monitoring profile only. |

Generate every secret fresh. **Nothing from the development machine goes to
production** — not the JWT secrets, not the SMTP credentials.

Do **not** add `SEED_*_PW` to `.env` — they are passed only for the one seed run (§6).

---

## 4. Ports

Only the frontend is published, on `HTTP_BIND`:

| Campus proxy runs… | `HTTP_BIND` |
|---|---|
| on another machine | `80` (and firewall port 80 to that machine) |
| on this same host | `127.0.0.1:8080` (the proxy forwards to it) |

Postgres and the backend have **no host ports**: the frontend's nginx reaches
the backend over the compose network, and the backup script uses
`docker compose exec`. The monitoring UIs bind to `127.0.0.1` only (§12). Allow
only 80/443 through the host firewall.

---

## 5. Build and start

```bash
# The app (postgres, backend, frontend)
docker compose -f docker-compose.prod.yml up -d --build

# Optional: also start prometheus, loki, alloy and grafana
docker compose -f docker-compose.prod.yml --profile monitoring up -d

docker compose -f docker-compose.prod.yml logs -f backend
```

On every start the backend runs `prisma db push`, which creates the schema on an
empty database and applies additive changes later. It runs **without**
`--accept-data-loss`, so a change that would drop data stops the boot instead
(§11).

Check it:

```bash
docker compose -f docker-compose.prod.yml ps                                   # backend "healthy"
docker compose -f docker-compose.prod.yml exec backend curl -fsS http://localhost:5000/health/ready
curl -sI http://127.0.0.1/                    # 200 from nginx — use your HTTP_BIND address
```

---

## 6. Accounts and data

Pick one.

### A. Fresh install

```bash
docker compose -f docker-compose.prod.yml exec \
  -e SEED_ADMIN_PW='<strong admin password>' \
  -e SEED_HOD_PW='<random>' \
  -e SEED_FACULTY_PW='<random>' \
  backend npm run seed:prod
```

Use `seed:prod` (compiled JS). Plain `npm run seed` needs dev tools the image
does not have. Without the `-e` values the seed falls back to the passwords
committed in the repository (`admin123` / `hod123` / `faculty123`), which are
public. The seed refuses to run on a database that already holds users it did
not create.

The seed creates `ADMIN001`, sample departments and academic years, **plus
sample accounts** (`HOD001`–`HOD003`, `FAC11`–`FAC35` on `@college.edu`
addresses). On a real install, log in as `ADMIN001` and deactivate those sample
accounts (deleting a user is a deactivation — nothing is erased).

Then set the portal up. **Roles decide who can do each step** (seven since
2026-09-18): `ADMIN` is maintenance only - accounts, role assignment, email
queue, audit log - and cannot open appraisals, reports or proofs.

As **ADMIN**:
1. Create the principal (`PRINCIPAL`), the dean (`DEAN`) and the scrutinizer
   pool (`SCRUTINIZER`; the 2-3 who also allocate tiers get
   `SPECIAL_SCRUTINIZER`). These roles are institute-wide and take no
   department.
2. Bulk-import faculty from CSV. They receive `DEFAULT_IMPORT_PASSWORD` and the
   portal makes each of them change it at first sign-in.
3. Assign each department's HoD and incharges (the `REVIEWER` role). A role only
   works inside its own department.

As the **DEAN**:
4. Departments - only CSE is active today; EEE/ECE/ME are switched off by design.
5. Academic year - create it and open submissions.
6. Cadre targets, tier thresholds and the Q1-Q4 review windows. The appraisal is
   one draft for the whole year: faculty can submit it only from the day after
   the **Q4 window ends** (the academic year's end if no Q4 window is set).

### B. Move existing data from another machine

Take a backup on the source machine with `scripts/backup.sh` (§10; on a dev
machine set `DATABASE_URL` and `PG_BIN`), copy the whole `backups/<stamp>/`
folder to the server, then restore **before** the backend starts:

```bash
B=backups/<stamp>
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U appraisal_user -d faculty_appraisal --clean --if-exists --no-owner < $B/db.dump
mkdir -p backend/uploads && tar -xzf $B/uploads.tar.gz -C backend/uploads
docker compose -f docker-compose.prod.yml up -d --build backend frontend
```

Compare user and appraisal counts with the source afterwards. Accounts, password
hashes and proof files all come across.

### Either way

- Change the admin password on first login.
- Accounts created or imported from now on must change their password at first
  sign-in. Accounts **restored** from a backup predate that flag: mark every one
  still on the shared import password so it is forced too (dry run first, then
  confirm with the database name):
  ```bash
  docker compose -f docker-compose.prod.yml exec backend npm run flag-default-passwords:prod
  docker compose -f docker-compose.prod.yml exec backend npm run flag-default-passwords:prod -- --confirm=faculty_appraisal
  ```
- Assign the new roles (principal, dean, scrutinizers) to real people - a
  restored database only knows the old four roles, and its admin account no
  longer opens appraisal content.

---

## 7. Reverse proxy and TLS

Point the campus proxy at the frontend (`HTTP_BIND`, §4) and terminate TLS
there. An nginx example for the proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name appraisal.vjstartup.com;
    ssl_certificate     /etc/letsencrypt/live/appraisal.vjstartup.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/appraisal.vjstartup.com/privkey.pem;

    client_max_body_size 10m;   # proof uploads; the app caps files at MAX_UPLOAD_MB

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
server {
    listen 80;
    server_name appraisal.vjstartup.com;
    return 301 https://$host$request_uri;
}
```

Set `FRONTEND_URL=https://appraisal.vjstartup.com` to match, then
`docker compose -f docker-compose.prod.yml up -d backend` to apply it.

> **Set the proxy hop count before building.** The backend trusts exactly one
> proxy hop — `app.set('trust proxy', 1)` in `backend/src/app.ts`, hard-coded,
> not an environment variable. With the campus proxy *and* the frontend nginx in
> front of it there are two, so every request appears to come from the campus
> proxy and the rate limits are shared by the whole college (120 API requests a
> minute, 10 failed logins per 15 minutes) — expect "Too many requests" during a
> deadline rush. Change the `1` to the real number of proxies (`2` for this
> layout) and rebuild the backend. Never set it higher than the real count:
> Express would then believe an `X-Forwarded-For` the client wrote itself, and
> anyone could dodge the login limit.

A subpath (`vjstartup.com/appraisal`) instead of a subdomain needs a frontend
rebuild (Vite `base` + router `basename`) — ask the developer.

---

## 8. Email — read before setting `EMAIL_DISABLED=false`

With email enabled the portal sends real mail to real faculty. A background
worker sends queued mail every 30 seconds and retries a failure up to 3 times.
Failed rows show on the admin **Emails** page.

Two things can send to many people at once, and both need a person to say yes:
1. **The dean's "Run quarterly snapshot" button** - a dry run that only counts
   recipients until the dean confirms it.
2. **The daily 09:00 review-window job** - it mails faculty only for a review
   window the dean has **armed**, after previewing the recipient count and a
   sample email. A window that ends unarmed still takes its snapshot but holds
   the mail until the dean releases it. `QUARTERLY_AUTOSEND=false` in `.env`
   stops the job outright.

Draft reminders are sent at most once a week per faculty, and only after a week
without edits.

On staging, keep `EMAIL_DISABLED=true` or point SMTP at a catch-all mailbox.

To test mail after deploying, use **Forgot password** on the login page for an
account whose inbox you control. It sends a one-time code by email.

Gmail limits how much one account may send per day; for a whole college, prefer
the institute's SMTP relay.

---

## 9. Scheduled jobs

These start with the backend — there is nothing to add to the host's cron:

| Schedule | Job |
|---|---|
| Every 30 s | Send queued emails |
| Daily 09:00 | Draft reminders (at most weekly per faculty) and the reviewers' daily digest |
| Daily 09:00 | Review-window mail to faculty - only for windows the dean has armed (kill switch `QUARTERLY_AUTOSEND`) |
| Daily 09:00 | Proof deadlines: a rejected proof not replaced within **14 days** loses its subsection's marks, and the appraisal goes back to the HoD on the reduced marks. The faculty stays on the red list. |

**Timezone.** The jobs use the container's local time. Compose sets
`TZ=Asia/Kolkata` by default (override it in `.env`); without it the container
runs on UTC and "09:00" fires at **14:30 IST**. Check it from inside the
container:

```bash
docker compose -f docker-compose.prod.yml exec backend node -e "console.log(new Date().toString())"
```

---

## 10. Backups and restore

Proof files live on disk in `backend/uploads` (mounted at `/app/uploads`,
`UPLOAD_DIR`), **not** in PostgreSQL. A database dump on its own restores rows
pointing at files that no longer exist, so back both up together:

```bash
scripts/backup.sh
```

This writes `backups/<timestamp>/` containing `db.dump` (pg_dump custom format),
`uploads.tar.gz`, and a `MANIFEST` with checksums plus a cross-check of every
proof row against the archived files. It refuses to run if the uploads folder is
missing, never leaves a half-written backup under a final name, and prunes
backups older than `KEEP_DAYS` (default 14) only after a successful run. The
other settings (`BACKUP_DIR`, `UPLOADS_PATH`, `COMPOSE_FILE`, `DATABASE_URL`,
`PG_BIN`) are at the top of the script.

Schedule it nightly on the host:

```cron
0 2 * * * /srv/faculty-appraisal/scripts/backup.sh >> /srv/faculty-appraisal/backups/backup.log 2>&1
```

`backups/` is git-ignored — it holds every account's password hash. **Copy it
off the machine** as well; a backup on the same disk does not survive the disk.

> The script's compose mode and the commands below have not yet been run on a
> Docker host (only the direct-database mode was tested). Do the drill once
> before relying on them.

### Restore drill (does not touch live data)

```bash
B=backups/<timestamp>
docker compose -f docker-compose.prod.yml exec -T postgres createdb -U appraisal_user restore_drill
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U appraisal_user -d restore_drill --no-owner < $B/db.dump
docker compose -f docker-compose.prod.yml exec -T postgres psql -U appraisal_user -d restore_drill -c 'SELECT count(*) FROM "User"'
docker compose -f docker-compose.prod.yml exec -T postgres dropdb -U appraisal_user restore_drill
tar -tzf $B/uploads.tar.gz | head
```

The user count should match the live database, and the archive should list files
under `./appraisals/`.

### Real restore (replaces live data)

```bash
B=backups/<timestamp>
docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U appraisal_user -d faculty_appraisal --clean --if-exists --no-owner < $B/db.dump
tar -xzf $B/uploads.tar.gz -C backend/uploads
docker compose -f docker-compose.prod.yml start backend
```

`tar -x` adds and overwrites files but does not delete uploads made after the
backup; those remain as unreferenced files.

---

## 11. Updating

```bash
scripts/backup.sh                                   # always first
git pull
docker compose -f docker-compose.prod.yml up -d --build backend frontend
docker compose -f docker-compose.prod.yml logs -f backend
```

The entrypoint re-syncs the schema. If it stops with a data-loss warning, the
update contains a destructive schema change: roll back to the previous commit
and plan that change with the developer. Do **not** add `--accept-data-loss` to
get past it.

Never run `prisma migrate` against this database — the schema is managed by
`db push` and has drifted from the migration history, so `migrate` offers to
reset the database. `npm run prisma:migrate` is wired to refuse.

---

## 12. Health, logs and monitoring

| Endpoint (backend :5000) | Purpose |
|---|---|
| `/health` | Liveness — used by the container healthcheck |
| `/health/ready` | Readiness, including a database ping |
| `/metrics` | Prometheus metrics |

These sit on the backend port, which is not published and which the frontend
nginx does not proxy, so they are reachable only inside the compose network.
Check them with `docker compose … exec backend curl -fsS http://localhost:5000/health/ready`.

Logs are JSON on stdout:

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=200 backend
```

**Monitoring stack** (`--profile monitoring`), all configured in the repository:

| Piece | Config | What it does |
|---|---|---|
| Prometheus | `prometheus.yml` | Scrapes `backend:5000/metrics` every 15 s; keeps `PROMETHEUS_RETENTION` (30d) |
| Loki | bundled `local-config.yaml` | Stores logs. **No retention limit** in that config — watch its disk |
| Alloy | `monitoring/alloy/config.alloy` | Reads every container's logs through the Docker socket (mounted read-only) and pushes them to Loki, labelled `service` and `container` |
| Grafana | `monitoring/grafana/provisioning/` | Starts with Prometheus and Loki already added as data sources |

The UIs bind to `127.0.0.1`. From your machine:

```bash
ssh -L 3000:127.0.0.1:3000 <server>     # then http://localhost:3000, user admin / GRAFANA_PASSWORD
```

In Grafana Explore, `{service="backend"} | json | status_code >= 500` lists
server errors. See [OBSERVABILITY.md](OBSERVABILITY.md) for the metric names.

---

## 13. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Login page loads but every call fails with a CORS error | `FRONTEND_URL` does not match the address in the browser (scheme, host and port must match exactly). |
| Links in emails point to the wrong site | The first entry in `FRONTEND_URL` is the link base — put the public URL first. |
| No emails arrive | Check `EMAIL_DISABLED=false`, the key is `SMTP_PASS` (app password), and port/secure pairs (587 + `false`, 465 + `true`). Failed rows show on the admin Emails page. |
| "Too many requests" for many users at once | Shared IP behind two proxies (§7). |
| Jobs run at 14:30 instead of 09:00 | `TZ` not set (§9). |
| Upload rejected as too large | File exceeds `MAX_UPLOAD_MB` (default 5), or a proxy's `client_max_body_size` is lower than 10m. |
| Proof files missing after a redeploy | `backend/uploads` was not on the host volume, or a restore skipped `uploads.tar.gz`. |
| PDF download fails | Backend image must keep `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`; check memory, then `docker compose restart backend`. |
| Backend exits on start with a Prisma data-loss message | A destructive schema change — see §11. |
| `port is already allocated` on start | Something else holds `HTTP_BIND`'s port — pick another (§4). Postgres publishes nothing, so a host PostgreSQL is not the cause. |
| `required variable X is missing a value` | A required key is empty in `.env` (§3). |
| Imported faculty cannot log in | They use `DEFAULT_IMPORT_PASSWORD` (or `Welcome@123` for accounts imported before it was set). |

---

## 14. Known gaps (as of 2026-09-19)

Closed on 2026-09-14: compose now passes every setting and enforces the required
ones; only the frontend is published; `TZ` defaults to IST; Prometheus scrapes
`backend:5000`; Alloy ships logs to Loki; Grafana's data sources are provisioned
and its password is required; `frontend/.env.example` no longer advertises
`VITE_API_URL`; the domain is `appraisal.vjstartup.com`; both images and CI
moved from end-of-life Node 20 to Node 24, the version development and the
tests run on.

Closed on 2026-09-19: imported and admin-created accounts are forced to change
their password at first sign-in (plus a script for restored accounts, §6); the
quarterly mail needs the dean to arm each review window; roles split into seven
with the admin as a maintenance-only account.

Still open — fix or accept before go-live:

- [ ] **Proxy hop count** is hard-coded to 1 in `backend/src/app.ts` — the
      deployment team sets it for the real layout (§7).
- [ ] **Not yet run on a Docker host:** the images with the new compose file,
      the pinned monitoring images, the Alloy config, and the backup script's
      compose mode with the restore commands (§10). The compose file itself is
      validated with `docker compose config`.
- [ ] Loki keeps logs with no retention limit (§12).
- [ ] Hosting prerequisites (not code): the repository is on a personal GitHub
      account, not the Vignana-Jyothi organisation; the VJ Shield scan has not
      been run; there has been no user-testing period.

---

## 15. Go-live checklist

- [ ] `.env` filled with fresh secrets, `chmod 600`, not in git
- [ ] `HTTP_BIND` chosen (§4); only 80/443 public, via the campus proxy
- [ ] DNS `appraisal.vjstartup.com` → server; TLS on the proxy
- [ ] `FRONTEND_URL=https://appraisal.vjstartup.com`, first in the list
- [ ] Proxy hop count set in `backend/src/app.ts` (§7)
- [ ] Container clock checked on IST (§9)
- [ ] Admin password changed; seed sample accounts deactivated
- [ ] Principal, dean and scrutinizer accounts created and given their roles
- [ ] `DEFAULT_IMPORT_PASSWORD` set; restored accounts flagged with `flag-default-passwords:prod` (§6)
- [ ] Test email received (Forgot password)
- [ ] Review windows set by the dean (the Q4 end is when faculty can submit); `QUARTERLY_AUTOSEND` decided; windows armed only when the dean means to mail
- [ ] `scripts/backup.sh` in cron, copied off the host, restore drill done once
- [ ] `/health/ready` green; logs readable
- [ ] End-to-end run: faculty fills the draft → uploads a proof → HoD/incharge
      verifies it on the draft → after the Q4 window, faculty submits → HoD
      approves → a dean-assigned scrutinizer finalises → faculty sees the
      reviewed score /500

---

**Last updated:** 2026-09-19
