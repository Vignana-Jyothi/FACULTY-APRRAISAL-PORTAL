# Go-Live Checklist — Docker Compose Self-Host

Tasks split by owner, in order. Public address: **`https://appraisal.vjstartup.com`**.

Legend: **[DEV]** = developer / repository · **[OPS]** = the deployment team.

---

## Phase 0 — Code and deploy files  (DEV)

| # | Task | Status |
|---|------|--------|
| 0.1 | App builds clean (backend `tsc`, frontend `vite build`) | ✅ |
| 0.2 | Tests green (455 backend, 124 frontend) | ✅ |
| 0.3 | Compose file ready: only the frontend published, required values enforced with `:?`, every setting passed through, `TZ`, monitoring behind a profile with pinned images | ✅ checked with `docker compose config` |
| 0.4 | Monitoring wired: Prometheus scrapes `backend:5000`, Alloy ships logs to Loki, Grafana data sources provisioned | ✅ files ready |
| 0.5 | Domain set to `appraisal.vjstartup.com` in `.env.example` and the docs | ✅ |
| 0.6 | Images built and run on a Docker host | ⚠️ last full build 2026-07-05; the deploy team's first build is the check |
| 0.7 | Node 24 (`node:24-alpine`) in both Dockerfiles and CI — Node 20 is end-of-life | ✅ |
| 0.8 | Force a password change at first login (73 imported accounts share one password) | ✅ built 2026-09-19 - restored accounts need `flag-default-passwords:prod` (DEPLOYMENT.md §6) |

---

## Phase 1 — Host  (OPS)

| # | Task | Notes |
|---|------|-------|
| 1.1 | Linux server with Docker Engine + Compose v2 | `docker compose version` works. About 2 vCPU / 4 GB RAM |
| 1.2 | One host port free for the frontend | `HTTP_BIND` (default 80). Postgres and the backend publish nothing, so a PostgreSQL already on the host does not clash |
| 1.3 | DNS A record | `appraisal.vjstartup.com` → server IP |
| 1.4 | Firewall | Public 80/443 only. Monitoring binds to 127.0.0.1 |

---

## Phase 2 — Configuration  (OPS)

| # | Task | Notes |
|---|------|-------|
| 2.1 | `cp .env.example .env && chmod 600 .env` | Compose reads it; it is git-ignored |
| 2.2 | Fill every **required** key | `DB_PASSWORD` (hex), `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `FRONTEND_URL`, `EMAIL_DISABLED`, `DEFAULT_IMPORT_PASSWORD`, `GRAFANA_PASSWORD`. Compose refuses to start without them |
| 2.3 | SMTP settings | App password in `SMTP_PASS`; 587 + `SMTP_SECURE=false` or 465 + `true` |
| 2.4 | `HTTP_BIND` | `127.0.0.1:8080` if the TLS proxy runs on this host |
| 2.5 | Proxy hops | Behind your proxy **and** the frontend nginx, change `app.set('trust proxy', 1)` to `2` in `backend/src/app.ts` before building (IT_HANDOFF.md) |

---

## Phase 3 — TLS  (OPS)

Terminate TLS at your reverse proxy and forward to the frontend. `FRONTEND_URL`
must be the `https://` origin exactly as users type it. An nginx example is in
DEPLOYMENT.md §7.

---

## Phase 4 — Deploy  (OPS)

| # | Task | Command |
|---|------|---------|
| 4.1 | Get the code | `git clone … faculty-appraisal && cd faculty-appraisal` |
| 4.2 | Build and start | `docker compose -f docker-compose.prod.yml up -d --build` |
| 4.3 | Watch the boot (`prisma db push`) | `docker compose -f docker-compose.prod.yml logs -f backend` |
| 4.4 | Health | `docker compose -f docker-compose.prod.yml exec backend curl -fsS http://localhost:5000/health/ready` |
| 4.5 | Open the site | `https://appraisal.vjstartup.com` → login page |

---

## Phase 5 — First-run data  (OPS)

| # | Task | Notes |
|---|------|-------|
| 5.1 | Existing data **or** a fresh admin | Restore the developer's `backups/<stamp>/` (DEPLOYMENT.md §6B), or `seed:prod` with `-e SEED_*_PW` values (§6A) |
| 5.2 | Change the admin password | Immediately |
| 5.3 | Deactivate the seed's sample accounts | Fresh installs only |
| 5.4 | Principal, dean and scrutinizer accounts with their roles; HoDs and incharges | Admin UI (the admin is maintenance-only and cannot do 5.4a) |
| 5.4a | Academic year, cadre targets, tier thresholds, Q1-Q4 review windows | Dean's UI - the Q4 window's end is when faculty can first submit |
| 5.5 | Bulk-import faculty | The portal makes each change the import password at first sign-in (0.8) |
| 5.6 | Test email | "Forgot password" for an inbox you control |

---

## Phase 6 — Monitoring  (OPS, optional)

| # | Task | Notes |
|---|------|-------|
| 6.1 | Start it | `docker compose -f docker-compose.prod.yml --profile monitoring up -d` |
| 6.2 | Open Grafana | `ssh -L 3000:127.0.0.1:3000 <server>`, then `http://localhost:3000`, user `admin` / `GRAFANA_PASSWORD` |
| 6.3 | Check both data sources | Prometheus target `backend:5000` up; Loki query `{service="backend"}` returns logs |
| 6.4 | Retention | Prometheus keeps `PROMETHEUS_RETENTION` (30d). Loki's bundled config has no retention limit — watch its disk |

---

## Phase 7 — Operations  (OPS, ongoing)

| # | Task | Notes |
|---|------|-------|
| 7.1 | Nightly backup | `scripts/backup.sh` in the host's cron (DEPLOYMENT.md §10); copy `backups/` off the machine |
| 7.2 | Restore drill, once | Scratch database, compare counts (DEPLOYMENT.md §10). The script's compose mode is untested until this runs |
| 7.3 | Updates | Backup first, then `git pull` and `up -d --build backend frontend` |
| 7.4 | Disk | Postgres, proof files, Loki, Prometheus |

---

## Not code — hosting agreement

- [ ] Repository moved to the Vignana-Jyothi GitHub organisation
- [ ] VJ Shield scan run
- [ ] A user-testing period before go-live

Blocking order: **1 → 2 → 3 → 4 → 5**. Phases 6–7 after the app is live.
