# B4 Assessment and Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and verify the B4 manual grading and assignment-wide publication backend on its own feature branch.

**Architecture:** Keep the merged route/controller/service/repository assessment module. Audit observable behavior against the approved Client Log rules, add failing integration or contract tests for demonstrated gaps, and make the smallest fixes in the owning layer. Keep OpenAPI edits on the separate `docs/api-specification` branch.

**Tech Stack:** Node.js 22, Express 5, TypeScript ESM, PostgreSQL 17, `pg`, Zod, Vitest, Supertest, OpenAPI 3.1.

**Spec:** `docs/superpowers/specs/2026-10-25-b4-assessment-publication-design.md`

## Global Constraints

- Preserve `/api`, camelCase JSON, UUIDs, ISO 8601 timestamps, and `{ "error": { "code", "message" } }`.
- Never expose Draft score or feedback to students, public errors, or notifications.
- Keep publication atomic and grade history append-only.
- Do not add unpublish, automatic code grading, frontend behavior, or unrelated refactors.
- Write and observe a failing regression test before each production-code change.
- Put API-contract edits on `docs/api-specification`, not `feature/B4-assessment-publication`.

## Review Focus

- A teacher losing class assignment concurrently with grading or publication must not retain mutation authority.
- A publication blocker must roll back every grade, history, assignment-publication, and notification write.
- Repeated or concurrent publication must not duplicate grades, history revisions, or notifications.
- Students must receive no Draft values through submission, result, history, error, or notification surfaces.
- Scores with excessive precision, negative values, or values above `maxScore` must fail without changing current grade/history.

---

### Task 1: Establish the B4 baseline and coverage map

**Files:**
- Modify if needed: `tests/client-rules.integration.test.ts`
- Modify if needed: `tests/assignments.integration.test.ts`
- Modify if needed: `tests/enrollment-publication.integration.test.ts`
- Reference: `src/modules/assessment/assessment.routes.ts`
- Reference: `src/modules/assessment/service.ts`
- Reference: `src/modules/assessment/assessment.repository.ts`

**Interfaces:**
- Consumes: existing assessment HTTP endpoints and `B1_TEST_DATABASE_URL` integration-test setup.
- Produces: an explicit test-to-requirement map with no uncovered approved B4 behavior.

- [ ] **Step 1: Map each approved B4 rule to its current route, service rule, repository transaction, and integration test**

Record gaps in the plan working notes; do not change production code during this step.

- [ ] **Step 2: Add one failing integration assertion for every uncovered rule or review-focus condition**

Use existing helpers and assert public status/body plus persisted database state where atomicity or history is involved.

- [ ] **Step 3: Run each new test and verify RED**

Run: `B1_TEST_DATABASE_URL=<disposable-url> node node_modules/vitest/vitest.mjs run <test-file> -t '<test name>'`

Expected: FAIL on the missing behavior, not fixture setup or connectivity.

- [ ] **Step 4: Commit coverage-only RED tests when a real gap exists**

```bash
git add tests/client-rules.integration.test.ts tests/assignments.integration.test.ts tests/enrollment-publication.integration.test.ts
git commit -m "test(assessment): expose B4 behavior gaps"
```

If the approved behavior is already fully covered, record that outcome and proceed without a no-op commit.

### Task 2: Close grading, authorization, and privacy gaps

**Files:**
- Modify if required: `src/modules/assessment/assessment.routes.ts`
- Modify if required: `src/modules/assessment/service.ts`
- Modify if required: `src/modules/assessment/assessment.repository.ts`
- Test: the Task 1 integration file containing the failing grading/privacy case

**Interfaces:**
- Consumes: `AssessmentService.getSubmissionGrade`, `saveSubmissionGrade`, `getMyResult`, and `getMyResultHistory`.
- Produces: assigned-teacher-only grading with two-decimal/max-score validation and student-safe Draft handling.

- [ ] **Step 1: Implement the minimum route, service, or repository change that makes the grading/privacy RED test pass**

Preserve `404` resource hiding for foreign teachers and `403` role rejection for admins/students.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run the exact Task 1 command for the grading/privacy case.

Expected: PASS with no Draft score or feedback in student-visible bodies.

- [ ] **Step 3: Run the assessment-related integration files**

Run: `B1_TEST_DATABASE_URL=<disposable-url> node node_modules/vitest/vitest.mjs run tests/client-rules.integration.test.ts tests/assignments.integration.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit the focused fix**

```bash
git add src/modules/assessment tests
git commit -m "fix(assessment): enforce B4 grading boundaries"
```

Skip this task and commit when Task 1 proves no grading/privacy gap.

### Task 3: Close publication, correction, and history gaps

**Files:**
- Modify if required: `src/modules/assessment/service.ts`
- Modify if required: `src/modules/assessment/assessment.repository.ts`
- Create if required: `database/migrations/0006_<focused_invariant>.sql`
- Modify if a migration is added: `scripts/test-database.ts`
- Test: the Task 1 integration file containing the failing publication/history case

**Interfaces:**
- Consumes: `publishAssignmentGrades`, `correctPublishedNoSubmissionGrade`, and enrollment publication backfill.
- Produces: atomic, idempotent publication; Published corrections; immutable complete history; deduplicated notifications.

- [ ] **Step 1: Implement the minimum service/repository/database change that makes the publication/history RED test pass**

Use the existing transaction and class-first lock order. Add migration `0006` only if PostgreSQL must enforce a new invariant; never edit migrations `0001` through `0005`.

- [ ] **Step 2: Run the focused test and verify GREEN**

Expected: the public response and persisted grades, history, assignment publication metadata, and notifications all satisfy the assertion.

- [ ] **Step 3: Run all assessment and enrollment-publication integration coverage**

Run: `B1_TEST_DATABASE_URL=<disposable-url> node node_modules/vitest/vitest.mjs run tests/client-rules.integration.test.ts tests/assignments.integration.test.ts tests/enrollment-publication.integration.test.ts`

Expected: PASS.

- [ ] **Step 4: Run database verification if a migration was added**

Run: `B1_TEST_DATABASE_URL=<disposable-url> node --import tsx scripts/test-database.ts`

Expected: all migrations and invariant checks pass, including legacy upgrade preservation.

- [ ] **Step 5: Commit the focused fix**

```bash
git add src/modules/assessment database/migrations scripts/test-database.ts tests
git commit -m "fix(assessment): complete atomic grade publication"
```

Skip this task and commit when Task 1 proves no publication/history gap.

### Task 4: Align the API specification on its dedicated branch

**Files:**
- Modify on `docs/api-specification`: `docs/openapi.json`
- Modify on `docs/api-specification`: `tests/contract.test.ts`

**Interfaces:**
- Consumes: observed B4 request/response validation and error shapes from Tasks 1–3.
- Produces: OpenAPI schemas that exactly describe implemented B4 behavior without changing the public API surface.

- [ ] **Step 1: Create an isolated worktree for `docs/api-specification` and re-read its current OpenAPI contract**

Do not copy the B4 implementation branch's entire `docs/openapi.json`; apply only evidenced contract corrections.

- [ ] **Step 2: Add a failing contract test for each mismatch**

At minimum verify grade request schemas reject unknown fields, cap feedback at 5000 characters, and constrain scores to increments of `0.01` wherever the runtime does.

- [ ] **Step 3: Run the focused contract test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run tests/contract.test.ts`

Expected: FAIL because the existing schema omits the runtime constraint.

- [ ] **Step 4: Update `docs/openapi.json` minimally and verify GREEN**

Run: `node node_modules/vitest/vitest.mjs run tests/contract.test.ts`

Expected: PASS and SwaggerParser validation succeeds.

- [ ] **Step 5: Commit the specification correction on `docs/api-specification`**

```bash
git add docs/openapi.json tests/contract.test.ts
git commit -m "docs(api): align B4 grading validation"
```

### Task 5: Final verification and handoff

**Files:**
- Review: all files changed by Tasks 1–4

**Interfaces:**
- Consumes: completed B4 implementation and API-specification commits.
- Produces: verified branch status and an evidence-based handoff.

- [ ] **Step 1: Review both branch diffs for scope, security, contract compatibility, and unrelated changes**

Run: `git diff --check` and inspect `git diff origin/develop...HEAD` in each worktree.

- [ ] **Step 2: Run static and unit verification on B4**

Run: `node node_modules/eslint/bin/eslint.js .`

Run: `node node_modules/typescript/bin/tsc --noEmit`

Run: `node node_modules/vitest/vitest.mjs run`

Run: `node node_modules/typescript/bin/tsc -p tsconfig.build.json`

Expected: all pass. If sandbox networking blocks Supertest, rerun with the required permission and report the observed result.

- [ ] **Step 3: Run database/API integration verification when PostgreSQL is available**

Run the repository's database and API test commands against a disposable database; report exact skipped checks if no database is available.

- [ ] **Step 4: Report branch names, commits, behavior changes, checks, and any remaining product decision**

Do not merge, push, or modify the tracker unless separately requested.
