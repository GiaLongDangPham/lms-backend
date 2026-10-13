# D2 API contract and mock — review draft

**Status:** Draft for CP1 on 15/10/2026. Nam owns D2. The current source is [openapi.json](openapi.json); it defines 36 operations across six project modules. Long should review its compatibility with D1 before the contract is treated as approved. The mock is a static frontend aid, not proof that B1–B6 exist.

## Current situation and recommendation

`main` contains only the S1 health/readiness endpoints. The unmerged `origin/D1-setup-database` branch contains migration `0001`, a seed, and draft business decisions. `LMS Project.pdf`, Client Log #1–12 (pages 2–3), confirms the required actors and flows but does not specify endpoint shapes or the edge rules listed below.

The draft uses resource paths under `/api`, UUID IDs, camelCase JSON, ISO 8601 UTC responses, the existing error envelope, cursor pagination, and one class/resource authorization check per operation. A provisional bearer contract keeps the frontend mock concrete; Long, Nam, and Khang must confirm bearer versus server session at CP1 before B1 implementation. `GET /api/health` and `GET /api/ready` remain the existing S1 contract and are not redefined as business endpoints here.

One combined spec drives the mock. The alternatives were separate endpoint lists and fixture files, which would be easy to drift from D2, or a runtime mocking package, which would add an external dependency. JSON was chosen so Node 22 can validate and serve examples without a package install. This is a reversible tooling choice, not a new backend architecture.

## D1 reconciliation

| D2 representation | D1 source | Contract consequence |
| --- | --- | --- |
| `User`, `Class`, `TeacherAssignment`, `Enrollment` | `users`, `classes`, `class_teachers`, `enrollments` | Admin provisions accounts/classes and manages the two membership tables. Teachers have equal class rights. Login uses `schoolCode`; email is optional. |
| `Material`, `Assignment`, `File` | `materials`, `assignments`, `files`, three file-link tables | Upload returns private file metadata. Creation references file IDs; download must authorize against the linked parent resource. Provider, container and object key never appear in responses. |
| `Submission` with `versions[]` | `submissions`, `submission_versions`, `submission_files` | One submission record per student and assignment; version numbers are integers, old versions are immutable, current is the highest completed version. Multi-file examples are represented by arrays. |
| `Grade` / `PublishedGrade` | `grades` | Teacher-only grade points to an explicit submission version. The student route uses a separate Published-only schema; submission lists/details contain no grade fields. |
| `Notification`, `Comment` | `notifications`, `comments` | Notifications are recipient-scoped and contain no Draft grade details. Comments target exactly one assignment or submission. |

The spec follows D1's current table shapes but does not approve D1's proposed Q04–Q10 business rules. In particular, `isLate` is a derived value from `submittedAt` and `deadlineAtSubmission`; D1 does not store a separate Late column. The backend must set server timestamps and commit each version plus file links atomically. The D1 branch is not merged into `main`, so schema names and constraints need a final CP1 comparison.

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

## Decisions needed before B3/B4

The following choices are open in Client Log #4–#6 and D1 Q05–Q07. The recommendations are proposals for Kha/Long/Nam to approve, not implemented behavior.

1. **Late repeat submission:** A first submission after deadline is allowed and marked Late. If a student already submitted before the deadline, may they replace it afterward? Recommend rejecting the replacement until the teacher explicitly extends the assignment; alternative is allowing every later version as Late. D1 can represent either.
2. **Repeat after grading/publication:** May a student submit again after a grade exists? Recommend rejecting it for MVP so a Published grade never points to a superseded current version. Alternative: accept a new version and return the grade to Draft or retain a clearly version-specific Published result. D1 has no automatic reset rule.
3. **Deadline boundary and edits:** Recommend server completion time, `submittedAt <= deadlineAtSubmission` as on time, and a historical deadline snapshot so later edits do not rewrite Late status. Alternative: use upload start time or recompute old Late values against the edited deadline. This affects B3 and D1 Q07.
4. **Score and publication scope:** Recommend `0 <= score <= assignment.maxScore` with up to two decimal places and publication per student. Alternative: publish the entire assignment in one transaction. D1 currently stores one grade/status per submission and does not enforce decimal precision.
5. **Editing a Published grade:** Recommend returning 409 for edits until a correction/republication flow is approved. Alternative: editing moves the grade back to Draft, hides it from the student, and requires a second Publish. D1 does not do that transition automatically; unpublish/withdrawal is also undecided.

No bulk publish, unpublish, or late-resubmission policy endpoint is included until these choices are resolved. After approval, update the affected OpenAPI operations and D1 migration/service rules together, then add behavior tests for Late boundaries, version history, ownership, and Draft visibility through every student-facing route.

Other CP1 items remain open but do not change the five decisions above: authentication transport, account credential issuance and CSV import, class-code uniqueness, file MIME/size limits and orphan cleanup, comment visibility, and account/enrollment deactivation. These are marked with `x-decision-pending` on their operations or in D1's decision list. Their current shapes are review proposals.
