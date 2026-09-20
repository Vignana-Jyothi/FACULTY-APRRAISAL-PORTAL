# Environment setup — guide for the deployment team

Everything the portal needs to know about its server lives in **one file, `.env`**,
next to `docker-compose.prod.yml`. This guide covers:

- how to fill `.env`;
- the exact format of every value;
- who supplies each value, and what reads it;
- what breaks if a value is wrong.

Public address: **`https://appraisal.vjstartup.com`**

Related: [DEPLOYMENT.md](DEPLOYMENT.md) (the full deploy) ·
[SECRETS.md](SECRETS.md) (security rules for these values) ·
[.env.example](.env.example) (the template).

---

## The short version — 6 steps

**1. Create the file**

```bash
cp .env.example .env
chmod 600 .env          # it will hold passwords — owner-only
```

`.env` is git-ignored. It must never be committed, emailed or pasted into chat.

**2. Generate the random secrets.** This fills only keys that are still empty,
so running it twice is safe.

```bash
fill() { grep -q "^$1=$" .env && sed -i "s|^$1=\$|$1=$2|" .env && echo "filled $1"; }
fill DB_PASSWORD          "$(openssl rand -hex 24)"
fill JWT_SECRET           "$(openssl rand -hex 32)"
fill REFRESH_TOKEN_SECRET "$(openssl rand -hex 32)"
fill GRAFANA_PASSWORD     "$(openssl rand -hex 24)"
```

**3. Get the values other people hold** (§1 below) and type them in:

- `FRONTEND_URL`
- the `SMTP_*` settings
- `HTTP_BIND`

**4. Choose the settings.** Set `EMAIL_DISABLED` (required, §3) and
`DEFAULT_IMPORT_PASSWORD` (required, §2). Review the rest of §3; the defaults
are fine for most of it.

**5. Check the file before starting.** Compose validates it without starting
anything:

```bash
docker compose -f docker-compose.prod.yml config --quiet && echo "env OK"
```

A missing required value prints `required variable X is missing a value` and
nothing starts. Then run through the [format traps](#format-traps).

**6. After the first start**, confirm it took (see [§6](#6-check-it-worked)).

---

## Format traps

These are the mistakes that look fine but misbehave:

| Trap | Why |
|---|---|
| `EMAIL_DISABLED=TRUE` **sends real mail** | Only the exact lowercase `true` turns mail off (`emailService.ts:6`). `TRUE`, `True`, `yes` and `1` all count as *not disabled*. |
| `SMTP_SECURE=TRUE` is off | Same rule (`emailService.ts:15`): only the exact lowercase `true` counts. |
| `QUARTERLY_AUTOSEND=no` **keeps the job running** | Only `false` (any case) stops it (`quarterlySnapshot.ts:297`). Anything else, blank included, means *run*. (The job still mails only for a window the dean armed — see the row below.) |
| `JWT_EXPIRES_IN=120` means 120 **milliseconds** | A duration needs a unit: `15m`, `8h`, `7d`. A bare number is read as milliseconds, which logs everyone out instantly. |
| `DB_PASSWORD` with `@ / : # + =` breaks the database | It sits inside a URL. Use hex only: `openssl rand -hex 24`. Base64 is not safe. |
| `FRONTEND_URL=https://appraisal.vjstartup.com/` | The trailing slash makes CORS reject every browser call. Give scheme and host only: no slash, no path. |
| `FRONTEND_URL=http://…` behind TLS | It must match exactly what users type, so `https://`. |
| `SMTP_FROM=VNRVJIET Portal <a@b.c>` unquoted | The `< >` need quotes: `SMTP_FROM="VNRVJIET Portal <a@b.c>"`. |
| Spaces around `=` | `KEY = value` is wrong; write `KEY=value`, one per line. |
| Changing `DB_PASSWORD` after the first start | Postgres reads it only when it creates the database. Changing `.env` later breaks the connection — see [§7](#7-changing-a-value-later). |
| Changing `GRAFANA_PASSWORD` after the first start | Grafana stores it on first boot and ignores later changes — see [§7](#7-changing-a-value-later). |
| `MAX_UPLOAD_MB` above `10` | The frontend's nginx rejects bodies over 10 MB first. Raise `client_max_body_size` in `frontend/nginx.conf` too. |

---

## 1. Values to get from someone else

| Variable | Required | Format | Example | Ask | Read by | If wrong |
|---|---|---|---|---|---|---|
| `FRONTEND_URL` | **yes** | `https://host` with no trailing slash or path. Extra origins comma-separated | `https://appraisal.vjstartup.com` | Decided. The **DNS record and TLS certificate** come from whoever runs `vjstartup.com` | `app.ts:44` (CORS) · `emailTemplates.ts:5` (links in emails) · `pdfService.ts:129` (links in PDFs) | Login page loads but every call fails with a CORS error; email links point at the wrong site |
| `SMTP_HOST` | no — `smtp.gmail.com` | hostname | `smtp.gmail.com` | Mailbox owner / college IT | `emailService.ts:13` | Mail fails (admin **Emails** page shows it) |
| `SMTP_PORT` | no — `587` | number | `587` or `465` | same | `emailService.ts:14` | Mail fails |
| `SMTP_SECURE` | no — `false` | `true` / `false`, lowercase | `false` with 587, `true` with 465 | same | `emailService.ts:15` | Mail fails with a TLS error |
| `SMTP_USER` | for mail | the mailbox address | `appraisal.portal@…` | same | `emailService.ts:17` | Mail fails: auth error |
| `SMTP_PASS` | for mail | Gmail: 16-letter **app password**, spaces removed | `abcdabcdabcdabcd` | Mailbox owner creates it (Google account → Security → App passwords) | `emailService.ts:18` | Mail fails: `535` auth error |
| `SMTP_FROM` | for mail | `"Name <address>"`, **quoted** | `"VNRVJIET Faculty Portal <appraisal.portal@…>"` | same — must be an address the mailbox may send as | `emailService.ts:154` | Mail rejected, or lands in spam |
| `HTTP_BIND` | no — `80` | `port` or `ip:port` | `80` · `127.0.0.1:8080` | Network team: where does the TLS proxy run? | the compose file (frontend `ports`) | Proxy cannot reach the site, or the site is exposed without TLS |

The college's own mail relay is better than Gmail for a whole college. Gmail
limits how much one account can send per day.

## 2. Values to generate yourself

Generate each one **fresh on the server**. Nothing may be copied from a
development machine. Step 2 above does the first four.

| Variable | Required | Format | Generate | Read by | If wrong |
|---|---|---|---|---|---|
| `DB_PASSWORD` | **yes** | hex, 32+ characters | `openssl rand -hex 24` | compose: the Postgres password, and inside `DATABASE_URL` for Prisma | Backend cannot reach the database; boot loops |
| `JWT_SECRET` | **yes** | 32+ characters, hex recommended | `openssl rand -hex 32` | `utils/jwt.ts:3`, which signs login tokens | Backend refuses to start if shorter than 32 (`jwt.ts:10`) |
| `REFRESH_TOKEN_SECRET` | **yes** | 32+ characters, **different** from `JWT_SECRET` | `openssl rand -hex 32` | `utils/jwt.ts:5`, which signs the "stay signed in" cookie | Backend refuses to start if equal to `JWT_SECRET` (`jwt.ts:15`) |
| `GRAFANA_PASSWORD` | **yes**, even without monitoring | any, hex recommended | `openssl rand -hex 24` | compose: Grafana's `admin` password | Compose refuses to start while it is blank |
| `DEFAULT_IMPORT_PASSWORD` | **yes** | 8+ characters with a letter and a digit (the portal's own password rule), and typeable — people will read it off a notice | e.g. `Vnr@Appraisal2026` | `userController.ts:436`: first password for every CSV-imported faculty account | Compose refuses to start while it is blank |
| `METRICS_TOKEN` | no | any string, no spaces | `openssl rand -hex 32` | `app.ts:27`: if set, `/metrics` needs `Authorization: Bearer <token>` | Prometheus gets 401 unless it sends the token too |
| `SEED_ADMIN_PW` · `SEED_HOD_PW` · `SEED_FACULTY_PW` | fresh install only | 8+ characters with a letter and a digit | `openssl rand -base64 18` | `prisma/seed.ts:24-26` | **Not in `.env`.** Passed with `-e` on the one seed run (DEPLOYMENT.md §6A). Without them the seed uses the public `admin123` / `hod123` / `faculty123` |

## 3. Settings to decide

| Variable | Default | Format | Read by | What it does |
|---|---|---|---|---|
| `EMAIL_DISABLED` | none — **required** | `true` or `false`, lowercase | `emailService.ts:6` | `false` sends real mail to real faculty. `true` marks mail as sent without sending it. **Staging: `true`.** |
| `QUARTERLY_AUTOSEND` | `true` | `true` / `false` | `quarterlySnapshot.ts:297` | `false` stops the daily 09:00 review-window job outright. Left on, the job takes each due window's criteria snapshot but emails faculty **only for a window the dean armed after a preview**; an unarmed window's mail is held until the dean releases it |
| `TZ` | `Asia/Kolkata` | IANA zone name | the Node clock: the 09:00 jobs in `cron/reminders.ts` and `cron/quarterlySnapshot.ts`, and dates in emails and PDFs | Wrong or blank: UTC, so "09:00" fires at 14:30 IST |
| `MAX_UPLOAD_MB` | `5` | positive number | `middleware/upload.ts:39` | Per-file upload limit; pasted links are exempt. An invalid value logs a warning and uses 5 |
| `JWT_EXPIRES_IN` | `8h` | duration **with unit**: `15m`, `8h` | `utils/jwt.ts:4` | Access-token lifetime |
| `REFRESH_TOKEN_EXPIRES_IN` | `7d` | duration with unit | `utils/jwt.ts:6` | How long a login lasts without re-entering the password |
| `LOG_LEVEL` | `info` | `fatal` `error` `warn` `info` `debug` `trace` | `middleware/logger.ts:10` | How much the backend logs |
| `PROMETHEUS_RETENTION` | `30d` | Prometheus duration: `15d`, `720h` | compose: Prometheus flag | How long metrics are kept (monitoring only) |

## 4. Set by the stack — do not add these to `.env`

| Variable | Set in | Value | Read by |
|---|---|---|---|
| `DATABASE_URL` | compose, built from `DB_PASSWORD` | `postgresql://appraisal_user:…@postgres:5432/faculty_appraisal` | Prisma |
| `NODE_ENV` | compose / Dockerfile | `production` | `app.ts:79`, `authController.ts:24` (secure cookies), `rateLimit.ts:28`, `logger.ts:5` |
| `PORT` | compose | `5000` — nginx expects it | `app.ts:80` |
| `UPLOAD_DIR` | compose | `/app/uploads`, the host folder `./backend/uploads` | `utils/uploadPaths.ts:16` |
| `PUPPETEER_EXECUTABLE_PATH` | backend Dockerfile | `/usr/bin/chromium-browser` | `pdfService.ts:18` |

## 5. Not a variable, but you must set it

**How many proxies stand in front of the backend.** It is hard-coded in
`backend/src/app.ts` line 72: `app.set('trust proxy', 1)`. Behind the college's
TLS proxy **plus** the frontend's nginx there are **two**. Change the `1` to `2`
before building, or every user shares one IP address for the rate limits
(120 requests a minute, 10 failed logins per 15 minutes).

Never set it higher than the real count. A higher number lets a client fake
its address and dodge the login limit.

---

## A filled-in `.env`, for shape only

Every value below is a placeholder. Do **not** copy them.

```dotenv
DB_PASSWORD=<48 hex characters from step 2>
JWT_SECRET=<64 hex characters from step 2>
REFRESH_TOKEN_SECRET=<64 different hex characters from step 2>
JWT_EXPIRES_IN=8h
REFRESH_TOKEN_EXPIRES_IN=7d

FRONTEND_URL=https://appraisal.vjstartup.com
HTTP_BIND=127.0.0.1:8080

EMAIL_DISABLED=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<sending mailbox>
SMTP_PASS=<16-letter app password>
SMTP_FROM="VNRVJIET Faculty Portal <sending mailbox>"
QUARTERLY_AUTOSEND=true

DEFAULT_IMPORT_PASSWORD=<shared first-login password>

MAX_UPLOAD_MB=5
TZ=Asia/Kolkata
LOG_LEVEL=info
METRICS_TOKEN=

GRAFANA_PASSWORD=<48 hex characters from step 2>
PROMETHEUS_RETENTION=30d
```

---

## 6. Check it worked

Run these after `docker compose -f docker-compose.prod.yml up -d --build`:

| Check | How | Expect |
|---|---|---|
| Database + backend up | `docker compose -f docker-compose.prod.yml exec backend curl -fsS http://localhost:5000/health/ready` | `{"status":"ready","db":"up"}` (a `503` with `"db":"down"` means `DB_PASSWORD` or Postgres is wrong) |
| Clock is IST | `docker compose -f docker-compose.prod.yml exec backend node -e "console.log(new Date().toString())"` | `GMT+0530 (India Standard Time)` |
| `FRONTEND_URL` right | Open `https://appraisal.vjstartup.com` and log in | No CORS error in the browser console |
| Mail works | **Forgot password** on the login page, for an inbox you control | A one-time code arrives |
| Mail setting is what you meant | `docker compose -f docker-compose.prod.yml exec backend printenv EMAIL_DISABLED` | Exactly `true` or `false` |

## 7. Changing a value later

Edit `.env`, then **recreate** the container. `restart` keeps the old values.

```bash
docker compose -f docker-compose.prod.yml up -d backend
```

| Value | Extra step |
|---|---|
| `JWT_SECRET` / `REFRESH_TOKEN_SECRET` | None, but everyone is logged out |
| `DB_PASSWORD` | Change it **inside Postgres first**, then in `.env`, then recreate the backend: `docker compose -f docker-compose.prod.yml exec postgres psql -U appraisal_user -d faculty_appraisal -c "ALTER USER appraisal_user PASSWORD '<new hex>'"` |
| `GRAFANA_PASSWORD` | Grafana ignores the new value. Reset it: `docker compose -f docker-compose.prod.yml exec grafana grafana cli admin reset-admin-password '<new>'` |
| `SMTP_*`, `EMAIL_DISABLED`, `TZ`, others | None |

---

## Before handing over

- [ ] Every required key filled; `docker compose … config --quiet` prints nothing
- [ ] Secrets generated on the server, none copied from development
- [ ] `.env` is `chmod 600` and not in Git
- [ ] `FRONTEND_URL` is `https://appraisal.vjstartup.com`, with no trailing slash
- [ ] `EMAIL_DISABLED` is exactly `false` in production (`true` on staging)
- [ ] Proxy count set in `backend/src/app.ts` (§5)
- [ ] All the checks in §6 pass
