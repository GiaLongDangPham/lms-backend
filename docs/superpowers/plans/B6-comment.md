# B6 Comment Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans directly. User prohibits sub-agents, including reviewers.

**Goal:** Implement four B6 HTTP operations with class/owner authorization and contract-compatible pagination.

**Architecture:** Dedicated comments repository/service/router; existing pg transaction and B1 auth helpers. Existing comments table, no dependency or schema changes.

**Tech Stack:** Node 22, Express, TypeScript, PostgreSQL 17, Vitest/Supertest/Ajv.

**Spec:** `docs/superpowers/specs/B6-comment.md`

## Global Constraints

- Branch `B6-comment`; task-prefixed document names and commits `[B6] ...`.
- Implement directly without sub-agents. Self-review only; Nam review remains external.
- Private submission discussion for owner/assigned teachers; record Q09 discrepancy.
- Existing OpenAPI remains shared contract; no direct edits to Nam's task documents.
- Use unique temporary databases only; do not mutate project DB or tracker.

## Review Focus

- Same-class students attempting another student's submission: GET/POST 404.
- Revoked membership or teacher assignment: both read/write denied without deleting history.
- Cross-target or malformed cursor: 400; no duplicate/missing items over a fixed dataset.
- Forged author/target and whitespace-only body: 400; writes persist authenticated author only.
- Published/Draft work: discussion allowed without exposing grade/feedback fields.

## Task 1: HTTP contract and authorization (RED)

Files: create `tests/comments.integration.test.ts`; modify `scripts/test-api.ts`.
Consumes: seedIds, createApp and existing seeded schema.
Produces: `--comments` isolated API test selection, included in default full suite.

- [x] Add tests exercising real HTTP and PostgreSQL for all four routes, response schemas,
  authorization matrix, validation, membership revocation, pagination and publication.
- [x] Run `npm run api:test -- --comments`. Expected: assertions fail with 404 for
  valid POST/GET because comments router does not yet exist (not environment errors).
- [x] Record RED evidence before product code.

## Task 2: B6 implementation (GREEN)

Files: create `src/modules/comments/comment.repository.ts`, `comment.service.ts`,
`comment.routes.ts`; modify `src/app.ts`.
Consumes: Principal, requireClassAccess, transaction, parse, paging, cursorId, page.
Produces: `createCommentRouter(pool: pg.Pool, config: AuthConfig)` mounted at `/api`;
service `list(principal,target,after,limit,scope)` and `create(principal,target,body)`.
Target: `{kind:'assignment'|'submission'; id:string}`. DTO follows spec exactly.

- [x] Repository resolves target/class/owner, reads target-bound rows ordered by UUID,
  inserts authenticated author, joins display identity only. Parameterize all user values.
- [x] Service enforces role/target/membership/ownership; transaction covers authorization
  and writes. Router parses strict UUID/query/body and returns 200/201 with no-store.
- [x] Run `npm run api:test -- --comments`. Expected: all B6 tests pass against real DB.
- [x] Run `npm run check`. Expected: lint/types/unit tests/build pass; DB tests skipped here.
- [x] Commit implementation and tests using `[B6]` prefix.

## Task 3: Regression, documentation and self-review

Files: modify `README.md`, `docs/superpowers/README.md`, this plan.

- [x] Run `npm run api:test`, `npm run db:test`, `npm run api:validate`, `git diff --check`.
  Expected: all selected tests/checks pass, temporary DBs removed.
- [x] Review full branch diff against spec and Review Focus; fix substantive findings
  using failing regression tests first. No sub-agent dispatch.
- [x] Document local evidence, integration instructions and remaining Nam/CI/staging gates.
- [x] Commit docs/evidence; leave branch ready for review without merging develop.

## Evidence / execution ledger

- Baseline `npm test`: 31 passed, 73 DB-dependent skipped. Working tree clean before branch.
- Ruling: work in current checkout on requested new branch; no extra worktree needed.
- Ruling: user explicitly requests spec/plan then implementation; proceed without a separate approval round.
- Pre-flight: Task 1 tests consume Task 2 router through createApp; Task 3 verifies both.
- Task 1: complete. RED: 7 expected failures (valid operations returned 404), 1 denial test passed. Log: workspace `../tmp/verification/b6-red.log`.
- Task 2: complete. GREEN: 9/9 B6 PostgreSQL HTTP tests. Implementation commit `73611ac`.
- Ruling: `npm run api:test -- --comments` was swallowed by the PowerShell npm wrapper;
  use `node node_modules/tsx/dist/cli.mjs scripts/test-api.ts --comments` for focused runs.
  The ordinary `npm run api:test` remains the full suite and includes B6.
- Ruling: add an enrollment FOR SHARE lock after the shared helper, without changing
  other modules. Mutation check removing SHARE reproduced unauthorized racing INSERT
  (201 instead of 404); restoring SHARE passed. Log: `../tmp/verification/b6-race-red.log`.
- Test fixture correction: publication is immutable; the publication-discussion test
  creates its own assignment/submission instead of resetting publication on shared seed.
- Task 3: local regression complete: `npm run api:test` 82/82 across 7 files (22+13+7+6+8+17+9),
  `npm run db:test` 20/20, OpenAPI structural validation 34 paths/48 operations/6 modules,
  mock self-test passed, `git diff --check` clean. All random test databases removed.
- `npm run check`: lint + TypeScript + build passed; 31 unit/contract tests passed,
  82 DB-dependent tests skipped in that command and run separately in API suite above.
- Final review: self-review, no sub-agent as explicitly requested. Checked all new
  product/test files and integration diff against spec/Review Focus; no unresolved
  Critical/Important findings. Made pagination test create its own submission comments
  so it does not rely on earlier tests. No deferred minor findings.
- Staging discovery: repo has `.github/workflows/ci.yml` only (no deploy workflow);
  S1 documents still have staging configuration/URL as outstanding. No verified staging
  target or deploy procedure available in the supplied workspace. No deployment claimed.

## Remaining external acceptance

- [ ] Nam reviews B6 PR and confirms submission privacy/Q09 wording with Kha.
- [ ] Remote PR/CI evidence (branch currently local; not pushed or merged).
- [ ] Deploy reviewed B6 to the team's confirmed staging target and record URL/commit.
- [ ] Khang connects F6; QA runs owner/peer/outsider cases on staging before closing B6.
- [ ] Only update tracker/Timesheet with actual work/acceptance after user asks to edit it.
