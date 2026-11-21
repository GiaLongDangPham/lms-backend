# T4 System Regression Implementation Plan

> Execute directly with superpowers:executing-plans; no sub-agents.

**Goal:** Fix QA 19/11 blockers and prove integrated regression before push.
**Architecture:** Extend existing assignment/assessment HTTP boundaries and FE flows.
**Tech Stack:** Express/pg/PostgreSQL/React, Vitest, browser acceptance.
**Spec:** `docs/superpowers/specs/T4-system-test.md`

## Global Constraints

Task-prefixed branches/docs/commits; no develop merge; no project DB/tracker writes.
Preserve applied migrations, auth, Draft privacy, file safety and immutable history.
Q2 approved 19/11 overrides older no-late-resubmission documentation.

## Review Focus

Late resubmission after Draft/publication stays denied; creation deadline uses server;
SV direct form cannot bypass Published lock; teacher aggregate does not leak Draft to
SV/outsiders; historical versions and author/provenance remain truthful.

## Task 1: Backend regression RED/GREEN

Files: assignments integration/service, assessment service/repository/routes/controller,
tests contract/client rules, OpenAPI/mock.
- [ ] Write failing late-version/creation-deadline/aggregate/privacy tests first; record RED.
- [ ] Implement Q2/deadline and teacher grade list, PublishedGrade gradedBy.
- [ ] Update contract and old test expectations to new approved behavior, preserving boundaries.
- [ ] Focused API and all static/unit tests pass; full API DB later.

## Task 2: Frontend bugs and browser acceptance

Files: grades/assignments clients + tests, GV grading/list, SV detail/form/result, LoginPage,
scripts/integration-acceptance.mjs.
- [ ] Add focused gradebook tests and browser failing checks for QA bugs.
- [ ] GV grade aggregate + complete version list with files; no per-student history fanout.
- [ ] Published result blocks detail/form submission; Vietnamese lock errors; public grader/history.
- [ ] Creation validation in form and remove demo password. Existing grade precision stays tested.
- [ ] Browser retest mapped QA cases, no pageerror, mobile layout and visual evidence.

## Task 3: Final verification/review/delivery

- [ ] Run backend/frontend check, full API, DB, contract/mock, compose config, browser acceptance.
- [ ] Separate final self-review of diff against spec/security and all QA issue mappings.
- [ ] Record actual counts, evidence and incomplete external gates; no fake QA closure.
- [ ] Commit and push both T4 branches; verify remote SHAs and clean working trees.

## Ledger

- Stacked on I2b (BE bf24fe2, FE e05530f); all I2a/I2b local checks green.
- User confirms no deployment: local integration and prepared deploy package only.
- Self-review replaces reviewer sub-agent per user's no-sub-agent preference.
