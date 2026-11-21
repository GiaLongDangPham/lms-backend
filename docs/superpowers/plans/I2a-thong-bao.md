# I2a Notification Integration Implementation Plan

> Execute directly with superpowers:executing-plans, no sub-agents per user preference.

**Goal:** Verify B5/F5 integration and fix Bug-09 notification context/unread menu.
**Architecture:** Existing SQL event transactions and React session-scoped unread badge.
**Tech Stack:** Node 22, pg/PostgreSQL 17, Express, React, Vitest, browser acceptance.
**Spec:** `docs/superpowers/specs/I2a-thong-bao.md`

## Global Constraints

Task-prefixed branches/docs/commits. Preserve contract/security and applied migrations.
Spec/plan before code. User authorizes commit and push task branches; do not merge develop.
No staging exists: record local acceptance and exact remaining deployment gate.

## Review Focus

Draft privacy; recipient isolation; context from correct class; UTC+7 independent host;
stale user callbacks on logout; marking read synchronizes sidebar without reload.

## Task 1: Notification context RED/GREEN

Files: `tests/notifications.integration.test.ts`,
`src/modules/notifications/notification.repository.ts`.
Consumes existing B5 publisher; preserves public DTO and dedup keys.
- [x] Add real API/DB assertions for assignment and grade event context and deadline.
- [x] Focused runner fails because context is absent; record failure.
- [x] Parameterized SQL reads title/class/deadline in event transaction, formats VN time.
- [x] Focused tests pass; run backend check and API suite before commit.

## Task 2: Unread menu + true frontend integration

Files: FE notifications client, student layout, badge component and browser harness.
Consumes listAllMyNotifications/markNotificationRead; no endpoint changes.
- [x] Browser reproduction: actual SV login/sidebar must show unread count; fails first.
- [x] Implement badge refresh per route/focus/read event and session cleanup.
- [x] Browser proves assignment notification, mark read/persist and isolated accounts.
- [x] FE check passes; self-review auth/async behavior; commit FE with [I2a] prefix.

## Task 3: Verification and delivery

- [x] Run complete BE/FE check, full API, DB and OpenAPI validation; inspect outputs.
- [x] Record acceptance scripts/log summary and deployment prerequisites in plan/README.
- [x] Review diffs, git diff --check, commit then push both task branches.

## Ledger

- Baseline fresh checks from audit: BE 39 unit, 94 API, 21 DB; FE 81, build/lint pass.
- User requests autonomous implementation after spec/plan: no extra design approval round.
- Working in requested task branches in clean existing checkout, no extra worktree.
- Deployment pending: user confirmed no environment is deployed yet; no invented staging URL.

## Evidence 21/11/2026

- RED notification body assertion failed before context implementation; GREEN 11/11 notifications.
- Browser badge mutation (badge removed) failed waiting for sidebar count; restored implementation passed.
- `npm run check`: BE 39 unit + build/lint/typecheck; FE 81 + build/lint, no warnings.
- Full API 94/94; database 21/21; OpenAPI 34 paths/48 operations valid.
- Real browser 4/4 groups: creation context, deadline dedup/recipient isolation,
  publication context, sidebar unread/read/reload. No pageerror; screenshot visually inspected.
- Reusable harness FE `scripts/integration-acceptance.mjs`, artifacts `.acceptance/I2a-*` (ignored).
- Self-review: SQL user values parameterized; snapshots stay in event transaction;
  badge cancels stale session requests and does not turn failed reads into zero.
- Local runtime is Node 26.13.1 (host changed since initial audit); CI remains Node 22 via .nvmrc.
  Do not claim Node 22 remote CI results from local run.
- User confirms staging not deployed. This task is implementation/local integration complete;
  deployment acceptance remains pending, not a closed staging milestone.
