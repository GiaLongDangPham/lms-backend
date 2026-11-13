# B5 In-App Notifications Design

**Date:** 13/11/2026  
**Owner:** Nam  
**Status:** Proposed for approval

## Intent

Implement the existing D2 in-app notification contract for students without
expanding B5 into teacher-authored announcements, email, push notifications,
websockets, comments, or frontend work. Students receive durable notifications
when an assignment is created, when an unsubmitted assignment enters its final
24 hours, and when a result is published or corrected. They can list only their
own notifications and mark one owned notification read.

The design reuses the existing `notifications` table and OpenAPI operations:

- `GET /api/notifications`
- `PATCH /api/notifications/{notificationId}/read`
- `ASSIGNMENT_CREATED`, `DEADLINE_REMINDER`, and `GRADE_PUBLISHED`

## Goals

- Keep notification creation atomic with the business event when the event is
  synchronous: assignment creation and grade publication/correction.
- Dispatch one deadline reminder per student and current assignment deadline
  when the assignment first falls within the final 24-hour window.
- Make every producer retry-safe and safe under concurrent API instances.
- Enforce recipient ownership at the database query boundary.
- Preserve student privacy: never include Draft scores, Draft feedback, or
  another student's data in notification content or API responses.
- Return stable, deterministic cursor pagination newest first.
- Keep background scheduling out of `createApp` so HTTP tests do not start
  timers and process lifecycle stays in `server.ts`.

## Non-goals

- Teacher/admin-authored announcements or an `ANNOUNCEMENT` kind.
- Email, mobile push, browser push, websocket/SSE delivery, unread counters, or
  notification deletion.
- A teacher/admin notification inbox.
- Reminder preferences, snoozing, repeated reminders, or configurable reminder
  windows.
- Backfilling `ASSIGNMENT_CREATED` for students enrolled after an assignment was
  created. Those students discover existing work through the assignment list.
- Changing score publication, submission, enrollment, or assignment contracts.

## Existing constraints and sources of truth

- OpenAPI currently restricts both notification endpoints to `STUDENT` and
  defines the response fields and three event kinds.
- Migration `0001` already stores recipient, optional assignment, kind, title,
  body, deduplication key, read timestamp, and creation timestamp, with unique
  `(recipient_id, deduplication_key)`.
- `AssessmentRepository.notifyResult` already creates deduplicated
  `GRADE_PUBLISHED` rows inside publication/correction transactions.
- Assignment creation is transactional, but currently has no notification
  producer.
- The process has no scheduler lifecycle yet. `server.ts` owns listen/shutdown;
  `createApp` only composes HTTP behavior.
- Applied migrations `0001` through `0006` are immutable.

## Approaches considered

### 1. In-process periodic worker — selected

Run an idempotent deadline sweep once at server startup and every five minutes.
Database uniqueness makes concurrent server instances safe.

This fits the current single-service deployment, requires no new infrastructure,
and creates reminders even when students do not open the application. Its main
trade-off is that reminders depend on at least one API process running. The
startup sweep catches missed work after a restart as long as the deadline has
not passed.

### 2. Separate command invoked by cron

This isolates scheduling from the API and scales cleanly, but the repository has
no cron deployment contract. Shipping it now would require an additional
operational dependency and could leave a correct command that staging never
invokes.

### 3. Lazy generation during `GET /notifications`

This needs no process scheduler, but a reminder would not exist until the
student opens the inbox. It does not satisfy proactive in-app notification
semantics and was rejected.

## Module boundaries

Create `src/modules/notifications/` with these responsibilities:

- `notification.repository.ts`: parameterized notification list/read queries,
  recipient selection, idempotent event inserts, and deadline candidate sweep.
- `notification.service.ts`: student-only access, DTO mapping, pagination,
  assignment/result event publishing, and one deadline-dispatch operation.
- `notification.controller.ts`: HTTP response shaping only.
- `notification.routes.ts`: authentication, changed-password enforcement, UUID
  and paging validation, `Cache-Control: no-store`, and the two OpenAPI routes.
- `deadline-reminder.worker.ts`: timer lifecycle and overlap prevention. It calls
  the service; it contains no SQL or business eligibility rules.

Define a small cross-module interface, for example `NotificationPublisher`, with
transaction-aware methods that accept the existing `PoolClient`/`Db`:

- `assignmentCreated(db, assignment): Promise<number>`
- `resultPublished(db, grade, studentId): Promise<void>`

`AssignmentService` and `AssessmentService` receive this publisher by dependency
injection from `app.ts`. Notification writes therefore remain in the same
transaction as their source event without assignment/assessment repositories
owning notification SQL. Existing grade notification behavior is moved behind
this interface without changing its deduplication semantics.

`NotificationService.dispatchDeadlineReminders()` is also reusable directly
from tests. PostgreSQL supplies one timestamp to the dispatch statement and is
the only eligibility clock, so application clock skew cannot change who receives
reminders. Boundary integration tests derive fixture deadlines from a database
timestamp; unit tests cover the SQL boundary predicates without injecting an
application clock into production behavior.

## Event rules

### Assignment created

After the assignment and its files are successfully persisted, but before the
transaction commits:

1. Select active students with active user accounts in the assignment's class.
2. Insert one `ASSIGNMENT_CREATED` notification per recipient.
3. Use deduplication key `assignment-created:<assignmentId>`.
4. Snapshot a student-safe title/body that identifies the assignment but contains
   no private data.
5. If recipient selection or insertion fails, roll back the assignment creation
   and file attachment with it.

Students enrolled later do not receive a historical assignment-created event.
Retrying or concurrent execution cannot duplicate rows.

An assignment created with a deadline already inside the final 24-hour window
produces both distinct events: `ASSIGNMENT_CREATED` in the create transaction and
`DEADLINE_REMINDER` on the next successful sweep.

### Deadline reminder

On startup and every five minutes, dispatch for assignments satisfying all of:

- `deadline_at > database_now`
- `deadline_at <= database_now + interval '24 hours'`
- results have not been published
- recipient enrollment and user account are active
- the recipient has no submission for the assignment
- the recipient has no grade for the assignment

Insert one `DEADLINE_REMINDER` for each eligible recipient with deduplication key
`deadline-reminder:<assignmentId>:<deadline-at-instant>`. The deadline instant is
canonicalized by PostgreSQL in UTC before key construction.

Consequences of a deadline edit are intentional:

- Moving a deadline before it enters the window delays the reminder until the new
  final 24 hours.
- Extending a deadline after a reminder allows one new reminder for the new
  deadline when it enters its final 24 hours.
- Shortening a deadline into the window causes the next sweep to send a reminder.
- A passed deadline never receives a late reminder.
- Eligibility is evaluated once using the statement's PostgreSQL snapshot. A
  submission already committed before that snapshot suppresses the reminder. A
  submission that commits concurrently may race and the reminder may still be
  inserted; this harmless edge is accepted instead of coordinating locks with the
  latency-sensitive submission transaction.

The dispatch remains one `INSERT ... SELECT`, rather than selecting recipients in
application code and inserting later, so every recipient is judged against one
database snapshot and timestamp.

The sweep is idempotent and may run concurrently. Unique recipient/key handling
uses `ON CONFLICT DO NOTHING`; duplicate attempts are expected, not errors.

### Grade published or corrected

Preserve current B4 behavior:

- Draft save creates no notification.
- Initial publication, automatic-zero backfill, and each Published correction
  create a `GRADE_PUBLISHED` notification in the same transaction.
- Deduplication remains revision-specific: `grade:<gradeId>:<revision>`.
- Title/body say a result is available or updated but contain no score or feedback.

## Read API

### List

`GET /api/notifications?limit=20&cursor=...` is student-only and selects
`recipient_id = principal.user.id`. Order is deterministic:

```text
created_at DESC, id DESC
```

The opaque cursor contains `{ createdAt, id, scope }`, where scope is the caller's
notification list. The next page predicate is the descending tuple comparison
`(created_at, id) < ($createdAt, $id)`. A cursor for another scope or malformed
cursor returns the existing `400 VALIDATION_ERROR` shape.

The DTO exactly follows OpenAPI: `id`, `kind`, nullable `assignmentId`, `title`,
`body`, nullable `readAt`, and `createdAt`. No recipient ID or deduplication key is
returned.

Migration `0007_b5_notifications.sql` adds a matching index on
`(recipient_id, created_at DESC, id DESC)`. It does not rewrite existing rows or
change the event-kind check constraint.

### Mark read

`PATCH /api/notifications/{notificationId}/read` updates only the row matching
both notification ID and the authenticated student's recipient ID:

```text
read_at = COALESCE(read_at, database_now)
```

The operation is idempotent: repeated calls return the original `readAt` rather
than changing it. A missing or foreign-owned ID returns `404 NOT_FOUND`, preventing
resource-existence disclosure. Teacher and admin callers receive `403 FORBIDDEN`;
unauthenticated callers retain `401` from auth middleware.

## Worker lifecycle and failure handling

- `server.ts` constructs and starts the worker only after the HTTP server has
  successfully started.
- The worker runs immediately, then schedules every five minutes.
- A per-process `running` guard skips a tick if the previous sweep is still active.
- A sweep failure logs one sanitized error without notification contents,
  recipients, SQL, or credentials; it does not terminate the API and the next tick
  retries.
- The interval is cleared during SIGINT/SIGTERM before closing the database pool.
- Tests use an injected timer driver or call one sweep directly; no test waits
  five minutes. Eligibility time itself remains database-owned.
- Multiple API processes are supported by database deduplication, not by a
  process-global distributed lock.

## Composition changes

- `app.ts` constructs one notification repository/service, injects its publisher
  into assignment and assessment services, and mounts the notification router.
- `createAssignmentRouter` must accept an already-composed `AssignmentService` (or
  the publisher dependency) rather than silently constructing a service that
  cannot publish events.
- `server.ts` receives the notification service/worker through a composition
  helper shared with `app.ts`, avoiding a second independent service graph.
- `createApp` remains timer-free and deterministic for Supertest.

The exact composition helper structure is left to the implementation plan, but
there must be one pool and one notification service graph per app process.

## Data integrity and concurrency

- All event inserts use parameterized SQL.
- Synchronous event notifications share their source transaction.
- The existing unique constraint remains the final duplicate guard.
- Deadline eligibility is rechecked inside the insert statement.
- Listing and marking read always include recipient ownership in SQL; authorization
  is not enforced by filtering a result after retrieval.
- No migration modifies `0001` through `0006`.
- Notification content is a historical snapshot and is not updated when an
  assignment title or deadline later changes.

## Testing strategy

Add focused unit tests for cursor encoding/decoding, DTO mapping, worker immediate
run/interval/overlap/shutdown, and sanitized failure continuation.

Add a dedicated PostgreSQL integration suite covering:

- student-only list access and `Cache-Control: no-store`
- recipient isolation and foreign-ID `404`
- newest-first stable pagination with tied timestamps
- first and repeated mark-read calls preserving the same timestamp
- assignment creation atomically notifying only active enrollment/user pairs
- assignment rollback when notification insertion fails
- one reminder inside the 24-hour boundary and none just outside, at, or after the
  deadline as specified
- no reminder after submission, grade, publication, inactive enrollment, or
  inactive account
- deadline extension/shortening behavior and deadline-specific deduplication
- concurrent/repeated sweeps creating one row per recipient/key
- startup sweep recovery and worker non-overlap using fake timers around the real
  dispatch service
- Draft grade privacy and unchanged B4 publication/correction notification counts

Teach `scripts/test-api.ts` a `--notifications` selector and include the suite in
the default API integration run. Extend contract tests only where implementation
exposes a mismatch; the public OpenAPI paths and schemas should not change.

Before handoff run lint, typecheck, unit tests, build, migration/database checks,
the notification integration selector, the existing assessment/enrollment
publication suites, and the full API test command.

## Documentation updates during implementation

- Mark Q09's reminder decision as: one in-app reminder per recipient and current
  deadline during the final 24 hours; no repetition for the same deadline.
- Update the module README and root README status/runbook.
- Document worker lifecycle and the fact that at least one API process must remain
  running for reminders.
- Update ERD/index documentation for migration `0007`; do not edit generated
  diagrams manually unless their documented generation workflow is run.

## Acceptance criteria

- The two existing OpenAPI notification operations are implemented without a
  contract expansion.
- All three existing event kinds are produced according to the rules above.
- Students cannot observe or modify another recipient's notification.
- No Draft grade value or feedback can reach notification storage or responses.
- Assignment/result writes and their synchronous notifications commit or roll back
  together.
- Reminder dispatch is automatic, retry-safe, deadline-specific, and operationally
  stopped during shutdown.
- Existing B1–B4 behavior and tests remain green.

