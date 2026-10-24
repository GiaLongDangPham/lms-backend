# D2 API contract and mock — review draft

**Status:** Integrated through 24/10/2026. The current source is
[openapi.json](openapi.json); it combines the B1 JWT/account/class extensions with
the approved assignment, submission, grade-history, publication, precision and file
rules. The mock is a static frontend aid, not proof that every module is implemented.

## Current situation and recommendation

`main` contains only the S1 health/readiness endpoints. D1 was merged into `develop` through PR #1; this D2 branch now includes its migration `0001`, seed, and draft business decisions for direct reconciliation. Client Log #1–12 establishes the base actors and flows; #18–#20 resolves submission locking, grade correction history, and automatic zeroes.

The draft uses resource paths under `/api`, UUID IDs, camelCase JSON, ISO 8601 UTC responses, the existing error envelope, cursor pagination, and one class/resource authorization check per operation. A provisional bearer contract keeps the frontend mock concrete; Long, Nam, and Khang must confirm bearer versus server session at CP1 before B1 implementation. `GET /api/health` and `GET /api/ready` remain the existing S1 contract and are not redefined as business endpoints here.

One combined spec drives the mock. The alternatives were separate endpoint lists and fixture files, which would be easy to drift from D2, or a runtime mocking package, which would add an external dependency. JSON was chosen so Node 22 can validate and serve examples without a package install. This is a reversible tooling choice, not a new backend architecture.

## D1 reconciliation

| D2 representation | D1 source | Contract consequence |
| --- | --- | --- |
| `User`, `Class`, `TeacherAssignment`, `Enrollment` | `users`, `classes`, `class_teachers`, `enrollments` | Admin provisions accounts/classes and manages the two membership tables. Teachers have equal class rights. Login uses `schoolCode`; email is optional. Class now exposes course code and description; D1 must add them. Enrollment embeds a safe student summary. |
| `Material`, `Assignment`, `File` | `materials`, `assignments`, `files`, three file-link tables | Upload returns private file metadata. Creation references file IDs; download must authorize against the linked parent resource. Provider, container and object key never appear in responses. Upload uses an explicit common-file allowlist and rejects executable, macro-enabled, extensionless and unknown file types. |
| `Submission` with `versions[]` | `submissions`, `submission_versions`, `submission_files` | One submission record per student and assignment; version numbers are integers, old versions are immutable, current is the highest completed version. An existing submission may receive a new version only through the current deadline; extending the deadline reopens it. Any Draft or Published grade locks new versions permanently. Student responses expose the lock state but never Draft score/feedback. |
| `Grade` / `PublishedGrade` / `GradeHistory` | `grades` plus a required new history table | A grade belongs to an assignment and student/enrollment, with an optional submission/version. This permits `AUTO_ZERO_NO_SUBMISSION`. Published corrections append immutable history. Student routes use Published-only schemas. |
| `Notification`, `Comment` | `notifications`, `comments` | Notifications are recipient-scoped and contain no Draft grade details. Comments target exactly one assignment or submission. |

The spec follows the D1 table shapes now present on this branch but does not approve unresolved parts of D1 Q04–Q10. `isLate` is derived from `submittedAt > deadlineAtSubmission`; equality is on time. `submittedAt` is the server-side completion time that becomes effective only when the version and all file links commit successfully. Existing versions keep their deadline snapshot when a teacher edits the assignment deadline. D1 is merged into `develop`, not `main`; schema names and constraints still need final review.

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
2. Teachers may correct a Published grade. Every successful grade create or change, including Draft changes, appends an immutable revision containing score, feedback, status, actor and timestamp. Teacher history returns all revisions; student history includes only Published revisions.
3. Publication is assignment-wide and atomic. Every submitted assignment must have a current grade or publication returns `409 UNGRADED_SUBMISSIONS` and publishes nothing. The successful transaction publishes all current grades and creates Published score-0 results for active enrolled students without submissions.
4. Student result lookup is assignment-based, not submission-based, so an automatic zero can be returned with null `submissionId` and `gradedVersionNumber`.

## Approved submission, deadline, score and file rules — 24/10/2026

1. A first submission may be late. After a student has a submission, another version is accepted only when its successful server-side commit time is at or before the assignment's current deadline. After that boundary the API returns `409 DEADLINE_LOCKS_RESUBMISSION`; extending the deadline into the future reopens resubmission for an ungraded student.
2. A teacher may move the deadline earlier or later after submissions exist. This changes only future admission checks; every existing version keeps its `deadlineAtSubmission` and historical Late result.
3. Scores and `maxScore` allow at most two decimal places and remain constrained by `0 <= score <= maxScore`.
4. Publication remains assignment-wide and atomic, matching the UI and R1 scenario.
5. The initial upload allowlist covers common documents, spreadsheets, slides, plain data/text, source code, images and `.zip`. Examples include `.docx`, `.xls`, `.cpp` and `.py`. Source code is stored inertly and never executed. Executables, direct system scripts, macro-enabled Office files, extensionless files, unknown extensions, `.rar`, `.7z`, and files whose detected content conflicts with their extension/MIME type are rejected.
6. Each file is at most 25 MiB. A resource or submission version has at most 10 distinct files; a submission version is also capped at 100 MiB total.
7. ZIP inspection rejects more than 100 entries, expanded content above 200 MiB, expansion ratios above 20:1, nested archives, symlinks, absolute/parent traversal paths and denied file types inside the archive.
8. Files live in private S3-compatible object storage. New uploads are actor-owned `PENDING` records; attaching to exactly one resource changes them to `ATTACHED` in the resource transaction. A cleanup job removes unattached files after 24 hours and retries failed object deletions from `DELETE_PENDING`. Attached historical files are never removed by orphan cleanup.

## Remaining decisions before B3/B4

The submission, deadline, precision, file-limit, ZIP inspection, storage and orphan-cleanup choices are approved. Provider credentials, bucket/container names and signed-URL duration remain environment configuration rather than public contract decisions.

No unpublish endpoint is included. Unpublish would withdraw an already Published result back to a hidden/Draft state, making the current official result temporarily unavailable to students; that behavior is explicitly outside the MVP. Corrections instead remain Published and append history. The assignment-wide publication endpoint is part of D2. D1 must be updated with grade identity/source, complete history storage and file lifecycle state before B4; behavior tests must cover deadline boundaries and reopening, transaction rollback, automatic zeroes, ownership, corrections, two-decimal validation, Draft privacy, file limits, ZIP abuse and orphan cleanup.

Other review items remain open but do not change the decisions above: authentication transport, account credential issuance and CSV import, class-code uniqueness, comment visibility, and account/enrollment deactivation. These are marked with `x-decision-pending` on their operations or in D1's decision list. Their current shapes are review proposals.
