# D2 API contract and mock — review draft

**Status:** Updated for Client Log #18–#20 on 16/10/2026. Nam owns D2. The current source is [openapi.json](openapi.json); it defines 40 operations across six project modules. Long must reconcile the new grade identity/history contract with D1 before B4 implementation. The mock is a static frontend aid, not proof that B1–B6 exist.

## Current situation and recommendation

`main` contains only the S1 health/readiness endpoints. D1 was merged into `develop` through PR #1; this D2 branch now includes its migration `0001`, seed, and draft business decisions for direct reconciliation. Client Log #1–12 establishes the base actors and flows; #18–#20 resolves submission locking, grade correction history, and automatic zeroes.

The draft uses resource paths under `/api`, UUID IDs, camelCase JSON, ISO 8601 UTC responses, the existing error envelope, cursor pagination, and one class/resource authorization check per operation. A provisional bearer contract keeps the frontend mock concrete; Long, Nam, and Khang must confirm bearer versus server session at CP1 before B1 implementation. `GET /api/health` and `GET /api/ready` remain the existing S1 contract and are not redefined as business endpoints here.

One combined spec drives the mock. The alternatives were separate endpoint lists and fixture files, which would be easy to drift from D2, or a runtime mocking package, which would add an external dependency. JSON was chosen so Node 22 can validate and serve examples without a package install. This is a reversible tooling choice, not a new backend architecture.

## D1 reconciliation

| D2 representation | D1 source | Contract consequence |
| --- | --- | --- |
| `User`, `Class`, `TeacherAssignment`, `Enrollment` | `users`, `classes`, `class_teachers`, `enrollments` | Admin provisions accounts/classes and manages the two membership tables. Teachers have equal class rights. Login uses `schoolCode`; email is optional. Class now exposes course code and description; D1 must add them. Enrollment embeds a safe student summary. |
| `Material`, `Assignment`, `File` | `materials`, `assignments`, `files`, three file-link tables | Upload returns private file metadata. Creation references file IDs; download must authorize against the linked parent resource. Provider, container and object key never appear in responses. |
| `Submission` with `versions[]` | `submissions`, `submission_versions`, `submission_files` | One submission record per student and assignment; version numbers are integers, old versions are immutable, current is the highest completed version. Any Draft or Published grade locks new versions. Student responses expose the lock state but never Draft score/feedback. |
| `Grade` / `PublishedGrade` / `GradeHistory` | `grades` plus a required new history table | A grade belongs to an assignment and student/enrollment, with an optional submission/version. This permits `AUTO_ZERO_NO_SUBMISSION`. Published corrections append immutable history. Student routes use Published-only schemas. |
| `Notification`, `Comment` | `notifications`, `comments` | Notifications are recipient-scoped and contain no Draft grade details. Comments target exactly one assignment or submission. |

The spec follows the D1 table shapes now present on this branch but does not approve D1's proposed Q04–Q10 business rules. In particular, `isLate` is a derived value from `submittedAt` and `deadlineAtSubmission`; D1 does not store a separate Late column. The backend must set server timestamps and commit each version plus file links atomically. D1 is merged into `develop`, not `main`; schema names and constraints still need final CP1 approval.

## Mock and validation

From `lms-backend` with Node 22:

```bash
node scripts/mock-api.mjs --validate
node scripts/mock-api.mjs --self-test
node scripts/mock-api.mjs
```

The mock listens on `127.0.0.1:4010`; frontend base URL is `http://localhost:4010/api`. `GET /api/openapi.json` serves the draft. For example:

```bash
curl http://127.0.0.1:4010/api/classes
curl http://127.0.0.1:4010/api/assignments/50000000-0000-4000-8000-000000000001/my-submission
curl -H 'X-Mock-Status: 409' -X POST http://127.0.0.1:4010/api/assignments/50000000-0000-4000-8000-000000000001/submissions
```

The mock returns deterministic schema examples for success and declared errors. Its `--validate` command checks local references, examples, operation IDs, tags, roles, and success responses; it is not a full third-party OpenAPI linter. The mock does **not** authenticate, authorize, validate request bodies, persist mutations, store files, enforce deadline rules, or calculate grades. The `X-Mock-Status` header selects a response already declared for that operation; a 409 mock response is only an error-shape example, not an approved resubmission policy. Do not use the mock as an acceptance test for access control or business rules.

## Approved rules from Client Log #18–#20

1. Once a Draft or Published grade exists, the student cannot submit another version. Submission returns `409 GRADE_LOCKS_SUBMISSION`; `my-submission` exposes `canSubmit` and `lockedReason` without exposing Draft grade data.
2. Teachers may correct a Published grade. The correction stays visible as Published and appends an immutable revision containing score, feedback, actor and timestamp. Both teacher and student history endpoints are defined; student history includes only Published revisions.
3. Publication is assignment-wide and atomic. Every submitted assignment must have a current grade or publication returns `409 UNGRADED_SUBMISSIONS` and publishes nothing. The successful transaction publishes all current grades and creates Published score-0 results for active enrolled students without submissions.
4. Student result lookup is assignment-based, not submission-based, so an automatic zero can be returned with null `submissionId` and `gradedVersionNumber`.

## Remaining decisions before B3/B4

The following choices remain open from Client Log #4–#6 and D1 Q05–Q08. The recommendations are proposals for Kha/Long/Nam to approve, not implemented behavior.

1. **Late repeat submission:** A first submission after deadline is allowed and marked Late. If a student already submitted before the deadline, may they replace it afterward? Recommend rejecting the replacement until the teacher explicitly extends the assignment; alternative is allowing every later version as Late. D1 can represent either.
2. **Deadline boundary and edits:** Recommend server completion time, `submittedAt <= deadlineAtSubmission` as on time, and a historical deadline snapshot so later edits do not rewrite Late status. Alternative: use upload start time or recompute old Late values against the edited deadline. This affects B3 and D1 Q07.
3. **Score precision:** `0 <= score <= assignment.maxScore` is fixed; exact decimal precision remains to be approved.

No unpublish endpoint is included. The assignment-wide publication endpoint is now part of D2. D1 must be updated with grade identity/source and history storage before B4; behavior tests must cover transaction rollback, automatic zeroes, ownership, corrections, and Draft privacy.

Other CP1 items remain open but do not change the five decisions above: authentication transport, account credential issuance and CSV import, class-code uniqueness, file MIME/size limits and orphan cleanup, comment visibility, and account/enrollment deactivation. These are marked with `x-decision-pending` on their operations or in D1's decision list. Their current shapes are review proposals.
