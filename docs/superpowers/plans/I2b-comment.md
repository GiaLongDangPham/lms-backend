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
- [ ] Run real browser `integration-acceptance.mjs I2b`; shared comments/reload/GV/peer/outsider pass.
- [ ] Align contract Q09 descriptions with actual private submission authorization;
  keep F6 scope at assignment comments approved in TestCase 19/11.
- [ ] BE comments 9/9; contract parser and full regression remain green.

## Task 2: Deployment package

Files: BE/FE Dockerfiles/.dockerignore, FE deploy nginx, BE deploy compose/env/readme.
- [ ] Multi-stage Node 22 builds; FE /api proxy + SPA fallback; no secrets in VITE vars.
- [ ] Compose postgres + private MinIO + bucket init + migration + API + UI.
- [ ] Validate compose config with synthetic env. Build/run images if Docker daemon available.
- [ ] Document TLS, credentials generation, migration/rollback, readiness and smoke acceptance.

## Task 3: Verify and push

- [ ] Run check/build both repos, comments/contract verification and diff check before commits.
- [ ] Record actual evidence and outstanding external deployment, self-review all files.
- [ ] Commit and push both I2b task branches, preserving I2a base relationship.

## Ledger

- User says staging not deployed; deliver configuration, do not invent a deployment target.
- Prior I2a local acceptance 4 groups and API/DB/FE suites green; reusable harness is real network.
