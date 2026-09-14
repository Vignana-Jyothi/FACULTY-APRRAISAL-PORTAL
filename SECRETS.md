# Secrets — rules

**No secret values belong in this file, or anywhere else in this repository.**
The values are set on the host at deploy time, in the server's `.env`
(git-ignored, `chmod 600`), which `docker-compose.prod.yml` reads. Anything
committed to Git stays in history even after it is deleted, so a leaked value
means rotation, not a revert.

**The full list of settings lives in [ENV_SETUP.md](ENV_SETUP.md).** It gives
each setting's format, example, source, the code that reads it, what breaks
when it is wrong, and how to change it later. This file keeps only the security
rules around those values.

## Which values are secret

| Secret | Unique per environment | Rotating it |
|---|---|---|
| `DB_PASSWORD` | yes | Change it inside Postgres first (ENV_SETUP.md §7) |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | yes | Logs everyone out |
| `SMTP_PASS` (and `SMTP_USER`) | yes | Revoke the app password at the provider, create a new one |
| `GRAFANA_PASSWORD` | yes | `grafana cli admin reset-admin-password` (ENV_SETUP.md §7) |
| `DEFAULT_IMPORT_PASSWORD` | yes | Affects future imports only; existing accounts keep theirs |
| `METRICS_TOKEN` (if used) | yes | Update Prometheus to send the new one |
| `SEED_*_PW` | one-off | Passed once to the seed, never stored in `.env` |

## Before the first production deploy

- [ ] Every secret generated fresh on the server — **none reused from
      development**. The dev `JWT_SECRET` and SMTP credentials must not travel.
- [ ] `.env` is `chmod 600` and not in Git.
- [ ] `ADMIN001`'s password changed at first login. If the seed ran without
      `SEED_ADMIN_PW`, it is the public `admin123` until then.
- [ ] Imported faculty told to change `DEFAULT_IMPORT_PASSWORD` (or
      `Welcome@123`, for the 73 accounts imported before it existed). The
      portal does not force the change yet.
- [x] Dev scripts take credentials from `ADMIN_PW` / `HOD_PW` / `FACULTY_PW` /
      `TEST_EMAIL`, with no fallback.
- [x] A blank `SEED_*_PW` or `DEFAULT_IMPORT_PASSWORD` falls back instead of
      becoming an empty password, and compose refuses to start with a blank
      required secret.

## ⚠️ Mail

`EMAIL_DISABLED=false` makes the application send real mail to real addresses.
Only the exact lowercase `true` disables it, so `TRUE` sends. Two paths send in
bulk:

- the admin "Run quarterly snapshot" button, which is a dry run until
  explicitly confirmed;
- the daily 09:00 review-window job, which fires on a window's end date **with
  nobody clicking anything**. `QUARTERLY_AUTOSEND=false` stops it.

Point a staging deployment at a catch-all mailbox, or keep
`EMAIL_DISABLED=true` there.

## If a secret leaks

1. Rotate at the source (new app password, new JWT secret, new DB password).
2. Redeploy (ENV_SETUP.md §7). Rotating `JWT_SECRET` or `REFRESH_TOKEN_SECRET`
   invalidates every session — expect all users to be logged out.
3. Do not rewrite Git history and assume that is sufficient; treat the value as
   compromised from the moment it was pushed.
