# IT Handoff — VNRVJIET Faculty Appraisal System

One-page brief for the deployment team. Full detail in [DEPLOYMENT.md](DEPLOYMENT.md),
[GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md), [SECRETS.md](SECRETS.md) and
[OBSERVABILITY.md](OBSERVABILITY.md).

**Public address: `https://appraisal.vjstartup.com`**

---

## What changed since 2026-09-14 (read this if you saw the earlier handoff)

- **Seven roles.** `ADMIN` is now a maintenance account only (accounts, role
  assignment, email queue, audit log) and cannot open appraisals, reports or
  proof files. The **principal** sees everything; the **dean** owns
  configuration (academic years, departments, cadre targets, tiers, review
  windows) and assigns the **scrutinizers**, a cross-department final-review
  pool. HoD, incharge (REVIEWER) and faculty are as before.
- **The appraisal is one draft for the whole year.** Faculty keep editing it and
  can submit only after the Q4 review window ends. During the year the HoD and
  incharge check its proofs and the HoD notes provisional marks.
- **Imported and admin-created accounts must change their password** at first
  sign-in; the portal blocks everything else until they do.
- **The quarterly mail is gated.** The daily job emails faculty only for a
  review window the dean has **armed** after a preview; an unarmed window holds
  its mail until released. Draft reminders go out at most once a week.
- New database tables come in automatically on the next start (the entrypoint
  runs `prisma db push`); nothing to migrate by hand.

---

## What this is

A self-contained, Dockerized faculty appraisal portal. One `docker compose` file
runs the app, its database and (optionally) monitoring.

| Component | Image / build | Port in container | Published on the host |
|-----------|---------------|-------------------|-----------------------|
| Frontend (React SPA + nginx) | `./frontend` | 80 | `HTTP_BIND` (default `80`) — the only public service |
| Backend (Node/Express API + scheduled jobs) | `./backend` | 5000 | no |
| PostgreSQL 15 | `postgres:15-alpine` | 5432 | no |
| Prometheus *(optional)* | `prom/prometheus:v3.5.5` | 9090 | `127.0.0.1` only |
| Loki *(optional)* | `grafana/loki:3.7.7` | 3100 | `127.0.0.1` only |
| Alloy — ships logs to Loki *(optional)* | `grafana/alloy:v1.19.2` | 12345 | no |
| Grafana *(optional)* | `grafana/grafana:13.2.1` | 3000 | `127.0.0.1` only |

The frontend's nginx proxies `/api` and `/uploads` to the backend over the
internal compose network, so nothing else needs a host port. The monitoring
services start only with `--profile monitoring`.

---

## Deploy

```bash
git clone <repo-url> faculty-appraisal
cd faculty-appraisal
cp .env.example .env && chmod 600 .env          # fill it — see below

docker compose -f docker-compose.prod.yml up -d --build                 # app
docker compose -f docker-compose.prod.yml --profile monitoring up -d    # optional monitoring

docker compose -f docker-compose.prod.yml logs -f backend               # watch it boot
docker compose -f docker-compose.prod.yml exec backend curl -fsS http://localhost:5000/health/ready
```

On first boot the backend runs `prisma db push` to create the schema. There is
no manual migration step, and `prisma migrate` must never be run (see
DEPLOYMENT.md §11).

---

## Required config (`.env`)

Compose **refuses to start** while any value marked required is missing, so a
blank secret can never reach the app. **Follow [ENV_SETUP.md](ENV_SETUP.md)**
to fill it. It gives the exact format of every value, a command that generates
the secrets, the traps (for example `EMAIL_DISABLED=TRUE` *sends* mail), and
how to check the result.

| Key | What |
|-----|------|
| `DB_PASSWORD` | **Required.** URL-safe, because it sits inside the database URL: `openssl rand -hex 24` |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | **Required.** 32+ characters each, and different: `openssl rand -hex 32` |
| `FRONTEND_URL` | **Required.** `https://appraisal.vjstartup.com` — CORS blocks the browser if it differs from the address users type |
| `EMAIL_DISABLED` | **Required.** `false` sends real mail to real faculty; use `true` on staging |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Sending mailbox; `SMTP_PASS` is a Gmail app password, not the account password |
| `DEFAULT_IMPORT_PASSWORD` | **Required.** Password given to faculty created by CSV import |
| `GRAFANA_PASSWORD` | **Required** by compose even when monitoring is not started — set it anyway |
| `HTTP_BIND` | `80`, or `127.0.0.1:8080` when the TLS proxy runs on this same host |
| `TZ` | Defaults to `Asia/Kolkata`, so the 09:00 jobs run at 09:00 IST |

---

## DNS, TLS and your proxy

1. DNS: **`appraisal.vjstartup.com` → this server**.
2. Terminate TLS at your proxy and forward to the frontend (`HTTP_BIND`). Pass
   `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`.
3. `FRONTEND_URL=https://appraisal.vjstartup.com` in `.env`.
4. **Count your proxy hops.** The backend trusts exactly one proxy
   (`app.set('trust proxy', 1)` in `backend/src/app.ts`, hard-coded). Your proxy
   plus the frontend nginx is **two**, so change that `1` to `2` before building,
   or every user shares one IP for the rate limits (120 requests/min, 10 failed
   logins/15 min). Never set it higher than the real number of proxies — clients
   could then fake their IP and skip the login limit.

A subpath (`vjstartup.com/appraisal`) instead of a subdomain needs a frontend
rebuild (Vite `base` + router `basename`) — ask the developer.

---

## First run

Pick one:

- **Existing data** — the developer hands over a `backups/<stamp>/` folder; restore
  it before the backend starts (DEPLOYMENT.md §6B).
- **Fresh install** — seed an admin with your own passwords (not the repository
  defaults), then deactivate the sample accounts the seed creates:
  ```bash
  docker compose -f docker-compose.prod.yml exec \
    -e SEED_ADMIN_PW='<strong>' -e SEED_HOD_PW='<random>' -e SEED_FACULTY_PW='<random>' \
    backend npm run seed:prod
  ```

Then:

1. Change the admin password.
2. As admin, create the principal, dean and scrutinizer accounts and give each
   its role, and assign each department's HoD and incharges. The admin cannot
   do step 3 - it holds no appraisal content.
3. As the dean: academic year, departments, cadre targets and the Q1-Q4 review
   windows. The Q4 window's end date is when faculty can first submit.
4. Bulk-import faculty. They receive `DEFAULT_IMPORT_PASSWORD` and are made to
   change it at their first sign-in.

**If you restored existing data** (above), flag the accounts that are still on
the old shared import password so they are forced to change it too - dry run
first, then confirm with the database name:

```bash
docker compose -f docker-compose.prod.yml exec backend npm run flag-default-passwords:prod
docker compose -f docker-compose.prod.yml exec backend npm run flag-default-passwords:prod -- --confirm=faculty_appraisal
```

---

## Operations

| Item | Note |
|------|------|
| **Backups** | `scripts/backup.sh` — database dump **and** the `backend/uploads` proof files together, with a checksummed manifest. Schedule nightly in the host's cron (line in DEPLOYMENT.md §10) and copy `backups/` off the machine. Its compose mode has not been run on a Docker host yet: do the restore drill once. |
| **Updates** | `scripts/backup.sh`, then `git pull && docker compose -f docker-compose.prod.yml up -d --build backend frontend`. The entrypoint re-syncs the schema and stops on any change that would drop data. |
| **Health** | `/health` (liveness) and `/health/ready` (database) — internal; the container healthcheck uses them. |
| **Monitoring** | `--profile monitoring`. Grafana starts with Prometheus and Loki already connected; Alloy ships every container's logs. Reach Grafana with `ssh -L 3000:127.0.0.1:3000 <server>`. Alloy mounts the Docker socket read-only. |
| **Mail** | `EMAIL_DISABLED=false` mails real faculty. Nothing bulk goes out unless the dean arms a review window after previewing it (or confirms the snapshot button). `QUARTERLY_AUTOSEND=false` stops the quarterly job outright. |
| **Firewall** | Public: 80/443 only. |

---

## Resource sizing

About 2 vCPU / 4 GB RAM minimum; more with the monitoring profile. The backend
runs headless Chromium for PDF export, and the first PDF after a restart takes a
few seconds.

---

## Contact

Codebase questions → the developer. Everything above is standard
`docker compose` operation.
