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

- [ ] Add tests exercising real HTTP and PostgreSQL for all four routes, response schemas,
  authorization matrix, validation, membership revocation, pagination and publication.
- [ ] Run `npm run api:test -- --comments`. Expected: assertions fail with 404 for
  valid POST/GET because comments router does not yet exist (not environment errors).
- [ ] Record RED evidence before product code.

## Task 2: B6 implementation (GREEN)

Files: create `src/modules/comments/comment.repository.ts`, `comment.service.ts`,
`comment.routes.ts`; modify `src/app.ts`.
Consumes: Principal, requireClassAccess, transaction, parse, paging, cursorId, page.
Produces: `createCommentRouter(pool: pg.Pool, config: AuthConfig)` mounted at `/api`;
service `list(principal,target,after,limit,scope)` and `create(principal,target,body)`.
Target: `{kind:'assignment'|'submission'; id:string}`. DTO follows spec exactly.

- [ ] Repository resolves target/class/owner, reads target-bound rows ordered by UUID,
  inserts authenticated author, joins display identity only. Parameterize all user values.
- [ ] Service enforces role/target/membership/ownership; transaction covers authorization
  and writes. Router parses strict UUID/query/body and returns 200/201 with no-store.
- [ ] Run `npm run api:test -- --comments`. Expected: all B6 tests pass against real DB.
- [ ] Run `npm run check`. Expected: lint/types/unit tests/build pass; DB tests skipped here.
- [ ] Commit implementation and tests using `[B6]` prefix.

## Task 3: Regression, documentation and self-review

Files: modify `README.md`, `docs/superpowers/README.md`, this plan.

- [ ] Run `npm run api:test`, `npm run db:test`, `npm run api:validate`, `git diff --check`.
  Expected: all selected tests/checks pass, temporary DBs removed.
- [ ] Review full branch diff against spec and Review Focus; fix substantive findings
  using failing regression tests first. No sub-agent dispatch.
- [ ] Document local evidence, integration instructions and remaining Nam/CI/staging gates.
- [ ] Commit docs/evidence; leave branch ready for review without merging develop.

## Evidence / execution ledger

- Baseline `npm test`: 31 passed, 73 DB-dependent skipped. Working tree clean before branch.
- Ruling: work in current checkout on requested new branch; no extra worktree needed.
- Ruling: user explicitly requests spec/plan then implementation; proceed without a separate approval round.
- Pre-flight: Task 1 tests consume Task 2 router through createApp; Task 3 verifies both.
- Pending: RED/GREEN, full regression and final self-review.
