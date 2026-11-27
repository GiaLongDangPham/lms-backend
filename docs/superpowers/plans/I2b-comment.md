# I2b Comment Integration Implementation Plan

> Execute directly with superpowers:executing-plans; no sub-agents.

**Goal:** Prove F6/B6 shared discussion and deliver reproducible deployment files.
**Architecture:** Existing assignment discussion; Docker/Nginx same-origin deployment.
**Tech Stack:** Express/React/PostgreSQL/S3-compatible, Node 22, Nginx, Docker Compose.
**Spec:** `docs/superpowers/specs/I2b-comment.md`

## Global Constraints

Stacked task branches, task-prefixed docs/commits; no direct develop merge.
No secrets or project DB mutation; no staging completion claim without real URL.

## Review Focus

Cross-class/role access, text escaping, comments after publication, SPA deep links,
proxy cookie/CORS, migration-before-start and private object bucket.

## Task 1: Contract/docs and acceptance

Files: BE OpenAPI, B6 spec/plan/README; FE browser harness/README.
- [x] Run real browser `integration-acceptance.mjs I2b`; shared comments/reload/GV/peer/outsider pass.
- [x] Align contract Q09 descriptions with actual private submission authorization;
  keep F6 scope at assignment comments approved in TestCase 19/11.
- [x] BE comments 9/9; contract parser and full regression remain green.

## Task 2: Deployment package

Files: BE/FE Dockerfiles/.dockerignore, FE deploy nginx, BE deploy compose/env/readme.
- [x] Multi-stage Node 22 builds; FE /api proxy + SPA fallback; no secrets in VITE vars.
- [x] Compose postgres + private MinIO + bucket init + migration + API + UI.
- [x] Compose config validated with synthetic env; Docker daemon unavailable, image build/run not claimed.
- [x] Document TLS, credentials generation, migration/rollback, readiness and smoke acceptance.

## Task 3: Verify and push

- [x] Run check/build both repos, comments/contract verification and diff check before commits.
- [x] Record actual evidence and outstanding external deployment, self-review all files.
- [x] Commit and push both I2b task branches, preserving I2a base relationship.

## Ledger

- User says staging not deployed; deliver configuration, do not invent a deployment target.
- Prior I2a local acceptance 4 groups and API/DB/FE suites green; reusable harness is real network.

## Evidence 21/11/2026

Real FE/API browser I2b: 5/5 groups pass, no pageerror; persistence, shared assignment
comments before/after publication, HTML-like body rendered as plain text, peer and GV
see same discussion, outsider GET 404. BE check 39 unit, focused comments 9/9, FE check
81 tests + builds/lint/types pass. OpenAPI parser/structural validation passes.
`docker compose -f deploy/compose.yaml config --quiet` passes with synthetic variables.
Docker Desktop Linux engine is not running (named pipe missing); image build/run and
external staging are NOT verified. User has no deployed target. Deployment files/runbook
are reviewable; actual TLS/domain/server provisioning, image pulls and acceptance remain.
Self-review: private bucket, non-exposed DB/storage/API ports, secure cookie, SPA fallback,
no secrets committed. Deployment uses root MinIO identity only for isolated staging;
runbook requires bucket-scoped credentials for shared/production storage.
