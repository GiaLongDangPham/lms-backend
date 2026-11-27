# T4 System Regression Implementation Plan

> Execute directly with superpowers:executing-plans; no sub-agents.

**Goal:** Fix QA 19/11 blockers and prove integrated regression before push.
**Architecture:** Extend existing assignment/assessment HTTP boundaries and FE flows.
**Tech Stack:** Express/pg/PostgreSQL/React, Vitest, browser acceptance.
**Spec:** `docs/superpowers/specs/T4-system-test.md`

## Global Constraints

Task-prefixed branches/docs/commits; no develop merge; no project DB/tracker writes.
Preserve applied migrations, auth, Draft privacy, file safety and immutable history.
Q2 approved 19/11 overrides older no-late-resubmission documentation.

## Review Focus

Late resubmission after Draft/publication stays denied; creation deadline uses server;
SV direct form cannot bypass Published lock; teacher aggregate does not leak Draft to
SV/outsiders; historical versions and author/provenance remain truthful.

## Task 1: Backend regression RED/GREEN

Files: assignments integration/service, assessment service/repository/routes/controller,
tests contract/client rules, OpenAPI/mock.
- [x] Write failing late-version/creation-deadline/aggregate/privacy tests first; record RED.
- [x] Implement Q2/deadline and teacher grade list, PublishedGrade gradedBy.
- [x] Update contract and old test expectations to new approved behavior, preserving boundaries.
- [x] Focused API and all static/unit tests pass; full API DB later.

## Task 2: Frontend bugs and browser acceptance

Files: grades/assignments clients + tests, GV grading/list, SV detail/form/result, LoginPage,
scripts/integration-acceptance.mjs.
- [x] Add focused gradebook tests and browser failing checks for QA bugs.
- [x] GV grade aggregate + complete version list with files; no per-student history fanout.
- [x] Published result blocks detail/form submission; Vietnamese lock errors; public grader/history.
- [x] Creation validation in form and remove demo password. Existing grade precision stays tested.
- [x] Browser retest mapped QA cases, no pageerror, mobile layout and visual evidence.

## Task 3: Final verification/review/delivery

- [x] Run backend/frontend check, full API, DB, contract/mock, compose config, browser acceptance.
- [x] Separate final self-review of diff against spec/security and all QA issue mappings.
- [x] Record actual counts, evidence and incomplete external gates; no fake QA closure.
- [x] Commit and push both T4 branches; verify remote SHAs and clean working trees.

## Ledger

- Stacked on I2b (BE bf24fe2, FE e05530f); all I2a/I2b local checks green.
- User confirms no deployment: local integration and prepared deploy package only.
- Self-review replaces reviewer sub-agent per user's no-sub-agent preference.

## Verification evidence — 21/11/2026

RED before implementation: three T4 API groups failed for late resubmission,
past deadline and missing aggregate route; gradebook client test failed for absent
automatic-zero grade; browser direct-form check failed before Published lock fix.
Logs are local under workspace `tmp/verification/T4-{red,fe-red,browser-red}.log`.

Final checks (all exit 0):

| Check | Result / evidence |
| --- | --- |
| BE `npm run check` | lint, typecheck, 39 unit/contract tests, build; `T4-be-final.log` |
| BE `npm run api:test` | 97 real HTTP/PostgreSQL tests in 9 suites; `T4-api-all.log` |
| BE `npm run db:test` | 21 checks, migrations/seed/constraints, disposable DB removed; `T4-db.log` |
| FE `npm run check` | lint, 81 tests, TypeScript/Vite build; `T4-fe-final.log` |
| OpenAPI / mock | `npm run api:validate`, `node scripts/mock-api.mjs --self-test`: 35 paths / 49 operations |
| Deployment config | `docker compose -f deploy/compose.yaml config --quiet` with synthetic env |
| Browser `node scripts/integration-acceptance.mjs T4` | 10 groups, no pageerror; `T4-browser-final.log`, FE ignored `.acceptance/T4-evidence.json` |
| Visual / whitespace | Reviewed gradebook, teacher history and 390px student result screenshots; no clipped content; both repos `git diff --check` |

QA mapping (local retest, not blanket closure of the original 56 manual cases):

| QA item | Verified behavior |
| --- | --- |
| Bug-03 / Q2 | Late second version accepted, first snapshot unchanged; Draft/Published still lock |
| Bug-04 | Past creation deadline rejected server-side with no assignment persisted; FE min + submit validation |
| Bug-05 | Teacher sees both versions and downloads first file with original bytes |
| Bug-06 | Published automatic zero blocks even direct student submit form |
| Bug-07 / Fail-07 | Teacher gradebook includes zero and corrected score; no per-student HTTP history fanout |
| Bug-08 | Actual grader differs from publisher and is displayed; student sees no Draft/gradedAt; published history starts at 1 |
| Bug-09 | Assignment/class/deadline context, reminder dedup, recipient scope, menu unread and read/reload persistence |
| Bug-10 | Login contains no demo password; password label matches field |
| Fail-05 / Fail-06 | 8.125 invalid, correction to 2.5 persisted and reflected in gradebook |
| I2b regression | Shared comments persist, HTML-like text stays plain, peer/teacher allowed, outsider 404 |

Self-review: compared diff against spec and QA mapping; checked teacher-only cursor
scope, Draft privacy, grade locks and version snapshots, absence of migration edits,
task branch bases, generated-file exclusions and secret handling. Existing UI styling
is preserved. Tests use temporary local databases; project `.env`/DB/tracker untouched.

Runtime here is Node 26.13.1; project/CI/Docker target remains Node 22. Tests above do
not certify CI on Node 22. Browser uses real FE/API/PostgreSQL with an in-process
object-storage adapter, not deployed S3/MinIO. Docker daemon is unavailable, so images
have not been built/run here. No staging URL exists per user; HTTPS, remote object
storage, deployed image behavior, external QA and independent review remain gates.

Branches are stacked `develop → I2a-tich-hop-thong-bao → I2b-tich-hop-comment →
T4-system-test-regression` in both repos. Review/merge in that order; no develop merge
is performed by this delivery.

Delivery verified by `git ls-remote origin refs/heads/<branch>` against local heads:

| Branch | Backend | Frontend |
| --- | --- | --- |
| I2a-tich-hop-thong-bao | c51f879 | f3e0334 |
| I2b-tich-hop-comment | bf24fe2 | e05530f |
| T4-system-test-regression (implementation) | 01c12b4 | 65f9b30 |

Both working trees were clean after these pushes. This final evidence-only update
is committed separately on T4; it does not change the implementation verified above.
