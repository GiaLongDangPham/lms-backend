# B3 Client Log Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and harden the assignment, submission, grading, publication, and post-publication enrollment behavior approved in the Client Log without expanding into full B2, B5, or B6.

**Architecture:** Keep the existing assignment module, replace the mixed assessment router with route/controller/service/repository layers, and inject the assessment result-backfill capability into enrollment mutations. Serialize publication and enrollment/reactivation on the class row, then use assignment/enrollment/grade uniqueness as the final concurrency defense.

**Tech Stack:** Node.js 22, Express 5, TypeScript ESM with strict checking, PostgreSQL 17 with `pg`, Zod 4, Vitest 5, Supertest 7, OpenAPI 3.1 JSON.

**Spec:** `docs/superpowers/specs/2026-10-24-b3-client-log-completion-design.md`

## Global Constraints

- Work only on `feature/B3-client-log-completion`; do not commit or push directly to `develop`.
- Preserve `/api`, camelCase JSON, UUID identifiers, ISO 8601 timestamps, cursor pagination, and `{ "error": { "code", "message" } }` errors.
- Keep HTTP and validation in routes/controllers, business rules and transactions in services, and parameterized SQL in repositories.
- Add migration `0005_*`; never edit applied migrations `0001` through `0004`.
- Never expose Draft scores or feedback to students, notifications, or public errors.
- Scores and maximum scores have at most two decimal places; do not add submission `note`.
- B2 object upload/download and file-content inspection, B5 notification APIs/scheduling, B6 comments, unpublish, and frontend work remain out of scope.
- Existing endpoint paths and response shapes stay compatible; post-publication enrollment adds side effects, not new response fields.
- Preserve unrelated files and do not update the generated ERD SVG.

## Review Focus

- A reactivated enrollment with an old ungraded submission must receive one Published zero, keep the old submission intact, and remain unable to submit again (Task 3).
- An assignment published with no active students must retain its original teacher publisher so a later enrollment can receive a correctly attributed zero (Tasks 1 and 3).
- Concurrent publication and enrollment/reactivation must end with exactly one grade and one history revision for the active enrollment (Task 3).
- Any attachment or size failure must roll back the whole submission version and leave every referenced file unattached (Task 4).
- Student and foreign-user reads must not reveal Draft score, feedback, grade history, or resource existence (Tasks 2 and 4).

---

### Task 1: Persist the Assignment-Wide Publisher

**Files:**
- Create: `database/migrations/0005_assignment_publication_actor.sql`
- Modify: `scripts/test-database.ts`
- Modify: `tests/client-rules.integration.test.ts`
- Modify: `src/modules/assignments/assignment.repository.ts`
- Modify: `src/modules/assessment/router.ts`

**Interfaces:**
- Produces: `assignments.results_published_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT`.
- Produces: `AssignmentRow.results_published_by: string | null`.
- Enforces: `results_published_at` and `results_published_by` are both null before publication and both non-null afterward; neither can change after first publication.
- Backfill rule: choose the actor from the earliest Published `grade_history` snapshot for that assignment, fall back to an existing Published grade's `published_by`, then to `assignments.created_by` when the historical publisher is unknowable.

- [ ] **Step 1: Add failing migration assertions**

Update the expected migration list/count in `scripts/test-database.ts`, then add checks that a published assignment has both publication fields, that an unpublished assignment has neither, and that SQL cannot clear or replace either field after publication. In the legacy-upgrade test, first apply `0003`/`0004` from its temporary migration directory, mark the legacy assignment published, then add/apply `0005` and verify publisher backfill before exercising the API:

```ts
expect(row.results_published_by).toBe(id.teacher1);
await expect(pool.query(
  'UPDATE assignments SET results_published_by=$1 WHERE id=$2',
  [id.teacher2, assignmentId],
)).rejects.toMatchObject({ code: '23514' });
```

- [ ] **Step 2: Run the database checks and observe the expected failure**

Run: `corepack npm run db:test`

Expected: FAIL because migration `0005_assignment_publication_actor.sql` and the new column do not exist.

- [ ] **Step 3: Implement the additive migration**

Add the nullable FK column, backfill already-published assignments deterministically, add the paired-nullability check, and replace `check_assignment_change()` so publication timestamp and actor become immutable together. Do not modify migrations `0001`–`0004`.

- [ ] **Step 4: Add the new field to the assignment database row type**

Extend `AssignmentRow` only; do not expose the field in the public assignment DTO.

- [ ] **Step 5: Keep the pre-refactor publisher write compatible**

Update the existing publish transaction in `src/modules/assessment/router.ts` to set `results_published_at` and `results_published_by` together with `COALESCE`, using the publishing teacher only on first publication. This temporary edit is moved into the layered repository/service in Task 2.

- [ ] **Step 6: Run targeted migration and upgrade coverage**

Run: `corepack npm run db:test && corepack npm run api:test -- --client-rules`

Expected: database checks pass; the legacy-upgrade test applies migrations `0003`, `0004`, and `0005` without losing grade/history data.

- [ ] **Step 7: Commit**

```bash
git add database/migrations/0005_assignment_publication_actor.sql scripts/test-database.ts tests/client-rules.integration.test.ts src/modules/assignments/assignment.repository.ts src/modules/assessment/router.ts
git commit -m "feat(db): record assignment publication actor"
```

### Task 2: Layer the Assessment Module Without Changing Its API

**Files:**
- Create: `src/modules/assessment/assessment.repository.ts`
- Create: `src/modules/assessment/assessment.controller.ts`
- Create: `src/modules/assessment/assessment.routes.ts`
- Modify: `src/modules/assessment/service.ts`
- Delete: `src/modules/assessment/router.ts`
- Modify: `src/app.ts`
- Modify: `tests/client-rules.integration.test.ts`

**Interfaces:**
- Produces: `AssessmentRepository`, constructed with `pg.Pool`, with `db(): pg.Pool` and parameterized methods for assignment/submission access, grades, grade history, users, publication cohort, and notifications.
- Produces: `AssessmentService` methods `getSubmissionGrade`, `saveSubmissionGrade`, `correctPublishedNoSubmissionGrade`, `publishAssignmentGrades`, `getMyResult`, `getMyResultHistory`, and `getStudentResultHistory`.
- Produces: `AssessmentController` methods with the same names, accepting `Response`, `Principal`, parsed IDs, and parsed body objects.
- Produces: `createAssessmentRouter(pool: pg.Pool, config: AuthConfig, service: AssessmentService)` with all seven existing assessment routes unchanged.
- Preserves: `Grade`, `PublishedGrade`, history, publish result, status codes, error codes, and `Cache-Control: no-store` response shapes.

- [ ] **Step 1: Add characterization coverage for access and privacy**

Add tests proving assigned teachers can read/write a grade, a foreign teacher receives deliberate `404`, admin/student grade-management calls receive `403` or ownership-safe `404`, and Draft values never appear in student submission/result/history responses:

```ts
expect(studentSubmission.body).not.toHaveProperty('grade');
expect(studentResult.status).toBe(404);
expect(studentResult.text).not.toContain('Feedback private');
expect(foreignTeacher.status).toBe(404);
```

- [ ] **Step 2: Run the characterization tests before refactoring**

Run: `corepack npm run api:test -- --client-rules`

Expected: PASS, establishing the behavior baseline. If a new privacy assertion fails, fix that leak within this task before continuing.

- [ ] **Step 3: Move all assessment SQL into `AssessmentRepository`**

Define focused row types (`AssessmentAssignmentRow`, `SubmissionGradeTargetRow`, `GradeRow`, `GradeHistoryRow`, `EnrollmentTargetRow`) in the repository. Every query takes a `Db = pg.Pool | pg.PoolClient`; no route/controller may call `query()`.

- [ ] **Step 4: Move transactions and business rules into `AssessmentService`**

Keep role, assigned-teacher, ownership, maximum-score, current-version, publication blocker, automatic-zero, history-visibility, and notification-deduplication rules in the service. Acquire class/membership locks before assignment/grade locks and keep publication all-or-nothing.

- [ ] **Step 5: Add the controller and route composition**

Keep Zod schemas and URL parsing in `assessment.routes.ts`; let the controller choose `200` and serialize service results. Construct one `AssessmentRepository`/`AssessmentService` in `createApp`, inject the service into the assessment router, and remove imports of the old mixed router.

- [ ] **Step 6: Run assessment regression checks**

Run: `corepack npm run typecheck && corepack npm run api:test -- --client-rules`

Expected: PASS with unchanged public JSON and privacy behavior.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/modules/assessment tests/client-rules.integration.test.ts
git commit -m "refactor(assessment): separate HTTP business and SQL layers"
```

### Task 3: Complete Published Results During Enrollment and Reactivation

**Files:**
- Create: `src/modules/b1/enrollment.repository.ts`
- Create: `src/modules/b1/enrollment.service.ts`
- Modify: `src/modules/b1/router.ts`
- Modify: `src/modules/assessment/assessment.repository.ts`
- Modify: `src/modules/assessment/service.ts`
- Modify: `src/app.ts`
- Create: `tests/enrollment-publication.integration.test.ts`
- Modify: `scripts/test-api.ts`

**Interfaces:**
- Produces: `PublishedResultBackfill` with `backfillPublishedResultsForEnrollment(db: pg.PoolClient, classId: string, enrollmentId: string): Promise<number>`.
- Produces: `EnrollmentRepository` methods `db`, `lockClass`, `findActiveStudent`, `upsertEnrollment`, `findEnrollment`, and `setEnrollmentActive`.
- Produces: `EnrollmentService.enroll(principal, classId, studentId): Promise<EnrollmentRow>` and `EnrollmentService.setActive(principal, classId, enrollmentId, isActive): Promise<EnrollmentRow>`.
- Changes: `createB1Router(pool: pg.Pool, config: AuthConfig, enrollmentService: EnrollmentService, loginLimit?: number)`; its POST/PATCH enrollment routes keep their existing request and response contracts.
- Backfill result: one `PUBLISHED` grade per published assignment missing a result, with score `0.00`, source `AUTO_ZERO_NO_SUBMISSION`, null submission/version, and both actors set to `assignments.results_published_by`.

- [ ] **Step 1: Add a selectable PostgreSQL integration suite**

Teach `scripts/test-api.ts` the `--enrollment-publication` selector and create the new suite with isolated helpers for creating a student/class/assignment, assigning a teacher, logging in, publishing, and querying grade/history/notification counts.

- [ ] **Step 2: Write failing post-publication enrollment tests**

Cover these named cases and assertions:

```ts
it('backfills a correctly attributed zero when enrollment follows an empty-cohort publication', ...)
it('reactivation preserves an existing grade and history without another notification', ...)
it('reactivation converts a missing result with a historical ungraded submission into one locked zero', ...)
it('serializes concurrent publication and enrollment into one grade and one history revision', ...)

expect(grade).toMatchObject({
  score: '0.00', status: 'PUBLISHED', source: 'AUTO_ZERO_NO_SUBMISSION',
  submission_id: null, graded_version_number: null,
  graded_by: teacherId, published_by: teacherId,
});
expect(await gradeCount()).toBe(1);
expect(await historyCount()).toBe(1);
expect((await submitAfterEnrollment()).body.error.code).toBe('GRADE_LOCKS_SUBMISSION');
```

- [ ] **Step 3: Run the new suite and observe the expected failures**

Run: `corepack npm run api:test -- --enrollment-publication`

Expected: FAIL because enrollment/reactivation does not yet backfill published assignments.

- [ ] **Step 4: Implement class-first publication locking and publisher persistence**

In `AssessmentService.publishAssignmentGrades`, read the assignment only to resolve its class, lock the class plus assigned-teacher membership, then lock/re-read the assignment. Retain the Task 1 behavior that sets `results_published_at` and `results_published_by` together on first publication and preserves both on retries.

- [ ] **Step 5: Implement idempotent result backfill in assessment**

`backfillPublishedResultsForEnrollment` selects published assignments for the locked class, inserts missing automatic zeroes with `ON CONFLICT (assignment_id, enrollment_id) DO NOTHING`, relies on the grade-history trigger for one snapshot, and inserts the existing deduplicated `GRADE_PUBLISHED` notification only for rows actually inserted. It must not create or modify submissions.

- [ ] **Step 6: Route enrollment mutations through `EnrollmentService`**

For both new enrollment and reactivation, lock the class row first, validate/lock the active student, create or reactivate the stable enrollment ID, then call the injected `PublishedResultBackfill` in the same transaction. Deactivation skips backfill. An already-active POST remains `409 CONFLICT`; an already-active PATCH remains compatible and idempotent.

- [ ] **Step 7: Run enrollment, assessment, and B1 regression suites**

Run: `corepack npm run api:test -- --enrollment-publication && corepack npm run api:test`

Expected: all suites pass; concurrent operations leave exactly one result/history entry, existing histories are byte-for-byte unchanged, and public enrollment responses still validate against OpenAPI.

- [ ] **Step 8: Commit**

```bash
git add src/app.ts src/modules/b1 src/modules/assessment scripts/test-api.ts tests/enrollment-publication.integration.test.ts
git commit -m "feat(enrollments): backfill published assignment results"
```

### Task 4: Harden Assignment and Submission Boundaries

**Files:**
- Modify: `src/modules/assignments/assignment.repository.ts`
- Modify: `src/modules/assignments/assignment.service.ts`
- Create: `tests/assignments.integration.test.ts`
- Create: `tests/assignment.service.test.ts`
- Modify: `scripts/test-api.ts`

**Interfaces:**
- Produces: `isAfterDeadline(submittedAt: Date, deadlineAt: Date): boolean`, returning `false` when timestamps are equal.
- Preserves: first submission after deadline is accepted and marked Late; later versions require commit time at or before the current deadline; deadline extension reopens only ungraded work.
- Preserves: `submit(principal, assignmentId, fileIds)` returns only after the transaction commits and leaves no version/file transition after rollback.
- Changes: submission DTO locking checks `grade || assignment.results_published_at || repeatDeadlinePassed`, with `GRADED` taking precedence over `DEADLINE_PASSED`.

- [ ] **Step 1: Add deterministic deadline unit coverage**

```ts
expect(isAfterDeadline(at, at)).toBe(false);
expect(isAfterDeadline(new Date(at.getTime() + 1), at)).toBe(true);
expect(isAfterDeadline(new Date(at.getTime() - 1), at)).toBe(false);
```

- [ ] **Step 2: Add failing integration coverage for the Client Log boundaries**

Teach `scripts/test-api.ts` the `--assignments` selector, then cover:

- assigned versus foreign teacher access and ownership-safe student `404`;
- invalid and cross-list cursors;
- duplicate, missing, foreign-owned, already-attached, 11-file, and over-100-MiB file sets;
- rollback leaving zero new versions and all candidate files `PENDING`;
- two concurrent first submissions yielding one submission with unique versions `[1, 2]`;
- immutable deadline snapshots and `isLate` after moving the assignment deadline;
- Draft, Published, and assignment-wide publication locks taking precedence over deadline state.

The publication-lock case must include an inactive student's historical ungraded submission followed by publication/reactivation; `GET /submissions/{id}` must change from the incorrect `canSubmit: true` to `canSubmit: false` with `lockedReason: "GRADED"`.

Run: `corepack npm test -- tests/assignment.service.test.ts && corepack npm run api:test -- --assignments`

Expected: FAIL on the historical-submission publication-lock DTO; the remaining assertions characterize behavior and may already pass.

- [ ] **Step 3: Normalize class-before-assignment lock ordering**

For update and submit, first read the assignment to resolve `class_id`, acquire current class/membership protection through `requireClassAccess(..., true)`, then lock and re-read the assignment and verify it still belongs to that class. Keep enrollment, submission, grade, and file locks after those two locks.

- [ ] **Step 4: Make submission-state decisions explicit**

Use `isAfterDeadline` for `isLate` and repeat-deadline decisions. In DTO creation include `results_published_at` in the permanent grade/publication lock, while keeping Draft/Published values private from student responses.

- [ ] **Step 5: Preserve atomic attachment behavior**

Keep file ownership/lifecycle checks and total-size calculation inside the transaction, insert version/file links only after all checks, and rely on rollback plus existing deferred database constraints for final enforcement. Do not add MIME/extension/content inspection in this branch.

- [ ] **Step 6: Run assignment and full API regression suites**

Run: `corepack npm test -- tests/assignment.service.test.ts && corepack npm run api:test -- --assignments && corepack npm run api:test`

Expected: all assignment cases pass; no Draft field leaks; existing B1/assessment behavior remains green.

- [ ] **Step 7: Commit**

```bash
git add src/modules/assignments scripts/test-api.ts tests/assignments.integration.test.ts tests/assignment.service.test.ts
git commit -m "fix(assignments): harden submission boundaries"
```

### Task 5: Synchronize the Contract and Durable Documentation

**Files:**
- Modify: `docs/openapi.json`
- Modify: `tests/contract.test.ts`
- Modify: `README.md`
- Modify: `docs/D1-decisions.md`
- Modify: `docs/database-design.md`
- Modify: `docs/database-erd.md`
- Modify: `database/diagrams/lms-erd.mmd`
- Modify: `database/diagrams/lms-erd.puml`

**Interfaces:**
- Documents: POST enrollment and PATCH reactivation atomically add missing Published zeroes for assignments already published.
- Documents: existing grade/history is preserved, no submission is fabricated, and submission access stays locked.
- Documents: assignment-wide publisher provenance in the database only; no public schema field is added.
- Preserves: all existing operation IDs, paths, schemas, and response status codes.

- [ ] **Step 1: Add contract assertions before changing the spec**

In `tests/contract.test.ts`, assert that `enrollStudent`, `updateEnrollment`, and `publishAssignmentGrades` descriptions state the post-publication zero behavior and that no submission note or unpublish operation is introduced.

- [ ] **Step 2: Run the contract test and observe the expected failure**

Run: `corepack npm test -- tests/contract.test.ts`

Expected: FAIL because enrollment descriptions do not yet describe the approved side effect.

- [ ] **Step 3: Update OpenAPI and handoff text**

Update only descriptions/examples needed for the selected rule. Refresh README implementation status, add the approved 24/10/2026 decision to the existing D1 decision source, and document `assignments.results_published_by` plus its paired-nullability/immutability rule.

- [ ] **Step 4: Update ERD source files only**

Add `results_published_by` and the user relationship to the Mermaid and PlantUML sources. Update the textual ERD note; do not regenerate or edit `database/diagrams/lms-erd.svg`.

- [ ] **Step 5: Validate the contract and mock**

Run: `corepack npm test -- tests/contract.test.ts && corepack npm run api:validate && node scripts/mock-api.mjs --self-test`

Expected: all commands pass and the OpenAPI operation count/schema compatibility remain intact.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/openapi.json docs/D1-decisions.md docs/database-design.md docs/database-erd.md database/diagrams/lms-erd.mmd database/diagrams/lms-erd.puml tests/contract.test.ts
git commit -m "docs(api): define post-publication enrollment results"
```

### Task 6: Whole-Branch Verification and Review

**Files:**
- Review: all changes from `develop...feature/B3-client-log-completion`
- Update only if evidence requires it: implementation/tests/docs already listed above

**Interfaces:**
- Produces: a clean feature branch ready to push and open as a PR targeting `develop`.
- Does not produce: a merge, direct `develop` commit, B2 upload implementation, B5 notification API, B6 comments, or unpublish.

- [ ] **Step 1: Run fast static and unit checks**

Run: `corepack npm run check`

Expected: ESLint, strict TypeScript, Vitest, and production build all pass.

- [ ] **Step 2: Run contract checks**

Run: `corepack npm run api:validate && node scripts/mock-api.mjs --self-test`

Expected: both pass.

- [ ] **Step 3: Run PostgreSQL 17 checks**

Run: `corepack npm run db:test && corepack npm run api:test`

Expected: migrations/constraints/upgrade checks and every API integration suite pass against disposable databases.

- [ ] **Step 4: Review the actual diff**

Run: `git diff --check develop...HEAD && git status --short --branch && git log --oneline develop..HEAD`

Inspect authorization, class-first lock order, transaction rollback, idempotency, Draft privacy, immutable history, migration safety, public-contract compatibility, and absence of out-of-scope code.

- [ ] **Step 5: Record verification evidence**

If implementation fixes were required after the last feature/docs commit, commit only those focused files with an appropriate Conventional Commit message, rerun the affected targeted test, then rerun the failed whole-branch command. Leave the worktree clean.

- [ ] **Step 6: Prepare delivery without merging**

Summarize commits and observed checks, push only `feature/B3-client-log-completion`, and open a pull request targeting `develop` only after the user authorizes those external actions. Do not merge until explicitly requested.
