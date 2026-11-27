# B5 In-App Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the existing student notification contract for assignment creation, one 24-hour deadline reminder per current deadline, grade publication/correction, personal listing, and idempotent read state.

**Architecture:** A focused notification module owns notification SQL, API DTOs, event publishing, and deadline dispatch. Assignment and assessment services receive a transaction-aware `NotificationPublisher`; an idempotent in-process worker calls the database-owned deadline sweep at startup and every five minutes while `server.ts` owns its lifecycle.

**Tech Stack:** Node.js 22, TypeScript ESM, Express 5, PostgreSQL 17 with `pg`, Zod, Vitest/Supertest, existing migration and API-test runners.

**Spec:** `docs/superpowers/specs/2026-11-13-b5-notifications-design.md`

## Global Constraints

- Preserve the current OpenAPI paths, response fields, and kinds: `ASSIGNMENT_CREATED`, `DEADLINE_REMINDER`, `GRADE_PUBLISHED`.
- Do not add announcements, email/push/realtime delivery, unread counters, deletion, comments, frontend work, or dependencies.
- Never expose Draft score/feedback, recipient IDs, deduplication keys, or another student's data.
- Assignment/result events must write notifications inside their existing source transaction.
- PostgreSQL is the only deadline eligibility clock; reminder window is `deadline_at > now` and `deadline_at <= now + 24 hours`.
- One reminder is allowed per recipient and current deadline; a changed deadline has a new deduplication key.
- Applied migrations `0001` through `0006` are immutable; use `0007_b5_notifications.sql`.
- Preserve the repository's route/controller/service/repository boundaries, `/api` prefix, camelCase JSON, stable errors, and `Cache-Control: no-store` for authenticated notification routes.
- Use TDD, focused commits, parameterized SQL, and the existing temporary-database integration harness.

## Review Focus

- Cursor reuse/tampering: a malformed cursor or cursor from another recipient/scope returns `400 VALIDATION_ERROR` (Task 2).
- Timestamp ties: several notifications with identical `created_at` paginate once each in deterministic `created_at DESC, id DESC` order (Task 2).
- Ownership probing: a student marking another recipient's notification read receives `404` and does not mutate it (Task 2).
- Concurrent deadline sweep/submission: already-committed submissions suppress reminders; concurrent uncommitted submissions may race without blocking either transaction (Task 5).
- Worker failure/overlap: a rejected sweep is sanitized and retried on a later tick, while a still-running sweep prevents overlapping work in one process (Task 6).

---

## File map

- Create `database/migrations/0007_b5_notifications.sql`: notification-list covering index only.
- Create `src/modules/notifications/notification.types.ts`: row, DTO, cursor, event input, and publisher interfaces.
- Create `src/modules/notifications/notification.cursor.ts`: notification-specific opaque cursor codec.
- Create `src/modules/notifications/notification.repository.ts`: owned list/read, synchronous event inserts, deadline `INSERT ... SELECT`.
- Create `src/modules/notifications/notification.service.ts`: role rules, DTO/page mapping, publisher implementation, dispatch entry point.
- Create `src/modules/notifications/notification.controller.ts`: list/read HTTP responses.
- Create `src/modules/notifications/notification.routes.ts`: auth, validation, and OpenAPI routes.
- Create `src/modules/notifications/deadline-reminder.worker.ts`: immediate run, five-minute timer, overlap guard, stop lifecycle.
- Create `tests/notifications.integration.test.ts`: API, event, dispatcher, privacy, and concurrency evidence.
- Create `tests/assessment.notification-publisher.test.ts`: assessment-to-notification publisher delegation boundary.
- Create `tests/deadline-reminder.worker.test.ts`: deterministic worker lifecycle tests.
- Modify `src/modules/assignments/assignment.service.ts` and `.routes.ts`: inject publisher and publish assignment-created events.
- Modify `src/modules/assessment/assessment.repository.ts` and `service.ts`: move grade notification SQL behind publisher.
- Modify `src/app.ts` and `src/server.ts`: compose one notification service and own worker lifecycle.
- Modify `scripts/test-api.ts`: add notification selector and default-suite registration.
- Modify database/docs READMEs and Q09 decision/status documents after behavior passes.

### Task 1: Database index and notification cursor

**Files:**
- Create: `database/migrations/0007_b5_notifications.sql`
- Create: `src/modules/notifications/notification.types.ts`
- Create: `src/modules/notifications/notification.cursor.ts`
- Create: `tests/notification.cursor.test.ts`
- Modify: `scripts/test-database.ts`

**Interfaces:**
- Consumes: existing UUID/base64url conventions and `ApiError` from `src/modules/b1/common.ts`.
- Produces: `NotificationCursor { createdAt: Date; id: string }`, `decodeNotificationCursor(value: string | undefined, scope: string): NotificationCursor | null`, and `encodeNotificationCursor(cursor: NotificationCursor, scope: string): string`.

- [ ] **Step 1: Write failing cursor and migration tests**

Add tests named:

- `round-trips a notification cursor with timestamp, id, and scope`
- `rejects malformed cursors and cursors from another scope with VALIDATION_ERROR`
- database check `notification list index matches recipient and descending cursor order`

Assert exact cursor round-trip values, `400/VALIDATION_ERROR`, and index columns/order `(recipient_id ASC, created_at DESC, id DESC)`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run tests/notification.cursor.test.ts` and `npm run db:test`.

Expected: cursor module/migration/index assertions fail because they do not exist.

- [ ] **Step 3: Implement cursor types/codec and migration**

Use strict Zod parsing for payload `{ createdAt: ISO date-time string, id: UUID, scope: exact string }`. Encode base64url JSON. Migration `0007_b5_notifications.sql` creates `notifications_recipient_created_id_idx` on `(recipient_id, created_at DESC, id DESC)` without altering data or event kinds.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the commands from Step 2.

Expected: cursor tests and database tests pass; migration rerun remains safe through the migration runner.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/0007_b5_notifications.sql scripts/test-database.ts src/modules/notifications/notification.types.ts src/modules/notifications/notification.cursor.ts tests/notification.cursor.test.ts
git commit -m "feat(notifications): add cursor and list index"
```

### Task 2: Student list and mark-read API

**Files:**
- Create: `src/modules/notifications/notification.repository.ts`
- Create: `src/modules/notifications/notification.service.ts`
- Create: `src/modules/notifications/notification.controller.ts`
- Create: `src/modules/notifications/notification.routes.ts`
- Create: `tests/notifications.integration.test.ts`
- Modify: `src/app.ts`
- Modify: `scripts/test-api.ts`

**Interfaces:**
- Consumes: Task 1 cursor codec and existing `Principal`, `paging`, `uuid`, `parse`, and auth middleware.
- Produces: `NotificationRepository.listForRecipient(recipientId, cursor, limit): Promise<NotificationRow[]>`, `markRead(recipientId, notificationId): Promise<NotificationRow | undefined>`, `NotificationService.list(principal, cursor, limit)`, `markRead(principal, notificationId)`, and `createNotificationRouter(pool, auth, service?)`.

- [ ] **Step 1: Add notification integration harness and failing list tests**

Register `--notifications` in `scripts/test-api.ts`. Test student-only access, exact DTO fields, `Cache-Control: no-store`, recipient isolation, newest-first ordering, limit/nextCursor, timestamp ties, malformed/cross-scope cursor rejection, and teacher/admin `403`.

- [ ] **Step 2: Run list tests and verify RED**

Run: `npm run api:test -- --notifications`.

Expected: `GET /api/notifications` returns 404 because the router is absent.

- [ ] **Step 3: Implement owned list repository/service/controller/routes**

Repository query uses `recipient_id=$1`, descending tuple pagination `(created_at,id)<($2,$3)`, `ORDER BY created_at DESC,id DESC`, and `LIMIT limit+1`. Service rejects non-students with `403 FORBIDDEN`, maps only OpenAPI fields, and creates the next cursor from the last returned row.

- [ ] **Step 4: Run list tests and verify GREEN**

Run the command from Step 2.

Expected: list/authorization/pagination cases pass.

- [ ] **Step 5: Write failing mark-read tests**

Test first call sets `readAt`, repeated calls preserve the identical timestamp, foreign/nonexistent IDs return `404`, and the foreign row remains unread.

- [ ] **Step 6: Run mark-read tests and verify RED**

Run: `npm run api:test -- --notifications`.

Expected: PATCH route returns 404 or lacks required behavior.

- [ ] **Step 7: Implement owned idempotent mark-read**

Use one `UPDATE ... SET read_at=COALESCE(read_at,clock_timestamp()) WHERE id=$1 AND recipient_id=$2 RETURNING ...`. Return `404 NOT_FOUND` when no owned row is returned.

- [ ] **Step 8: Run notification integration tests and commit**

Run: `npm run api:test -- --notifications` and `npm run check`.

Expected: all notification API tests and baseline checks pass.

```bash
git add src/app.ts scripts/test-api.ts src/modules/notifications tests/notifications.integration.test.ts
git commit -m "feat(notifications): add student inbox API"
```

### Task 3: Atomic assignment-created notifications

**Files:**
- Modify: `src/modules/notifications/notification.types.ts`
- Modify: `src/modules/notifications/notification.repository.ts`
- Modify: `src/modules/notifications/notification.service.ts`
- Modify: `src/modules/assignments/assignment.service.ts`
- Modify: `src/modules/assignments/assignment.routes.ts`
- Modify: `src/app.ts`
- Modify: `tests/notifications.integration.test.ts`

**Interfaces:**
- Consumes: `NotificationPublisher` injected into `AssignmentService`.
- Produces: `NotificationPublisher.assignmentCreated(db: Db, assignment: { id: string; classId: string; title: string }): Promise<number>` and deduplication key `assignment-created:<assignmentId>`.

- [ ] **Step 1: Write failing assignment-event tests**

Assert creating an assignment notifies every active enrollment with an active student account, skips inactive enrollment/account, snapshots the assignment title safely, and creates no duplicate on repeated publisher invocation.

Add a test-only failing trigger on `notifications`; assert assignment, assignment-file links, and notification rows all roll back.

- [ ] **Step 2: Run focused integration tests and verify RED**

Run: `npm run api:test -- --notifications`.

Expected: no `ASSIGNMENT_CREATED` rows and rollback probe does not reach notification insertion.

- [ ] **Step 3: Implement transaction-aware assignment publishing**

Insert with one `INSERT ... SELECT` joining active enrollments/users and `ON CONFLICT DO NOTHING`. Call publisher after assignment/file persistence and before returning from the existing create transaction. Update composition so all production assignment services receive the publisher; tests may use a no-op publisher only when notification behavior is outside their unit boundary.

- [ ] **Step 4: Run focused and assignment regression suites**

Run: `npm run api:test -- --notifications` and `npm run api:test -- --assignments`.

Expected: event, rollback, and existing assignment suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/modules/assignments src/modules/notifications tests/notifications.integration.test.ts
git commit -m "feat(notifications): publish assignment-created events"
```

### Task 4: Centralized grade-published notifications

**Files:**
- Modify: `src/modules/notifications/notification.types.ts`
- Modify: `src/modules/notifications/notification.repository.ts`
- Modify: `src/modules/notifications/notification.service.ts`
- Modify: `src/modules/assessment/assessment.repository.ts`
- Modify: `src/modules/assessment/service.ts`
- Modify: `src/app.ts`
- Modify: `tests/notifications.integration.test.ts`
- Create: `tests/assessment.notification-publisher.test.ts`
- Modify: `tests/assessment-publication.integration.test.ts`
- Modify: `tests/enrollment-publication.integration.test.ts`

**Interfaces:**
- Consumes: existing `GradeRow { id, assignment_id, revision }` and student ID inside existing assessment transactions.
- Produces: `NotificationPublisher.resultPublished(db: Db, grade: { id: string; assignmentId: string; revision: number }, studentId: string): Promise<void>` with key `grade:<gradeId>:<revision>`.

- [ ] **Step 1: Add a failing publisher-delegation test and strengthen behavior evidence**

Add a focused `AssessmentService` unit test with a publisher double asserting that
Draft save does not call `resultPublished`, while publication/correction delegates
the exact `{ id, assignmentId, revision }`, student ID, and current transaction
client. This fails until the constructor accepts the publisher. Keep integration
assertions that first publication/backfill and each Published correction create
one revision-specific row; concurrent/repeated publication does not duplicate;
notification title/body contain neither marker Draft feedback nor score.

- [ ] **Step 2: Run notification and B4 suites before refactor**

Run: `node node_modules/vitest/vitest.mjs run tests/assessment.notification-publisher.test.ts`, `npm run api:test -- --notifications`, `npm run api:test -- --assessment-publication`, and `npm run api:test -- --enrollment-publication`.

Expected: existing integration behavior passes, while the new service unit test
fails because `AssessmentService` does not yet accept/delegate to a publisher.

- [ ] **Step 3: Move grade notification SQL behind `NotificationPublisher`**

Remove `AssessmentRepository.notifyResult`. Inject publisher into `AssessmentService` and replace every existing call without changing call order or transaction boundaries. Preserve exact key format and student-safe content.

- [ ] **Step 4: Run all three suites and verify GREEN**

Run the commands from Step 2.

Expected: all pass with unchanged B4 atomicity/privacy/count evidence.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/modules/assessment src/modules/notifications tests/assessment.notification-publisher.test.ts tests/notifications.integration.test.ts tests/assessment-publication.integration.test.ts tests/enrollment-publication.integration.test.ts
git commit -m "refactor(notifications): centralize grade events"
```

### Task 5: Database-owned 24-hour deadline dispatcher

**Files:**
- Modify: `src/modules/notifications/notification.repository.ts`
- Modify: `src/modules/notifications/notification.service.ts`
- Modify: `tests/notifications.integration.test.ts`

**Interfaces:**
- Consumes: PostgreSQL `clock_timestamp()` and existing submission/grade/publication/enrollment state.
- Produces: `NotificationRepository.dispatchDeadlineReminders(): Promise<number>` and `NotificationService.dispatchDeadlineReminders(): Promise<number>`; key `deadline-reminder:<assignmentId>:<UTC deadline instant>`.

- [ ] **Step 1: Write failing eligibility/boundary tests**

Derive fixture deadlines from a database timestamp. Assert one reminder inside and exactly at the 24-hour upper boundary, none just outside, at/past deadline, or after committed submission, grade, publication, inactive enrollment, or inactive account. Assert a new deadline can create one new key, repeated/concurrent sweeps remain one row per recipient/key, and a pre-existing committed submission wins.

Also create an assignment already inside the reminder window and assert that,
after dispatch, its student has both distinct events: one `ASSIGNMENT_CREATED` and
one `DEADLINE_REMINDER`.

- [ ] **Step 2: Run dispatcher tests and verify RED**

Run: `npm run api:test -- --notifications`.

Expected: dispatcher method is missing and no reminder rows appear.

- [ ] **Step 3: Implement one-statement idempotent dispatch**

Use a CTE to capture one PostgreSQL timestamp and one `INSERT ... SELECT` with all eligibility predicates and `NOT EXISTS` submission/grade checks. Canonicalize the key deadline with PostgreSQL UTC formatting; use `ON CONFLICT(recipient_id,deduplication_key) DO NOTHING`; return inserted row count.

- [ ] **Step 4: Add accepted concurrency-race characterization**

Add a deterministic two-connection test proving a submission committed before the dispatch snapshot suppresses the reminder. Document in the test name that an uncommitted concurrent submission is intentionally not lock-coordinated; do not slow or alter submission transactions.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run api:test -- --notifications`.

Expected: all boundary, eligibility, deadline-change, idempotency, and concurrency cases pass.

```bash
git add src/modules/notifications tests/notifications.integration.test.ts
git commit -m "feat(notifications): dispatch deadline reminders"
```

### Task 6: In-process worker and clean shutdown

**Files:**
- Create: `src/modules/notifications/deadline-reminder.worker.ts`
- Create: `tests/deadline-reminder.worker.test.ts`
- Modify: `src/app.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `NotificationService.dispatchDeadlineReminders(): Promise<number>`.
- Produces: `createDeadlineReminderWorker(dispatch, options?)` returning `{ start(): void; stop(): void }`; production interval is exactly `300_000` ms.

- [ ] **Step 1: Write failing fake-timer worker tests**

Test immediate startup dispatch, one dispatch per five-minute tick, skipped tick while prior dispatch is pending, retry after rejection, sanitized error logging, and no dispatch after `stop()`.

- [ ] **Step 2: Run worker tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run tests/deadline-reminder.worker.test.ts`.

Expected: worker module is absent.

- [ ] **Step 3: Implement timer-only worker**

Keep SQL/business rules out of the worker. Inject timer functions/logger for tests, keep a per-process running guard, catch and sanitize errors, and make `start`/`stop` idempotent.

- [ ] **Step 4: Compose one notification service and lifecycle**

Allow `createApp` to receive the server-created `NotificationService`, while constructing one by default for Supertest callers. In `server.ts`, start the worker only from the successful listen callback; call `stop()` before server close/pool end on SIGINT/SIGTERM and on listen error.

- [ ] **Step 5: Run worker, app, and notification tests**

Run: `node node_modules/vitest/vitest.mjs run tests/deadline-reminder.worker.test.ts tests/app.test.ts` and `npm run api:test -- --notifications`.

Expected: worker lifecycle, infrastructure behavior, and notification integration all pass without open timer handles.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/server.ts src/modules/notifications/deadline-reminder.worker.ts tests/deadline-reminder.worker.test.ts
git commit -m "feat(notifications): schedule deadline worker"
```

### Task 7: Documentation, contract confirmation, and full verification

**Files:**
- Modify: `docs/superpowers/specs/D1-quyet-dinh.md`
- Modify: `docs/superpowers/specs/D1-database.md`
- Modify: `docs/superpowers/specs/D1-erd.md`
- Modify: `src/modules/README.md`
- Modify: `README.md`
- Modify: `database/migrations/README.md`
- Modify: `docs/superpowers/README.md`
- Modify: `tests/contract.test.ts` only if a test is needed to pin unchanged notification schemas/paths.

**Interfaces:**
- Consumes: all prior task behavior and the approved design.
- Produces: Q09 decision record, worker runbook, migration/index documentation, and final verification evidence.

- [ ] **Step 1: Update durable documentation**

Record one reminder per recipient/current deadline in the final 24 hours, the selected in-process worker, PostgreSQL clock ownership, no announcement scope, at-least-one-running-API requirement, migration `0007`, and the module's implemented status. Do not manually edit generated diagrams.

- [ ] **Step 2: Confirm public contract remains unchanged**

Run: `npm run api:validate` and `node node_modules/vitest/vitest.mjs run tests/contract.test.ts`.

Expected: current notification paths/schemas validate without adding endpoints, kinds, or response fields.

- [ ] **Step 3: Run focused static and database checks**

Run: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run db:test`, and `npm run api:test -- --notifications`.

Expected: all pass with no warnings/errors attributable to B5.

- [ ] **Step 4: Run publication regressions**

Run: `npm run api:test -- --assessment-publication`, `npm run api:test -- --enrollment-publication`, and `npm run api:test -- --assignments`.

Expected: all pass with existing B1–B4 atomicity/privacy behavior preserved.

- [ ] **Step 5: Run complete verification**

Run: `npm run check` and `npm run api:test`.

Expected: unit/static/build suite passes; every API integration file passes and every temporary database is removed.

- [ ] **Step 6: Review diff and commit documentation/evidence**

Run: `git diff --check`, `git status --short`, and inspect the complete branch diff for auth, privacy, transactions, cursor boundaries, worker shutdown, and unrelated changes.

```bash
git add README.md database/migrations/README.md docs/superpowers src/modules/README.md tests/contract.test.ts
git commit -m "docs(notifications): record B5 delivery"
```

