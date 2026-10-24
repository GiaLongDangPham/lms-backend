# B3 Client Log Completion Design

## Intent

Complete and harden the backend workflow for assignments, submissions, grading, and
publication against the approved Client Log decisions. The work must preserve the
already merged behavior while bringing the B3 implementation and its directly
coupled B4 grading flow into the repository's route/controller/service/repository
architecture.

All work is isolated on `feature/B3-client-log-completion`. It will be proposed to
`develop` through a pull request; no product commit is pushed directly to
`develop`.

## Current state

The traceability sources for this work are the live `Client Log` tab in the team
tracker (entries 4–6 and 18–20), `docs/D1-decisions.md` (approved Q05–Q08
follow-ups), and `docs/openapi.json` (the current public contract). Where they
conflict, the later approved decision is authoritative and the conflict must be
reported rather than silently resolved.

PR #6 already implements the main workflow:

- assigned teachers create, read, list, and edit assignments;
- students submit immutable versions through owned `PENDING` file IDs;
- a first late submission is accepted and marked Late;
- subsequent versions close at the current deadline and reopen after an extension;
- Draft or Published grading permanently locks further submission;
- assignment-wide publication creates automatic zeroes for active students who did
  not submit;
- grade corrections append immutable history, and student responses never expose
  Draft grades or feedback.

The assignment code is layered, but the coupled assessment implementation still
contains HTTP handling, business rules, transactions, and SQL in one router. Test
coverage proves the main happy paths but is thinner around authorization,
concurrency, file attachment failures, pagination, and deadline boundaries.

## Goals

1. Verify every B3/B4 behavior assigned to Nam by Client Log entries 4–6 and
   18–20, plus the approved follow-up decisions recorded on 24/10/2026.
2. Fix confirmed contract or implementation gaps without redesigning the public API.
3. Refactor the assessment flow so routes/controllers own HTTP concerns, services
   own rules and transactions, and repositories own parameterized SQL.
4. Add behavior-focused PostgreSQL integration coverage for authorization, privacy,
   boundary, rollback, and concurrency-sensitive cases.
5. Keep OpenAPI, migrations, implementation, tests, and handoff documentation
   consistent.

## Non-goals

- Full B2 object upload/download, MIME sniffing, archive inspection, or cleanup
  workers. B3 continues consuming validated `fileIds` and enforcing attachment
  invariants.
- B5 notification listing, read state, assignment-created notifications, or
  deadline-reminder scheduling. Existing grade-publication notification writes are
  preserved because they are part of the current publication transaction.
- B6 assignment/submission comments.
- Frontend work, including F3 or F4 screens.
- Adding submission `note`; L05 remains unresolved and the public API continues to
  reject it.
- Unpublish support or a new publication model.
- Unrelated cleanup in B1/B2 code.

## Constraints

- Node.js 22, Express 5, strict TypeScript ESM, PostgreSQL 17, and `pg` remain the
  implementation stack.
- `/api`, camelCase JSON, UUIDs, ISO 8601 timestamps, cursor pagination, and the
  established error envelope remain stable.
- Applied migrations are immutable. Any missing database invariant requires a new
  migration, expected to be `0005_*`; no earlier migration may be edited.
- Authorization is server-side and must validate role, current class access,
  enrollment or submission ownership, and active account state as applicable.
- Draft scores and feedback must never appear in student-facing responses,
  notifications, or errors.
- Submission and publication multi-step changes remain atomic.
- Existing untracked files in the original checkout are not copied into commits.

## Approaches considered

### 1. Minimal B3 gap patch

Keep the current assessment router and only add missing tests or narrow fixes. This
is the smallest diff, but it leaves SQL and business transactions in the router and
makes the B3/B4 boundary harder to maintain.

### 2. Complete B3 and normalize its coupled B4 flow — selected

Harden the assignment/submission module and split the existing assessment module
into route, controller, service, and repository layers. Preserve endpoint paths and
response shapes. This is a larger review than approach 1, but it aligns the code
with repository rules without broadening into other product modules.

### 3. Separate B3 completion and B4 refactor branches

This gives smaller PRs, but submission locks, assignment row locking, grade history,
publication, and tests cross both modules. Splitting them would create ordering and
merge-conflict risk without a useful product boundary.

## Component design

### Assignment and submission module

Retain the existing `src/modules/assignments/` boundary and public routes. The
review may change internal query shapes to remove unnecessary N+1 work, but it must
not change ordering or cursor semantics.

The service remains responsible for:

- assigned-teacher checks for create, update, and submission lists;
- active-student enrollment and ownership checks;
- first-late versus repeat-submission deadline rules;
- Draft/Published grade locks;
- validating distinct, owned, `PENDING`, unattached files;
- enforcing 10 files and 100 MiB per submission version;
- atomically creating the submission/version/file links and attaching files;
- returning history without grade leakage.

Deadline decisions use PostgreSQL server time inside the transaction. Each version
keeps its deadline snapshot. The response is returned only after the transaction
commits successfully; a rollback must leave no version and no attached files.

### Assessment module

Retain `src/modules/assessment/` to minimize rename noise, but replace the current
mixed router implementation with:

- `assessment.routes.ts`: route registration, authentication, parameter/body
  validation, and HTTP-only concerns;
- `assessment.controller.ts`: response status and DTO handoff;
- `assessment.service.ts`: access rules, grade state transitions, publication,
  automatic zeroes, history visibility, and transaction boundaries;
- `assessment.repository.ts`: parameterized queries, locks, persistence, and
  database row mapping.

The old mixed `router.ts` and helper-only `service.ts` are removed after their
behavior is covered by the layered replacement. `src/app.ts` registers only the new
router.

### Transaction and lock ordering

Mutation flows use one consistent lock order:

1. class row when the mutation can change or depend on cohort/permission state;
2. assignment row;
3. current teacher membership or active enrollment row;
4. submission/grade rows;
5. referenced file rows.

Submission, grading, publication, teacher removal, and enrollment deactivation must
not allow a permission check to become stale between authorization and commit.
Database constraints remain the final defense for cross-class references,
submission locks, grade precision, and immutable grade history.

### Public behavior preserved

- `POST /assignments/{assignmentId}/submissions` accepts the first submission after
  deadline and marks it Late.
- A repeat submission after the current deadline returns
  `DEADLINE_LOCKS_RESUBMISSION`; extending the deadline can reopen it.
- Any existing Grade returns `GRADE_LOCKS_SUBMISSION`, regardless of Draft or
  Published state.
- `GET /assignments/{assignmentId}/my-submission` and
  `GET /submissions/{submissionId}` never include Draft grade values or feedback.
- Publication is assignment-wide and all-or-nothing. Ungraded submitted work blocks
  it; active students without submissions receive a Published automatic zero.
- If a student is newly enrolled or an inactive enrollment is reactivated after an
  assignment has already been published, the enrollment transaction creates a
  Published score 0 result with source `AUTO_ZERO_NO_SUBMISSION` when that
  enrollment has no result for the assignment. Existing grades and grade history
  are never replaced, and this does not reopen submission access.
- Correcting a Published result keeps it Published, records history, and creates a
  deduplicated update notification.
- Scores and maximum scores keep two-decimal precision and range validation.

### Enrollment after publication

The selected MVP rule is cohort completion rather than excluding late enrollment
from an already-published grade column. On both new enrollment and reactivation,
the backend finds every published assignment in the class for which the enrollment
has no grade and creates exactly one Published automatic zero. The result has no
fabricated submission or version: `submissionId` and `gradedVersionNumber` remain
null. A pre-existing result is authoritative, including after withdrawal and
reactivation, so neither its current value nor its immutable history is changed.

The assignment stores both `results_published_at` and the teacher who performed the
assignment-wide publication. A new additive migration introduces the missing
publisher attribution for this purpose. Post-publication automatic zeroes use that
original publisher for `graded_by` and `published_by`; the administrator performing
enrollment is not represented as the grader. Existing published assignments are
backfilled from an existing Published grade where possible, with the assignment
creator as the deterministic fallback.

Publication and enrollment/reactivation serialize on the class row before locking
assignment or enrollment data. This closes both race directions: publication must
include an enrollment committed first, while enrollment committed second must see
the published assignment and create its zero. The grade uniqueness constraint and
an idempotent insert remain the final defense, so retries cannot create another
grade or history revision. No submission row is created and the existing
assignment publication lock continues to reject later submissions.

## Verification design

### Assignment/submission coverage

- assigned versus foreign teacher and active versus inactive student access;
- student ownership and deliberate 404 behavior for another student's submission;
- create/update validation and pagination cursor scope;
- first submission before, at, and after deadline;
- repeat submission before and after deadline, then after deadline extension;
- Draft and Published grade locks;
- duplicate, foreign-owned, already-attached, missing, oversized, and excessive file
  references;
- transaction rollback leaves no version and no incorrect lifecycle transition;
- two concurrent first submissions cannot create duplicate submission records or
  version numbers;
- historical deadline snapshot and Late state remain unchanged after deadline edit.

### Grading/publication coverage

- only assigned teachers may grade or publish;
- a first grade targets the latest version and stale version requests fail;
- Draft is visible to teachers but not students;
- publication fails atomically when any active submitted student is ungraded;
- automatic zeroes have no fake submission/version and publication is idempotent;
- new enrollment and reactivation after publication create the missing automatic
  zero, preserve any existing grade/history, and leave submission access locked;
- concurrent publication and enrollment/reactivation produce exactly one result
  per active enrollment with no missed cohort member or duplicate history;
- Published corrections preserve all prior history and notify once per revision;
- inactive users/enrollments are handled according to the current active cohort rule;
- lowering `maxScore` below an existing grade remains rejected.

### Checks

Run targeted Vitest/Supertest tests while changing each boundary. Before handoff run
`npm run check`, `npm run api:validate`, the mock self-test, `npm run db:test`, and
`npm run api:test` against PostgreSQL 17. CI must be green before recommending a
merge.

## Documentation and migration policy

OpenAPI changes are limited to correcting a demonstrated mismatch and documenting
the selected post-publication enrollment behavior; they must not add B2, B5, or B6
implementation claims. README status text will be updated so it does not claim
merged functionality is still uncommitted. A new additive migration records the
assignment-wide publisher used by post-publication automatic zeroes; earlier
migrations remain unchanged.

## Branch and delivery

- Working branch: `feature/B3-client-log-completion` from current `develop`.
- Commits use Conventional Commits, split by coherent behavior or refactor, for
  example `test(assignments): cover client log boundaries` and
  `refactor(assessment): separate service and repository layers`.
- Push only the feature branch.
- Open a pull request targeting `develop`.
- Do not merge until checks pass and the user explicitly asks for the merge.

## Success criteria

The work is complete when every in-scope Client Log rule has a traceable automated
test, the assignment and assessment modules respect the repository architecture,
all relevant checks pass on PostgreSQL 17, the contract and implementation agree,
post-publication enrollment/reactivation cannot leave an active student without a
result or reopen submission access, and B2/B5/B6 remain explicitly outside this
branch.
