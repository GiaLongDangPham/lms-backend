# I2b deployment runbook

21/11/2026: user confirmed no staging exists. Files are prepared; no server deployment is claimed.

Check out the matching task branches of lms-backend and lms-frontend as siblings.
Requires Docker Linux containers, external HTTPS reverse proxy/domain and persistent disk.
Copy `.env.example` to `.env` in this directory. Generate separate 32-byte random hex
values for POSTGRES_PASSWORD, JWT_SECRET and STORAGE_PASSWORD using Node crypto.
Passwords must be URL-safe (hex). PUBLIC_ORIGIN is the exact HTTPS frontend origin.
Keep `.env` private; do not pass secrets in screenshots, tracker or shell output.

From backend: `docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet`,
then `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build`.
The migration service applies immutable versions through 0007 before API starts.
MinIO bucket is private; file reads/uploads go through authorized API endpoints.
Postgres/MinIO/API have no host port. Web binds 127.0.0.1:18080 only; terminate TLS
in the host proxy and forward to it. Cookies are Secure and require HTTPS.
This package uses MinIO root credentials for an isolated staging bucket; provision a
bucket-scoped app identity before using shared/production storage.

Do not seed demo users on the shared server. Provision authorized accounts separately.
Do not run db:test/api:test/acceptance against the staging database: those are local-only.
The in-process B5 worker starts immediately and every 5 minutes; at least one API
replica must stay running. File cleanup is a separate job: schedule
`node node_modules/tsx/dist/cli.mjs scripts/cleanup-files.ts` using the build image
with the API environment; it preserves ATTACHED history. Confirm the scheduler's
credentials and logs without exposing values. API runtime intentionally omits tsx.

Acceptance: `/api/ready` 200; direct navigation to /student/notifications loads SPA;
login/refresh/logout persists; create assignment -> SV notification with class/deadline;
one deadline reminder per current deadline; Draft remains hidden; publish -> notification;
read badge persists after reload; shared comments across GV/SV and outsider denied;
upload/download returns same bytes and private bucket denies anonymous GET.
Record URL, BE/FE commit, migration version, test actor/role/time and QA result.

Backup PostgreSQL and object volumes before release. Never run `down -v` to upgrade.
Rollback app images/commits only when compatible with applied migrations; never edit
applied SQL or reset data. Database restoration requires an explicit approved recovery.
Image tags are fixed release tags; validate their availability before first image build.
