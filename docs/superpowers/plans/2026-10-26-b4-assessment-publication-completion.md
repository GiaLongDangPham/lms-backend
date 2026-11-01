# B4 Assessment and Publication Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close and prove every approved B4 backend grading/publication behavior, then deliver a green merge candidate for `develop` without reimplementing the assessment module.

**Architecture:** Start with a requirement-to-evidence audit of the assessment route/controller/service/repository and PostgreSQL invariants. Add a focused database integration suite for uncovered authorization, privacy, rollback, idempotency, validation, and history cases; change production code only after a test demonstrates a real gap. Keep contract changes in the same completion branch so implementation, OpenAPI, tests, and final verification are merge-consistent.

**Tech Stack:** Node.js 22, Express 5, TypeScript ESM strict mode, PostgreSQL 17, `pg`, Zod, Vitest, Supertest, OpenAPI 3.1.

**Spec:** `docs/superpowers/specs/2026-10-25-b4-assessment-publication-design.md`

## Global Constraints

- Preserve `/api`, camelCase JSON, UUID identifiers, ISO 8601 timestamps, and `{ "error": { "code", "message" } }`.
- Routes/controllers own HTTP parsing and responses; services own authorization and transactions; repositories own parameterized SQL.
- Draft score and feedback must never reach a student-facing response, error, history entry, or notification.
- Publication covers the active enrollment/account cohort atomically and is idempotent under repeat or concurrent calls.
- Published corrections stay Published and append immutable history; automatic zeroes never create fake submissions.
- Do not edit migrations `0001` through `0006`. If a test proves a new database invariant is necessary, stop and obtain approval for a revised plan containing migration `0007`.
- Do not add dependencies, endpoints, unpublish behavior, frontend work, object storage, comments, or notification-listing behavior.
- Write and observe a failing regression test before every production-code change. A new test that passes against the baseline is coverage, not permission to manufacture a code diff.
- Use deterministic PostgreSQL locks/`pg_stat_activity` observation for concurrency tests; do not coordinate correctness with timing sleeps.
- Before database tasks, configure `.env` `DATABASE_URL` for a local PostgreSQL 17 role with `CREATEDB`; repository runners create and remove uniquely named disposable databases.

## Review Focus

- A teacher assignment removed while grade mutation or publication waits on a lock must cause the mutation to return `404` and write nothing.
- A failure after Draft publication or automatic-zero insertion has started must roll back grades, history, assignment publication metadata, and notifications.
- Two simultaneous publication requests must create one result/history/notification per cohort member and preserve the first publication provenance.
- Invalid score, feedback, unknown-field, or stale-version requests must leave the current grade and history byte-for-byte unchanged.
- Every student-facing surface before publication must omit Draft score/feedback, including error bodies and notification rows.

---

### Task 1: Establish the B4 evidence map

**Files:**
- Create: `docs/verification-B4.md`
- Reference: `docs/D1-decisions.md`
- Reference: `docs/D2-review.md`
- Reference: `docs/openapi.json`
- Reference: `src/modules/assessment/assessment.routes.ts`
- Reference: `src/modules/assessment/service.ts`
- Reference: `src/modules/assessment/assessment.repository.ts`
- Reference: `database/migrations/0003_client_rules.sql`
- Reference: `database/migrations/0005_assignment_publication_actor.sql`
- Reference: `tests/client-rules.integration.test.ts`
- Reference: `tests/assignments.integration.test.ts`
- Reference: `tests/enrollment-publication.integration.test.ts`
- Reference: `tests/contract.test.ts`

**Interfaces:**
- Consumes: the ten confirmed behaviors in the B4 design and current `origin/develop` implementation.
- Produces: `docs/verification-B4.md` with columns `Requirement`, `HTTP/schema`, `Service/repository/DB evidence`, `Test evidence`, and `Gap/status`; later tasks update only their own rows and the final command evidence.

- [ ] **Step 1: Write the evidence matrix without changing production code**

Include one row for each confirmed behavior: assigned-teacher authorization; request validation; recorded submission version and submission lock; Draft privacy; blocker rollback; atomic publication and automatic zero; repeat/concurrent idempotency; Published correction; enrollment/account backfill; teacher/student history visibility and immutability.

- [ ] **Step 2: Mark evidence gaps narrowly**

Record these expected missing proofs unless the cited test already demonstrates them: teacher-removal race, mid-transaction rollback, concurrent same-assignment publication, invalid mutation state preservation, and Draft absence from notifications/errors. Distinguish `coverage gap` from `observed implementation defect`.

- [ ] **Step 3: Verify the matrix against repository sources**

Run: `rg -n "grade|publish|Draft|AUTO_ZERO|history|notification" docs/verification-B4.md src/modules/assessment tests database/migrations/000{3,5}_*.sql`

Expected: every matrix row names at least one implementation/constraint source and either an existing test or a gap owned by Tasks 2–5.

- [ ] **Step 4: Commit the audit artifact**

```bash
git add docs/verification-B4.md
git commit -m "docs(verification): map B4 requirements to evidence"
```

### Task 2: Add the focused B4 integration harness and authorization/privacy coverage

**Files:**
- Create: `tests/assessment-publication.integration.test.ts`
- Modify: `scripts/test-api.ts:40-45`
- Modify if RED proves a defect: `src/modules/assessment/service.ts:169-284`
- Modify if RED proves a defect: `src/modules/assessment/assessment.repository.ts:66-103`
- Modify: `docs/verification-B4.md`

**Interfaces:**
- Consumes: `createApp(...)`, `AssessmentService.getSubmissionGrade`, `saveSubmissionGrade`, `publishAssignmentGrades`, `getMyResult`, `getMyResultHistory`, and seeded IDs/password used by existing API integration suites.
- Produces: a `--assessment-publication` selector in `scripts/test-api.ts`; a focused suite using `B1_TEST_DATABASE_URL`; local helpers `login(schoolCode)`, `assignmentFixture()`, `submit(assignmentId, token)`, `saveGrade(submissionId, token, body)`, `publish(assignmentId, token)`, and `waitForBlockedQuery(queryFragment): Promise<void>`.

- [ ] **Step 1: Create the focused suite and register it with the API test runner**

The suite must use a pool of at least eight connections, authenticate both seeded teachers, ensure both are assigned to the fixture class, restore any teacher assignment it removes in `finally`, and let `scripts/test-api.ts` run it both via `--assessment-publication` and in the default full API list.

- [ ] **Step 2: Add the assigned-teacher removal race tests**

Use a guard transaction to lock the target `class_teachers` row `FOR UPDATE`, start the HTTP mutation, confirm its SQL is lock-waiting via `pg_stat_activity`, delete the assignment row from `class_teachers` in the guard transaction, then commit.

```ts
expect(gradeResponse.status).toBe(404);
expect(publishResponse.status).toBe(404);
expect(await gradeCount(assignmentId)).toBe(0);
expect(await publicationState(assignmentId)).toEqual({ resultsPublishedAt: null, resultsPublishedBy: null });
expect(await notificationCount(assignmentId)).toBe(0);
```

Run each operation in its own fixture so the grade and publication cases cannot affect each other.

- [ ] **Step 3: Run the authorization tests and classify the result**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --assessment-publication`

Expected: the new tests either PASS, proving current class/membership locking is sufficient, or FAIL because a request writes after authority is removed. Fixture/login/connectivity failures do not count as RED.

- [ ] **Step 4: If and only if Step 3 exposes a defect, make the smallest service/repository fix**

Keep the public `404` behavior. Mutation paths must recheck `AssessmentRepository.hasClassAccess(db, principal, classId, true)` inside the same transaction that owns the relevant class/assignment lock; do not add controller authorization or direct SQL outside the repository.

- [ ] **Step 5: Add the Draft non-disclosure test**

Create a Draft grade with feedback marker `B4_PRIVATE_DRAFT_MARKER`, then assert:

```ts
expect(mySubmission.body).not.toHaveProperty('grade');
expect(mySubmission.text).not.toContain('B4_PRIVATE_DRAFT_MARKER');
expect(myResult.status).toBe(404);
expect(myResult.text).not.toContain('B4_PRIVATE_DRAFT_MARKER');
expect(myHistory.status).toBe(404);
expect(myHistory.text).not.toContain('B4_PRIVATE_DRAFT_MARKER');
expect(await notificationCount(assignmentId)).toBe(0);
```

Also assert the `GRADE_LOCKS_SUBMISSION` error body contains neither the score nor the marker.

- [ ] **Step 6: Run focused and neighboring privacy/authorization coverage**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --assessment-publication`

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --client-rules`

Expected: both commands PASS; the new focused suite reports no skipped tests.

- [ ] **Step 7: Update evidence rows and commit**

```bash
git add scripts/test-api.ts tests/assessment-publication.integration.test.ts \
  src/modules/assessment/service.ts src/modules/assessment/assessment.repository.ts docs/verification-B4.md
git commit -m "test(assessment): prove B4 authorization and Draft privacy"
```

Omit unchanged production files from `git add`.

### Task 3: Prove publication rollback and concurrent idempotency

**Files:**
- Modify: `tests/assessment-publication.integration.test.ts`
- Modify if RED proves a defect: `src/modules/assessment/service.ts:225-263`
- Modify if RED proves a defect: `src/modules/assessment/assessment.repository.ts:138-177,224-229`
- Modify: `docs/verification-B4.md`

**Interfaces:**
- Consumes: Task 2 fixtures/helpers and `AssessmentService.publishAssignmentGrades(principal, assignmentId): Promise<AssignmentGradePublication>`.
- Produces: proof that one publication transaction owns Draft publication, automatic zeroes, history, metadata, and notification writes; no new public interface.

- [ ] **Step 1: Add a post-write failure rollback test**

Create one submitted/Draft-graded student and one active student without a submission. Install a test-only PostgreSQL trigger on `notifications` that raises SQLSTATE `P0001` only for the fixture assignment, invoke publication, and drop the trigger/function in `finally`.

```ts
expect(response.status).toBe(500);
expect(response.text).not.toContain('P0001');
expect(await gradeRows(assignmentId)).toMatchObject([{ status: 'DRAFT', score: '8.00' }]);
expect(await publishedHistoryCount(assignmentId)).toBe(0);
expect(await publicationState(assignmentId)).toEqual({ resultsPublishedAt: null, resultsPublishedBy: null });
expect(await notificationCount(assignmentId)).toBe(0);
```

The automatic-zero row must not survive the rollback.

- [ ] **Step 2: Run the rollback test and verify RED or existing correctness**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --assessment-publication`

Expected: PASS if the current transaction already covers all writes; otherwise FAIL only on persisted state, not trigger setup.

- [ ] **Step 3: If RED exposes a transaction escape, move the write into the existing transaction**

Keep `transaction(this.repository.db(), async db => ...)` as the single publication boundary. Every repository call in publication must receive that `db`; do not compensate with cleanup queries after failure.

- [ ] **Step 4: Add the simultaneous publication test**

Issue two publish requests for the same assignment with different assigned-teacher tokens in `Promise.all`. Assert both return `200`, exactly one response reports the expected automatic-zero insertion and the other reports zero, both return the same `publishedAt`, and persisted state contains exactly one grade/history/notification per cohort member. Use the response index whose `automaticZeroCount` is one to identify the first publisher and compare it with `results_published_by`.

```ts
expect(responses.map(r => r.status)).toEqual([200, 200]);
expect(responses.map(r => r.body.automaticZeroCount).sort()).toEqual([0, 1]);
expect(new Set(responses.map(r => r.body.publishedAt)).size).toBe(1);
expect(await gradeCount(assignmentId)).toBe(cohortSize);
expect(await historyCount(assignmentId)).toBe(cohortSize);
expect(await notificationCount(assignmentId)).toBe(cohortSize);
```

Also assert `results_published_by` remains the first publisher and a third sequential publish changes none of the three counts.

- [ ] **Step 5: Run publication and enrollment concurrency suites**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --assessment-publication`

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --enrollment-publication`

Expected: both PASS with no duplicate grades, history revisions, or notifications.

- [ ] **Step 6: Update evidence rows and commit**

```bash
git add tests/assessment-publication.integration.test.ts src/modules/assessment/service.ts \
  src/modules/assessment/assessment.repository.ts docs/verification-B4.md
git commit -m "test(assessment): prove atomic idempotent publication"
```

Omit unchanged production files from `git add`.

### Task 4: Prove validation, correction, and immutable-history behavior

**Files:**
- Modify: `tests/assessment-publication.integration.test.ts`
- Modify if RED proves a defect: `src/modules/assessment/assessment.routes.ts:7-17`
- Modify if RED proves a defect: `src/modules/assessment/service.ts:177-223`
- Modify if RED proves a defect: `src/modules/assessment/assessment.repository.ts:106-135,208-211,224-229`
- Modify: `docs/verification-B4.md`

**Interfaces:**
- Consumes: `SaveSubmissionGradeInput`, `CorrectPublishedNoSubmissionGradeInput`, grade/history queries from Tasks 2–3.
- Produces: verified strict mutation behavior for `PUT /submissions/{submissionId}/grade` and `PUT /assignments/{assignmentId}/grades/{studentId}`; no new API fields.

- [ ] **Step 1: Add table-driven invalid mutation tests**

After a valid grade exists, snapshot its grade row and ordered history rows. For each body below, assert `400` and equality with both snapshots:

```ts
[
  { gradedVersionNumber: 1, score: -1 },
  { gradedVersionNumber: 1, score: 10.001 },
  { gradedVersionNumber: 1, score: 11 },
  { gradedVersionNumber: 1, score: 8, feedback: 'x'.repeat(5001) },
  { gradedVersionNumber: 1, score: 8, unexpected: true },
]
```

Repeat the state-preservation assertion for Published automatic-zero correction bodies `{ score: -1 }`, `{ score: 8.001 }`, `{ score: 11 }`, overlong feedback, and an unknown property.

- [ ] **Step 2: Add the stale-version no-write test**

Create a submission with two versions and no grade, then send `{ gradedVersionNumber: 1, score: 8 }`.

```ts
expect(response.status).toBe(409);
expect(response.body.error.code).toBe('STALE_SUBMISSION_VERSION');
expect(await gradeCount(assignmentId)).toBe(0);
expect(await historyCount(assignmentId)).toBe(0);
```

- [ ] **Step 3: Run validation tests and apply only demonstrated fixes**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --assessment-publication`

Expected: PASS. If RED occurs, keep syntactic bounds/strictness in Zod and assignment `maxScore`/recorded-version rules in the service; retain parameterized repository SQL and unchanged public error codes.

- [ ] **Step 4: Add feedback and history transition tests**

Create a Draft with feedback, publish it, update score while omitting feedback, then update with `feedback: null`.

```ts
expect(omitted.body).toMatchObject({ status: 'PUBLISHED', feedback: originalFeedback });
expect(cleared.body).toMatchObject({ status: 'PUBLISHED', feedback: null });
expect(teacherHistory.body.items.map(i => i.status)).toEqual(['DRAFT', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
expect(studentHistory.body.items.map(i => i.status)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
expect(new Set(teacherHistory.body.items.map(i => i.version)).size).toBe(4);
```

Assert notification deduplication keys yield one notification for each Published revision and no notification for the Draft revision.

- [ ] **Step 5: Re-run focused and client-rule suites**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --assessment-publication`

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --client-rules`

Expected: PASS, including existing concurrent correction and SQL history-immutability cases.

- [ ] **Step 6: Update evidence rows and commit**

```bash
git add tests/assessment-publication.integration.test.ts src/modules/assessment/assessment.routes.ts \
  src/modules/assessment/service.ts src/modules/assessment/assessment.repository.ts docs/verification-B4.md
git commit -m "test(assessment): prove grading validation and history"
```

Omit unchanged production files from `git add`.

### Task 5: Close post-publication cohort/backfill evidence

**Files:**
- Modify: `tests/enrollment-publication.integration.test.ts:97-221`
- Modify if RED proves a defect: `src/modules/assessment/service.ts:66-81`
- Modify if RED proves a defect: `src/modules/assessment/assessment.repository.ts:180-195`
- Modify if RED proves a defect: `src/modules/b1/enrollment.service.ts:19-67`
- Modify if RED proves a defect: `src/modules/b1/enrollment.repository.ts:16-53`
- Modify: `docs/verification-B4.md`

**Interfaces:**
- Consumes: `PublishedResultBackfill.backfillPublishedResultsForEnrollment(db, classId, enrollmentId): Promise<number>` and existing `gradeCount`, `historyCount`, `publicationNotificationCount` helpers.
- Produces: complete evidence for enrollment creation/reactivation and account reactivation before, during, and after publication; no new public interface.

- [ ] **Step 1: Audit existing backfill tests against the B4 matrix**

Confirm they prove: empty-cohort publication followed by enrollment; existing grade/history preservation; missing result with historical submission; inactive account exclusion and later backfill; concurrent account reactivation/publication; concurrent enrollment/publication.

- [ ] **Step 2: Add only the missing persisted-state assertions**

For each concurrency test, additionally assert the single row is `PUBLISHED`, source `AUTO_ZERO_NO_SUBMISSION`, has null submission/version, retains the assignment's original publisher/timestamp, and locks a subsequent submission attempt with `GRADE_LOCKS_SUBMISSION`.

- [ ] **Step 3: Run the backfill suite and classify failures**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test -- --enrollment-publication`

Expected: PASS. If a state assertion fails, preserve the class-first lock order and make the smallest service/repository change inside the caller's existing transaction.

- [ ] **Step 4: Update evidence rows and commit**

```bash
git add tests/enrollment-publication.integration.test.ts src/modules/assessment/service.ts \
  src/modules/assessment/assessment.repository.ts src/modules/b1/enrollment.service.ts \
  src/modules/b1/enrollment.repository.ts docs/verification-B4.md
git commit -m "test(enrollments): complete B4 publication backfill evidence"
```

Omit unchanged production files from `git add`.

### Task 6: Reconcile the B4 OpenAPI contract

**Files:**
- Modify: `tests/contract.test.ts:47-58`
- Modify only when a mismatch is demonstrated: `docs/openapi.json`
- Modify: `docs/verification-B4.md`

**Interfaces:**
- Consumes: observed Task 2–5 request/error/success bodies and schemas `SaveDraftGradeRequest`, `CorrectUnsubmittedGradeRequest`, `PublishedGrade`, `GradeHistory`, and `AssignmentPublicationBlocked`.
- Produces: contract tests that reject runtime-invalid requests and prevent Draft-only fields from entering student schemas.

- [ ] **Step 1: Extend `matches runtime validation for B4 grade mutations`**

Assert both mutation schemas reject negative scores, more than two decimals, overlong feedback, and unknown fields; assert `SaveDraftGradeRequest` requires a positive integer `gradedVersionNumber`. Do not encode assignment-specific `maxScore` in OpenAPI.

- [ ] **Step 2: Add student privacy and publication-blocker schema assertions**

Compile `PublishedGrade`, `GradeHistory`, and `AssignmentPublicationBlocked`; verify valid Task 2–4 response fixtures pass, `PublishedGrade` exposes no `gradedBy`/`gradedAt`, student history has only the public history-entry fields, and the blocker contains submission/student summaries without grade score/feedback.

- [ ] **Step 3: Run contract tests and observe RED before editing the spec**

Run: `node node_modules/vitest/vitest.mjs run tests/contract.test.ts`

Expected: PASS if the merged PR #9 contract already matches runtime; otherwise FAIL on the exact missing/incorrect schema constraint.

- [ ] **Step 4: If RED, update only the mismatched OpenAPI schema**

Keep all 48 operations and existing paths/roles. Do not broaden B4 behavior or copy unrelated changes from another branch.

- [ ] **Step 5: Validate the contract and mock**

Run: `node node_modules/vitest/vitest.mjs run tests/contract.test.ts`

Run: `node scripts/mock-api.mjs --validate`

Run: `node scripts/mock-api.mjs --self-test`

Expected: all PASS; operation count remains 48.

- [ ] **Step 6: Update evidence rows and commit**

```bash
git add tests/contract.test.ts docs/openapi.json docs/verification-B4.md
git commit -m "test(contract): lock B4 grading and privacy schemas"
```

Omit `docs/openapi.json` if unchanged.

### Task 7: Run final verification and prepare the merge candidate

**Files:**
- Modify: `docs/verification-B4.md`
- Review: every file changed since `origin/develop`

**Interfaces:**
- Consumes: completed Tasks 1–6 and repository scripts `check`, `db:test`, `api:test`, and `api:validate`.
- Produces: a reviewable branch with exact local/CI evidence; merge to `develop` remains an explicitly authorized repository action.

- [ ] **Step 1: Review the complete branch diff**

Run: `git diff --check origin/develop...HEAD`

Run: `git diff --stat origin/develop...HEAD`

Run: `git diff origin/develop...HEAD -- src/modules database/migrations docs/openapi.json tests scripts`

Expected: no whitespace errors, unrelated cleanup, secret/config additions, edits to migrations `0001`–`0006`, or behavior beyond B4.

- [ ] **Step 2: Run static/unit/build verification**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run check`

Expected: ESLint, TypeScript, non-database Vitest suites, and build all PASS.

- [ ] **Step 3: Run migration and full API integration verification on PostgreSQL 17**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run db:test`

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:test`

Expected: every migration/database check and every B1/B3/B4 integration file, including `assessment-publication.integration.test.ts`, PASS with no skipped database suite.

- [ ] **Step 4: Run final OpenAPI verification**

Run: `env COREPACK_HOME=/tmp/b4-corepack corepack npm@10.9.4 run api:validate`

Run: `node scripts/mock-api.mjs --self-test`

Expected: both PASS.

- [ ] **Step 5: Record exact evidence and unresolved external dependencies**

Update `docs/verification-B4.md` with date, commit SHA, commands, observed counts/results, PostgreSQL version, and any skipped check. State that FE/staging acceptance is pending frontend readiness and does not block the backend merge. A skipped database suite or unavailable/red CI must remain marked `BLOCKED`, not `PASS`.

- [ ] **Step 6: Commit the final verification record**

```bash
git add docs/verification-B4.md
git commit -m "docs(verification): record B4 completion checks"
```

- [ ] **Step 7: Push and open/update the pull request**

First restore GitHub authentication if `gh auth status` is not green. Push `feature/B4-assessment-publication-completion`, open a PR into `develop`, and summarize the evidence matrix, demonstrated fixes, migrations (normally none), and deferred FE/staging acceptance.

Expected: the PR diff contains only B4 completion work and all required checks start.

- [ ] **Step 8: Require green CI and review before merge**

Run: `gh pr checks --watch`

Expected: every required GitHub Actions check PASS. Investigate failures; do not weaken checks or merge with red/unknown CI.

- [ ] **Step 9: Merge only after explicit authorization and verify `develop`**

Merge using the repository's normal PR method, then verify the PR reports merged and the merge commit is reachable from `origin/develop`.

Expected: B4 backend satisfies its Definition of Done. FE/staging acceptance remains a separately tracked follow-up.
