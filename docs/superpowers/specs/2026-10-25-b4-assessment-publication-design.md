# B4 Assessment and Publication Completion Design

## Intent and definition of done

Complete B4 as an independently reviewable backend work item. The grading and
publication core already exists on `develop` because it was delivered with the B3
client-log work; B4 therefore closes the evidence and behavior gaps instead of
reimplementing that module.

B4 backend is done when the focused completion branch is merged into `develop`,
all required local checks and PostgreSQL integration suites pass, and the pull
request CI is green. Frontend and staging acceptance happen after the frontend is
ready and do not block backend completion.

## Goals

- Produce a traceable coverage map from each approved B4 rule to its route,
  service rule, repository/transaction behavior, database invariant, and test.
- Verify manual grading, score and feedback validation, assigned-teacher
  authorization, Draft privacy, and grading against the recorded submission
  version.
- Verify assignment-wide publication is atomic, idempotent, and safe under
  concurrent publication, enrollment changes, and teacher-access changes.
- Verify automatic zeroes, post-publication enrollment/reactivation backfill,
  Published corrections, immutable complete history, and notification
  deduplication.
- Add a failing regression test before every production-code fix and keep each
  fix in its owning route, service, repository, or new forward-only migration.
- Keep implementation, OpenAPI, migrations, documentation, and tests aligned.

## Non-goals

- Frontend implementation or frontend/staging acceptance.
- Unpublish or withdrawal of an official result.
- Automatic quiz or source-code grading.
- B2 object storage, notification listing/scheduling, or comments.
- Reworking assignment/submission behavior unrelated to B4 grading and
  publication.
- Returning the internal assignment publication actor through the public API.

## Anti-goals

- Do not rewrite working assessment behavior merely to create a larger B4 diff.
- Do not weaken authorization, Draft privacy, transactionality, database
  constraints, lint, types, or tests to make verification pass.
- Do not edit applied migrations `0001` through `0006`; introduce `0007` only
  when a demonstrated invariant cannot be safely enforced in application code.
- Do not treat the static OpenAPI mock as proof of authentication, persistence,
  concurrency, or transactional behavior.

## Confirmed product behavior

1. Only a currently assigned teacher for the class may read or mutate grades or
   publish results. Foreign resources remain hidden with the existing public
   error behavior; students and admins cannot use teacher grading operations.
2. A score is finite, non-negative, no greater than the assignment `maxScore`,
   and has at most two decimal places. Feedback is nullable and at most 5,000
   characters. Unknown request properties are rejected.
3. The first grade targets the latest successfully committed submission version.
   Later corrections retain the grade's recorded version. Any Draft or Published
   grade permanently locks further submission versions.
4. Draft score and feedback never appear through student submission, result,
   history, error, or notification surfaces.
5. Publication covers the active student/account cohort in one transaction. If
   any submitted work lacks a current grade, it returns
   `409 UNGRADED_SUBMISSIONS` and writes no grade, history, publication metadata,
   or notification.
6. Successful publication publishes all Draft grades and creates Published score
   zero results for active students without submissions. Automatic zeroes have
   source `AUTO_ZERO_NO_SUBMISSION` and null submission/version identifiers.
7. Repeated or concurrent publication creates no duplicate grade, history
   revision, or notification. The first successful publication provenance remains
   stable.
8. Correcting a Published result keeps it Published, records a new immutable
   history revision, and makes the change immediately visible to the student.
   An automatic zero may be corrected to source `MANUAL` without creating a fake
   submission.
9. Enrollment or account reactivation after publication creates any missing
   Published automatic zero in the same transaction, while preserving an
   existing grade/history and keeping submission locked.
10. Teacher history contains Draft and Published revisions; student history
    contains Published revisions only. Grade history cannot be updated or deleted.

## Constraints and architecture

- Use Node.js 22, Express 5, strict TypeScript ESM, PostgreSQL 17, `pg`, Zod,
  Vitest, and Supertest.
- Preserve `/api`, camelCase JSON, UUID identifiers, ISO 8601 timestamps, and the
  `{ "error": { "code", "message" } }` envelope.
- Routes/controllers own HTTP parsing and responses, services own authorization
  and business transactions, and repositories own parameterized SQL.
- Use the existing class-first locking order for publication and membership
  mutation to avoid deadlocks and stale authorization.
- Treat approved requirements, OpenAPI, migrations, implementation, and tests as
  separate artifacts. Record conflicts rather than silently selecting one.

## Approaches considered

### 1. Audit first and close demonstrated gaps — selected

Start from current `origin/develop`, build the requirement-to-evidence matrix,
add focused failing tests for uncovered behavior, and make only the minimum fixes.
This preserves the already-tested B3/B4 invariants, minimizes regression risk, and
produces an honest review boundary for B4 completion.

### 2. Verification only

Run the existing suites and merge if green. This is faster, but existing tests do
not by themselves prove every concurrency, authorization-revocation, rollback,
and deduplication condition required to declare B4 complete.

### 3. Reimplement B4 as a new isolated module

This creates an obvious feature-sized diff, but duplicates working behavior,
increases migration and compatibility risk, and conflicts with the repository's
focused-change rule. It is rejected.

## Completion workflow

### Coverage audit

Create a compact working matrix for the ten confirmed behaviors. For each row,
record the route/schema, service rule, repository query/transaction, database
constraint or trigger, existing test, and any missing evidence. A missing test is
not automatically a production bug; production changes require an observed RED
test that fails for the intended reason.

### Focused gap closure

Prioritize gaps by risk:

1. authorization rechecked while holding the class/membership locks;
2. complete rollback on publication blockers or mid-transaction failures;
3. repeated and concurrent publication deduplication;
4. Draft non-disclosure across every student-visible surface;
5. invalid score/feedback requests leaving grade and history unchanged;
6. Published correction and post-publication enrollment/reactivation races.

For each demonstrated gap, add one focused regression test, observe RED, implement
the smallest owning-layer change, then run the focused test and related integration
file before continuing. Add migration `0007` only for a database invariant that is
both missing and required for correctness under concurrent writers.

### Contract alignment

Compare every B4 request, success response, and declared public error with
`docs/openapi.json`. Apply only evidence-backed corrections and extend contract
tests for strict request bodies, score increments/ranges, feedback length, Draft
privacy schemas, and publication blockers. The completion branch may update the
contract with its corresponding implementation so the final merge is internally
consistent; no new endpoint or product behavior is introduced without approval.

### Review and verification

The completion branch must pass:

- focused B4 tests while iterating;
- all assessment, assignment, enrollment-publication, migration, and API
  integration suites against a disposable PostgreSQL 17 database;
- `npm run check` (lint, typecheck, unit/contract tests, build);
- OpenAPI validation and mock self-test;
- `git diff --check` and a security/transaction/privacy review of the final diff;
- pull request CI on the actual merge candidate.

Skipped integration suites, unavailable PostgreSQL, unavailable GitHub status, or
red CI are release blockers for B4 even if unit tests pass. Frontend and staging
acceptance are documented follow-up dependencies, not blockers for this backend
merge.

## Delivery boundary

Work continues on `feature/B4-assessment-publication-completion`, based on current
`origin/develop`. The pull request should contain only the coverage matrix/tests,
demonstrated fixes, any necessary forward migration, aligned contract/docs, and an
evidence-based verification summary. The old merged B4 branch is not reused.

No durable architecture decision is expected. Update `DECISIONS.md` only if the
audit exposes a genuinely new public API, data-model, security, or compatibility
decision that requires product approval.

## Builder-owned calls

- Choose the smallest suitable existing integration-test file for each missing
  assertion, splitting a new B4-focused file only when that improves fixture
  isolation materially.
- Use deterministic database synchronization for concurrency tests rather than
  timing sleeps.
- Keep the coverage matrix in the implementation plan or a focused B4 verification
  document, whichever makes the final review easiest; do not create a permanent
  document that merely duplicates tests.
