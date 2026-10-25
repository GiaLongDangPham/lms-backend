# B4 Assessment and Publication Design

## Intent

Complete B4 as a dedicated feature branch based on the merged B3 baseline. Reuse the
grading and publication implementation already merged through B3, then close only
evidence-backed gaps in behavior, tests, and API-contract alignment.

## Goals

- Verify manual grading, Draft privacy, submission locking, atomic publication,
  automatic zeroes, Published corrections, and immutable history end to end.
- Preserve server-side teacher assignment, class membership, ownership, and role
  authorization.
- Add a regression test before every production-code fix.
- Keep API specification changes on `docs/api-specification`, separate from the B4
  implementation branch.

## Non-goals

- Unpublish or withdrawal of official results.
- Automatic quiz or source-code grading.
- Notification listing/scheduling, comments, frontend work, or B2 object storage.
- Reworking B3 assignment/submission behavior that is unrelated to grading.

## Constraints

- Node.js 22, Express 5, strict TypeScript ESM, PostgreSQL 17, and `pg`.
- Routes own validation and HTTP concerns; services own rules and transactions;
  repositories own parameterized SQL.
- Draft score and feedback must never appear in student-facing responses, errors,
  or notifications.
- Publication is all-or-nothing for the active cohort and preserves history.
- Applied migrations remain immutable; any new invariant requires a new migration.

## Approaches

1. Continue implementing B4 on the old B3 branch. Rejected because B3 is already
   merged and the work-item boundary would be misleading.
2. Reimplement grading from scratch on a B4 branch. Rejected because the merged B3
   baseline already contains coupled, tested transaction rules.
3. Create B4 from merged `develop`, audit the existing implementation, and add only
   missing behavior and coverage. Selected because it preserves proven B3/B4
   invariants while producing an honest B4 review boundary.

## Verification and delivery

The B4 branch receives test-first implementation fixes and B4-focused verification.
Any OpenAPI differences found by the audit are applied independently to
`docs/api-specification` and validated there. Final verification includes lint,
typecheck, unit/contract tests, build, and database integration suites when a
PostgreSQL test database is available.
