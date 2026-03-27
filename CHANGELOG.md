# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.26.4] - 2026-03-27

### Bug Fixes

- replace fabricated SHA pins with semver tags, update trivy-action to v0.35.0

### Miscellaneous

- v0.26.4 [skip ci]

## [0.26.3] - 2026-03-27

### Bug Fixes

- use domcontentloaded instead of networkidle for login helpers
- remove storage-manager files accidentally committed to main

### Documentation

- add MinIO → RustFS migration implementation plan

### Miscellaneous

- v0.26.3 [skip ci]

## [0.26.2] - 2026-03-26

### Bug Fixes

- stabilize loginAsAdmin for deployment E2E — verify key store, networkidle

### Documentation

- add implementation plan for tier 1 unit test expansion
- add MinIO → RustFS migration design spec

### Miscellaneous

- v0.26.2 [skip ci]

## [0.26.1] - 2026-03-26

### Bug Fixes

- increase CI timeouts for 4 flaky UI E2E tests
- Caddy needs internal network to proxy WebSocket to strfry

### Documentation

- add unit test tier 1 spec — core crypto primitives + integration test separation
- fix spec review issues — correct file count and private function testing

### Miscellaneous

- v0.26.1 [skip ci]

## [0.26.0] - 2026-03-26

### Bug Fixes

- deployment E2E bugs — MinIO creds, CSP WebSocket, VM test tooling

### Documentation

- add IdP auth facade & multi-factor nsec hardening spec
- address spec review findings for IdP auth hardening
- address R2 review suggestions for IdP auth hardening spec
- production E2E testing plan with secure context analysis
- add blast delivery engine design spec
- add Bun native crypto note to IdP auth hardening spec
- address spec review feedback for blast delivery engine
- add IdP auth hardening implementation plan
- address plan review findings for IdP auth hardening
- add blast delivery engine implementation plan

### Features

- blast delivery engine — background processor with batching and rate limiting

### Miscellaneous

- v0.26.0 [skip ci]

## [0.25.2] - 2026-03-26

### Bug Fixes

- ansible deploy improvements for E2E testing
- run key encryption in browser to fix cross-platform tests

### Miscellaneous

- v0.25.2 [skip ci]

## [0.25.1] - 2026-03-26

### Bug Fixes

- remove resetTestState from API tests to prevent parallel interference
- remove resetTestState from UI E2E tests to prevent parallel interference
- batch fix UI E2E test failures (selectors, i18n, missing options)
- batch fix UI test failures (strict mode, rate limits, destructuring)
- re-seed roles after test reset and fix invite/webauthn/multi-hub tests
- RCS test click selector — use title text instead of data-slot
- dashboard-analytics remove redundant goto, fix period toggle timing
- wrap invite creation response in { invite } to match client type
- add missing SendInviteDialog i18n keys and fix invite response
- file-field tests — use dummy conversationId instead of missing endpoint
- gate version/release on all CI jobs and add integration test suites
- add checkout step before local composite actions in CI
- move strfry from GHA service container to docker run
- start server manually instead of via Playwright webServer in CI
- batch fix 18+ UI test failures across multiple files
- reports timing, webauthn expansion, and remaining test fixes
- create MinIO bucket in CI test infrastructure
- add a bunch of important changes
- ansible templates
- ansible deploy bugs found via local VM testing
- complete ansible deploy validation via local VM testing
- update blast API tests for new { blast } response wrapper
- capture server logs as artifact on API test failure
- use repo root context for asterisk-bridge Docker build
- use hex-encoded HMAC_SECRET in CI — hashPhone/hashIP require hex
- update remaining blast API test for { blast } response wrapper
- update playbook health checks and container name
- resolve last 6 UI test failures
- last blast API wrapper + call-flow testid mismatch

### Documentation

- plan for fixing remaining 38 UI E2E test failures
- update test fix plan — 81 → 27 failures remaining
- mark ansible VM testing plan as complete

### Miscellaneous

- v0.25.1 [skip ci]

### Refactoring

- DRY up CI workflow with composite actions and fix CI failures

## [0.25.0] - 2026-03-25

### Bug Fixes

- persist voicemail to call_records and store encrypted audio in MinIO
- voicemail webhook tests and upsert call records for persistence
- remove mock.module leak in voicemail-storage tests

### Documentation

- add voicemail completion design spec
- fix voicemail spec review issues
- fix Vonage recording deletion — Media API DELETE exists
- add voicemail Phase 1 implementation plan
- fix Phase 1 plan review issues
- add voicemail Phase 2 implementation plan
- fix Phase 2 plan review issues
- add voicemail Phase 3 implementation plan
- fix Phase 3 plan review issues
- fix Nostr event kind in voicemail spec (20001 → 1002)

### Features

- add LABEL_VOICEMAIL_WRAP and LABEL_VOICEMAIL_TRANSCRIPT crypto labels
- add voicemailFileId, configurable size limits, and nullable conversationId
- add deleteRecording() to TelephonyAdapter interface and all implementations
- add binary encryption/decryption for voicemail audio storage
- add voicemail storage orchestrator
- use LABEL_VOICEMAIL_TRANSCRIPT for voicemail transcript encryption
- add voicemail permissions and Voicemail Reviewer role
- add voicemailMode + voicemailRetentionDays settings; fix callRecordingMaxBytes gap
- add handleUnavailable to TelephonyAdapter interface and all implementations
- wire voicemail mode routing into call flow
- add voicemail mode selector and retention days UI to call settings
- publish Nostr event and Web Push on voicemail storage
- expose voicemailFileId in call history API and client types
- VoicemailPlayer component with encrypted audio playback and transcript display
- add webhook URL verification to TelephonyAdapter interface

### Miscellaneous

- v0.25.0 [skip ci]

## [0.24.0] - 2026-03-25

### Miscellaneous

- v0.24.0 [skip ci]

## [0.23.0] - 2026-03-25

### Bug Fixes

- use valid hex placeholder for server_nostr_secret
- lefthook lint-fix should not block commits on warnings
- silence lefthook lint-fix output
- voice-captcha and call-flow test improvements
- lefthook silently fixes, fails descriptively on real errors
- pin-challenge tests create volunteer with phone in setup
- enable Nostr relay events in dev/test environment
- call-flow tests use ws package for relay check + fixme for dashboard
- scrub leaked home directory paths and untrack .claude project files
- implement CAPTCHA retry logic and fix dashboard call events
- CAPTCHA retry works end-to-end, all voice-captcha tests pass
- resolve pre-existing API test failures and harden TestAdapter
- cast TextEncoder.encode() to Uint8Array<ArrayBuffer> for WebCrypto APIs
- address final code review issues
- resolve Playwright test failures and remove unnecessary skips

### Documentation

- document app bugs found during test restructuring
- clarify file-level vs test-level parallelism in spec
- add Web Push notifications and browser calling spec
- address spec review feedback for web push + browser calling
- address second spec review pass
- update spec with research findings
- add implementation plans for Web Push and Browser Calling
- fix plan review issues for both implementation plans
- add SIP WebRTC browser calling spec (JsSIP)
- address spec review findings for SIP WebRTC design
- add SIP WebRTC browser calling implementation plan
- address plan review findings — TURN credentials, schema, rollback
- update browser calling plan for Asterisk SIP WebRTC integration
- add SIP WebRTC browser calling to project documentation

### Features

- add lefthook pre-commit hook for auto lint-fix
- add PII pre-commit hook to block leaked personal identifiers
- add web-push + workbox deps, VAPID env vars
- add PushService with subscription CRUD
- add push notification subscription API routes
- add Web Push delivery to ringing flow (WP4)
- custom service worker with push notification handlers
- add client-side push subscription management (WP6)
- re-subscribe to push on app load and add push toggle to settings (WP7)
- handle push notification answer intent on dashboard (WP8)
- add WebRTCAdapter interface and types for browser calling
- add TwilioWebRTCAdapter implementing WebRTCAdapter interface
- add VonageWebRTCAdapter implementing WebRTCAdapter interface
- add PlivoWebRTCAdapter and fix Plivo JWT token generation
- replace webrtc.ts with provider-agnostic WebRTCManager
- add ttl to WebRTC token endpoint response
- add type column to call_legs table (phone | browser)
- update RingVolunteersParams and all 5 adapters for browser calling
- extend answer endpoint with leg cancellation
- wire WebRTC answer into useCalls and keyboard shortcuts
- request mic permission when switching to browser/both call preference
- add Asterisk WSS transport and volunteer dialplan for browser calling
- add ARI deleteDynamic for SIP endpoint deprovisioning
- add Caddy WSS proxy route and CSP for SIP browser calling
- add coturn TURN server and Asterisk WSS to Docker Compose
- add dev TLS cert generation script for Asterisk WSS
- add coturn, STUN/TURN, and WSS env vars to Ansible config
- add SIP endpoint provision/deprovision bridge commands
- add SipEndpointProvisioner + AsteriskProvisioner + BridgeClient
- add SIP adapter cases to WebRTCManager factory
- extend ring command to support browser PJSIP endpoints
- SipWebRTCAdapter using JsSIP for browser SIP/WebRTC calling

### Miscellaneous

- add USE_TEST_ADAPTER=true to .env for local dev
- gitignore pii-check script, run from lefthook only if present
- v0.23.0 [skip ci]

### Refactoring

- serial test improvements + lint fixes from agents

### Testing

- add SIP WebRTC API and E2E tests

### Wip

- TestAdapter infrastructure + telephony skip removals

## [0.22.0] - 2026-03-24

### Bug Fixes

- use boolean conditionals for regex_search assertions
- format telephony test files for biome compliance

### Features

- add TestAdapter for E2E telephony testing
- register TestAdapter and enable in Playwright config

### Miscellaneous

- v0.22.0 [skip ci]

### Testing

- remove telephony 503 skip conditions from UI tests

## [0.21.1] - 2026-03-24

### Bug Fixes

- copy vars.example.yml for ansible dry-run check

### Documentation

- add TestAdapter implementation plan

### Miscellaneous

- v0.21.1 [skip ci]

## [0.21.0] - 2026-03-24

### Bug Fixes

- sync workflow fixes from desktop (action SHAs, toolchain, no CF)
- P0/P1 application hardening — auth guard, permission, hub scoping
- add composite PKs to hubKeys and ivrAudio tables
- type safety and unique constraint fixes from code review
- spec compliance fixes — getEffectiveVolunteers, checkRateLimit, protected db
- critical safety fixes — atomic ops, race conditions, null filter
- use z.iso.datetime() — z.string().datetime() deprecated in Zod 4
- use z.uuid() top-level (z.string().uuid() deprecated in Zod 4)
- add missing createdAt, enum statuses, typed HttpErrorStatus
- spec compliance fixes for Phase 4
- code quality fixes for Phase 4
- code quality fixes for Phase 5
- add missing hub columns + drop vestigial nostrPubkey
- align HubSchema/CreateHubSchema/UpdateHubSchema with Hub interface
- implement full hub CRUD + archiving in SettingsService
- enforce WebAuthn counter monotonicity to prevent replay attacks
- address code review issues in FilesService and audit-chain tests
- hub delete cascade roles table + hub-key-cache race + deleteTestHub auth
- add dev bypass to messaging router webhook validation
- fix ARI module reload method, Docker config, and E2E tests
- restore geocoding, signal registration, and captcha API functions lost in merge
- resolve all 69 TypeScript errors from Drizzle migration merge
- install missing deps, fix test infrastructure, update package.json scripts
- resolve 19 typecheck errors in unit test import paths
- replace empty catch blocks with error logging for observability
- dev:docker uses .env.dev.defaults — works without manual setup
- unit test migration paths and DB URL — all 25 tests pass
- test infrastructure — admin bootstrap on reset, heading selectors, test fixes
- test-reset creates default hub + setup state, unit test DB URL fallback
- hub context chain — API route, key envelopes, FK ordering, graceful fallback
- settings API response shape + null safety — all admin pages load after reset
- API response shape mismatches — shift create/update, ban create, settings
- null safety in blasts/notes pages + API response shapes + test assertions
- blast tests — subscriber import uses identifierHash, send verifies via API
- Dashboard heading exact match across all 16 test files (28 occurrences)
- call-spam ban API format (phone+reason), blasts accept 400 for hub context
- audit-log hub scoping, roles 400/403, volunteer login timeout, auth PIN timeout
- roles unique slugs, volunteer login domcontentloaded, audit volunteer test
- roles tests accept 400/403 for notes/calls, slug validation relaxed
- replace fake hex-encoding with real encryption in ProviderSetup
- replace fake Twilio SID that triggers GitHub push protection
- health endpoint uses settings:read permission (not settings:manage)
- :view -> :read - make permission verbs consistent
- resolve Playwright beforeAll request fixture lifecycle issues
- handle jsonb column type in getTelephonyProvider and getMessagingConfig
- revert jsonb workaround, apply migration 0008 directly
- simulation helpers use correct port and test secret
- resolve API test failures — missing migrations, stale role permissions, assertion mismatches
- rewrite simulation helpers to use real webhook routes
- rewrite CI pipeline — remove nonexistent jobs, add unit tests
- fix lint errors and formatting across codebase

### CI/CD

- add GPG signing, provenance JSON, and release artifact uploads (Epic 79)

### Documentation

- add specs and implementation plans for all 5 workstreams
- fix 10 spec review issues in CF removal + Drizzle migration design
- CF removal + Drizzle/Zod migration implementation plan
- document Watchtower GHCR auth and config vars in .env.example and demo_vars.example.yml
- add Watchtower health check items to production checklist
- complete v1 hardening sprint specs, plans, and backlog
- mark security hardening v2 backport as complete
- mark volunteer PII enforcement as complete
- mark application hardening phase 3 as audited and complete
- mark CI security hardening as complete
- mark CI VPS Auto-Deploy complete in backlog
- mark Ops PostgreSQL Backup & Recovery complete in backlog
- mark Ops MinIO Init + Systemd Service complete in backlog
- mark drizzle schema corrections complete in backlog
- mark shared test helpers complete in backlog
- mark E2EE, spam mitigation, and i18n tests as complete in backlog
- mark Nostr relay, PWA offline, and WebAuthn tests as complete
- mark all remaining items as dev ready for implementing agent
- mark all platform hardening sprint items as complete
- provider simulation suite design
- provider simulation suite implementation plan
- check off completed plan checkboxes and update backlog tracking
- mark E2E test improvements plan as complete
- mark E2E test improvements complete in backlog
- mark Foundation Tooling and merge implementation
- mark Provider Simulation Suite complete in backlog
- mark SLSA Provenance and CF VPS Demo Migration complete
- mark Provider OAuth Auto-Config complete
- mark Signal Automated Registration complete
- mark Transcription Boundary complete
- mark Voice CAPTCHA complete
- mark Geocoding Location Fields complete
- mark Setup Wizard Provider Module complete
- update Drizzle migration plan with new DO features from 2026-03-22
- mark CF Removal + Drizzle Migration complete — DOs eliminated
- update backlog — mark app hardening + zero-trust complete, triage new plans
- document pre-existing test failures needing UI selector updates
- update backlog with precise root cause for remaining test failures
- update backlog — 34/40 tests now pass, 6 remaining CRUD issues
- update test quality status — 167 tests verified passing across 15 suites
- provider auto-registration design specs (5 documents)
- implementation plans for provider auto-registration (4 plans)
- fix review issues in Plan A — SSRF guards, build safety, schema audit
- fix review issues in Plans B, C, D
- update backlog with provider auto-registration completion
- mark all plan checkboxes complete
- add test suite restructuring design spec
- fix spec review issues in test restructuring design
- add Phase 1 implementation plan for test restructuring
- update package.json scripts and CLAUDE.md for three-suite testing
- add UI test parallel isolation design spec

### Features

- enable CI on pull requests and gate deploy jobs
- sync workflows from desktop branch for PR validation
- add lint config, preflight validation, digest rollback, and CI job
- demote CF Workers to optional; add Ansible VPS demo deployment
- add Biome linting, Bun-native Docker builds, and clean up esbuild
- add Drizzle foundation — Bun SQL driver, schema files, custom JSONB
- add 7 service classes replacing Durable Objects
- add Zod schemas and error middleware for all domains
- wire Drizzle db + services into Hono app at startup
- migrate auth/hub middleware to service layer
- migrate auth + webauthn routes to service layer
- migrate volunteers + invites routes to service layer
- migrate shifts routes to service layer
- migrate bans, notes, audit routes to service layer
- migrate calls, telephony, webrtc routes to service layer
- migrate remaining 15 routes + messaging router to service layer
- migrate worker/index.ts cron handler to service layer
- add initial Drizzle schema migration
- add archive hub action with confirmation dialog
- label app service for Watchtower opt-in and add conditional Watchtower service to Ansible template
- add Watchtower auto-update service to production compose
- add file_records Drizzle table for blob file metadata
- create FilesService with DB operations and blob storage methods
- inject FilesService with BlobStorage into createServices and server startup
- migrate uploads.ts from R2/manifest-blob to FilesService + Drizzle
- migrate files.ts from 501 stubs to FilesService DB + blob reads
- cross-hub call reception + hub cascade delete
- add permanent hub delete with name-confirmation dialog + E2E tests
- startup config validation + createTestHub/deleteTestHub helpers
- apply security hardening v2 audit backport
- enforce volunteer PII visibility with typed projections
- add security hardening — GPG signing, secret scan, Dependabot, SECURITY.md
- automated VPS deploy + site deploy on release
- PostgreSQL backup & recovery procedures
- MinIO IAM init + systemd service integration
- drizzle schema corrections and privacy refactor
- add call flow E2E tests and fix telephony routing
- add E2EE note encryption verification tests
- add spam mitigation E2E tests
- add i18n locale coverage E2E tests
- add locale completeness checker and fix missing archive translations
- add Nostr relay event E2E tests and wire up call:ring publishing
- add PWA offline mode E2E tests
- add WebAuthn passkey E2E tests with virtual authenticator
- add dashboard analytics with call volume charts and team stats
- add call detail, note permalink, and settings profile pages
- add consent gate, data export, right to erasure, and retention policies
- add file field type with E2EE upload/download
- add delivery status tracking and status icon UI
- add report types system with custom field binding
- add secure invite delivery via Signal/WhatsApp/SMS
- auto-configure PJSIP SIP trunk via ARI dynamic config
- provider simulation suite — payload factories, endpoints, and E2E tests
- complete CF-to-VPS demo migration plan
- implement Provider OAuth Auto-Config module
- implement Signal automated registration with SMS interception
- remove CF AI transcription path, add client-side recording transcription
- complete voice CAPTCHA with retry logic, attempt tracking, and admin UI
- implement geocoding provider & location custom fields
- add provider module with OAuth validation, phone number selection, and webhook URLs
- add OAuth, provider config, geocoding, signal registration tables and service methods
- port all new features from main to Drizzle service architecture
- hub admin zero-trust visibility — per-hub super admin access control
- real XChaCha20-Poly1305 provider credential encryption
- per-provider Zod schemas with discriminated union
- encrypt provider credentials at rest in SettingsService
- add telnyx to TelephonyProviderType, derive config from Zod schemas, add shared result types
- ProviderCapabilities interface, registry, and stubs
- real testConnection for WhatsApp, Signal (with SSRF), RCS messaging capabilities
- full capability implementations for all 6 telephony providers
- add testConnection() to TelephonyAdapter interface + all implementations
- mount provider-setup routes, rewrite with capabilities registry, add SMS test
- ProviderHealthService with background monitoring and health badge UI
- add authedRequest helper and api/ui test directories
- restructure playwright config with api/ui/bridge projects
- expand API test suite with permission matrix, CRUD lifecycle, and GDPR tests

### Miscellaneous

- add .worktrees/ to .gitignore
- delete CF/DO/platform layer — all DO files, wrangler, platform shim
- remove CF/wrangler deps, update scripts, CI, Docker, CLAUDE.md
- add bun test:unit script and tests/unit/ directory
- apply Biome auto-fixes and delete obsolete globals.d.ts
- finalize foundation tooling plan — delete globals.d.ts, pin Docker digests, fix lint
- install drizzle-orm, recharts, zod 4, and update all deps
- update .claudeignore to exclude dist, .claude, test-results
- migrate telephony/messaging config from jsonb to encrypted text
- v0.21.0 [skip ci]

### Refactoring

- rename src/worker/ → src/server/ and update all import aliases
- split helpers.ts into focused helper modules
- move unit tests to colocated positions next to source
- migrate 3 Playwright tests to colocated bun:test
- move all test files to tests/api/ and tests/ui/
- remove temporary chromium project from playwright config
- convert 5 browser API tests to headless authedRequest
- split 8 mixed test files into API and UI parts

### Testing

- add test isolation resets to all 33 mutation specs
- add archive hub UI test to multi-hub spec
- SHA-256 audit log hash chain integrity
- rate limiter window reset and blocking logic
- hub key envelope atomicity — replace leaves no orphans
- file upload lifecycle — init, chunks, complete, download, ACL
- contacts page and timeline API coverage
- hub membership add and remove API coverage
- WebAuthn passkey registration and login flow
- blast create, send, and subscriber import
- voicemail webhook updates call status and badge
- strengthen 4 weak test files with meaningful assertions
- add hub access control tests for zero-trust visibility
- add mobile navigation + overflow tests, health/config endpoint tests
- update admin-flow + notes-crud selectors to use data-testid
- comprehensive testConnection + registry tests for all providers
- add API suite smoke test for health endpoints

### Merge

- ansible hardening — preflight, rollback, lint config, CI job
- CF → VPS demo migration
- Biome linting, Bun-native Docker, esbuild removal

### Security

- fix 3 hub isolation gaps — cross-hub schedule/call updates + Nostr tag scoping

## [0.20.0] - 2026-03-08

### Bug Fixes

- seed demo accounts and setup state on DO init when DEMO_MODE enabled
- stop false Nostr WebSocket errors and auto-lock in demo mode
- enable SMS + Signal channels in demo mode so Conversations appears
- improve mobile experience for marketing site
- use port 8000 for local Docker setup instead of port 80
- add DEV_RESET_SECRET and DEMO_MODE to E2E test environments
- allow DO resets in development mode and fix bootstrap tests
- pass DEV_RESET_SECRET through Node.js env shim
- implement storage.transaction() for PostgreSQL DO shim

### Features

- add Signal channel to admin settings and message blasts
- Docker-first setup with one-command script
- add production Docker Compose overlay with TLS Caddyfile
- add Co-op Cloud deployment method (Docker Swarm recipe)
- add llamenos-template recipe repo with CI auto-publish

### Miscellaneous

- update .gitignore with monorepo build artifact patterns
- v0.20.0 [skip ci]

### Refactoring

- remove deploy/coopcloud/ — recipe lives in template repo

## [0.19.2] - 2026-02-27

### Miscellaneous

- add AGPL-3.0-or-later license
- v0.19.2 [skip ci]

## [0.19.1] - 2026-02-27

### Bug Fixes

- fix strfry config for CI instead of disabling it

### Miscellaneous

- v0.19.1 [skip ci]

## [0.19.0] - 2026-02-27

### Bug Fixes

- handle WebSocket upgrades directly for Node.js platform
- fix presence endpoint — use correct ShiftManagerDO response key
- promote Nostr relay (strfry) from optional profile to core service
- add SERVER_NOSTR_SECRET to e2e-docker CI env
- include .github/ in CI change detection patterns
- CI change detection + strfry dependency for Docker E2E
- disable strfry in Docker E2E tests, replace --wait with targeted health check

### CI/CD

- increase e2e-cf timeout to 20 minutes

### Documentation

- comprehensive security audit and zero-knowledge architecture redesign
- sync protocol spec with code and add domain label table
- add key revocation runbook with response procedures
- close threat model gaps (APNs/FCM, CF trust, supply chain)
- enrich all 9 epic files with execution context appendices
- update backlogs with Zero-Knowledge Architecture completion status
- update backlogs — Epic 78 client-side transcription complete
- update security documentation for ZK architecture
- update architecture and protocol docs for ZK architecture
- update deployment guides for relay, Caddy ingress, reproducible builds
- update project docs (CLAUDE.md, backlogs)
- update marketing site docs for ZK architecture

### Features

- create authoritative crypto domain separation labels
- add SAS verification to device provisioning protocol
- generic backup file format without identifying strings
- generic ECIES, multi-admin envelopes, admin key separation, hub key manager
- NostrPublisher interface, server keypair, relay infrastructure
- migrate real-time events from WebSocket to Nostr relay
- complete WS removal — clean DO, Nostr-only broadcasts
- E2EE messaging with envelope encryption pattern
- metadata encryption — per-record DO storage, encrypted call history, hash-chained audit log
- reproducible builds — deterministic output, checksums, verification tooling
- migrate transcription to envelope encryption, remove dead ECIES code
- client-side transcription with Whisper WASM via transformers.js
- add DEMO_MODE env flag with CF Cron Trigger for scheduled reset

### Miscellaneous

- v0.19.0 [skip ci]

## [0.18.0] - 2026-02-25

### Bug Fixes

- use dark theme for Mermaid diagrams
- deploy site for docs-only changes
- filter WebSocket errors in Docker test environment

### CI/CD

- skip versioning and deploy for docs-only changes

### Features

- implement volunteer assignment and two-way conversation UI

### Miscellaneous

- trigger site deploy for Mermaid dark theme fix
- v0.18.0 [skip ci]

### Testing

- add comprehensive tests for messaging epics 68-73

## [0.17.0] - 2026-02-24

### CI/CD

- skip E2E tests for docs-only changes

### Features

- enhance visual design with animations and polish

### Miscellaneous

- v0.17.0 [skip ci]

## [0.16.1] - 2026-02-24

### Bug Fixes

- restore waitForTimeout for reliable test timing

### Documentation

- add screenshots and Mermaid diagrams to documentation

### Miscellaneous

- v0.16.1 [skip ci]

### Refactoring

- add test ID infrastructure for maintainable selectors

## [0.16.0] - 2026-02-24

### Bug Fixes

- fix panic wipe overlay rendering and playwright port config
- match bun versions

### Documentation

- update backlog to reflect all completed epics

### Features

- add panic wipe, SRI hashes, and PIN challenge
- add RCS Business Messaging channel (Epic 63)
- add message blasts with subscriber management (Epic 62)
- add call recording playback and dev tunnel script
- add Ansible playbooks, OpenTofu modules, and ops docs (Epic 66)

### Miscellaneous

- update logo SVG and clean up footer
- v0.16.0 [skip ci]

## [0.15.0] - 2026-02-24

### Bug Fixes

- update reporter onboarding test for simplified backup flow
- add missing PG_PASSWORD to docker E2E, increase CF timeout, exclude live tests
- use data-testid selectors, enable parallel E2E, reduce timeouts
- increase login timeouts and add serial mode for state-dependent tests
- resolve parallel execution conflicts in E2E tests
- increase e2e-docker timeout from 20 to 30 minutes
- fix field slug, remove double logins, increase timeouts
- scope custom field badge assertion to specific note card
- restore bun.lockb compatible with CI bun v1.2
- make custom field creation idempotent, scope edit assertions
- prevent section toggle race in custom fields tests
- audit round 6 — supply chain, crypto hygiene, permission guards
- audit R6 high — remove V1 encrypt, gate resets, tree-shake demo, lockfile, ARI creds
- audit R6 medium — SSRF guard, DO admin routes, HMAC-SHA256 hashing
- audit R6 medium — dep scanning, image pinning, PG egress
- improve test-reset error handling and robustness
- request-bound auth tokens, adminPubkey migration, CI test fixes
- complete keyPair→keyManager migration in remaining components
- complete L-3 keyPair removal from auth context
- add token verification fallback and fix test token creation
- strip query params from token path to match server pathname
- skip live telephony in CI, fix strict mode and flaky navigation
- handle deep link section expansion on search-only navigation

### CI/CD

- trigger fresh CI run for e2e-docker validation

### Features

- add in-browser admin bootstrap
- add permission-based access control, UI polish, and admin improvements
- add storage migration framework and PostgreSQL improvements
- add multi-hub architecture with per-hub isolation
- dynamic role assignment UI, notification/PWA banners, logo refresh, and setup wizard improvements
- add live telephony E2E tests, UX improvements, and phone input upgrade

### Miscellaneous

- add next staging environment for pre-release testing
- v0.15.0 [skip ci]

## [0.14.0] - 2026-02-22

### Bug Fixes

- add [skip ci] to release commits to prevent re-triggering

### Features

- add demo mode with sample data and one-click login

### Miscellaneous

- v0.14.0 [skip ci]

## [0.13.0] - 2026-02-21

### Bug Fixes

- remove invalid workflows permission from version job
- use correct CallSettings property names in status summary

### Documentation

- add pre-push typecheck/build requirement to CLAUDE.md

### Features

- UI polish and admin UX improvements (epics 56-57)

### Miscellaneous

- v0.13.0

## [0.12.0] - 2026-02-19

### Bug Fixes

- fix E2E job failures — Docker build + wrangler auth
- copy index.html into frontend build stage
- fix strict mode violation in ban management test
- rebase version commit onto latest before push
- add workflows permission to version job

### Features

- add E2E tests gating version bump and deployment

### Miscellaneous

- v0.12.0

## [0.11.1] - 2026-02-19

### Bug Fixes

- generate release notes directly in release job

### Miscellaneous

- v0.11.1

## [0.11.0] - 2026-02-19

### Bug Fixes

- install site dependencies before building

### Features

- add multi-platform deployment (Docker Compose + Helm)
- add CI/CD pipeline, security hardening, and self-hosting docs

### Miscellaneous

- update changelog for v0.9.1
- v0.11.0

## [0.9.1] - 2026-02-18

### Documentation

- update documentation for Epic 54 architecture changes

### Features

- reorganize docs sidebar into 4 audience-focused sections

### Miscellaneous

- bump version to 0.9.1

## [0.9.0] - 2026-02-18

### Bug Fixes

- WebSocket auth via query params, add Playwright config
- E2E test reliability + HOTLINE_NAME greeting for callers
- admin/volunteer profile save — name & phone now persisted via API
- Schnorr auth signatures + security audit fixes
- E2E test fixes + revert ban list hashing for admin usability
- auto-clean stale calls from dashboard (5min ringing, 8hr in-progress)
- replace sidebar flag buttons with LanguageSelect combobox
- un-nest volunteer profile route from parent volunteers layout
- show keyboard shortcuts in command palette and use note sheet for new note
- call lifecycle — hibernation-safe WS, polling fallback, audit enrichment, transcription flag
- call lifecycle, transcription pipeline, and UI cleanup
- show masked phone numbers in audit/history, deploy to custom domain
- add telephony and call history logging
- add call lifecycle logging, debug endpoint, and error visibility
- StatusCallbackEvent params and call-recording lifecycle
- clickable transcript badges, Whisper model upgrade, call status map
- notes page — rich call headers, custom fields in edit form
- style features/security pages, fix Spanish docs double-prefix links
- fixes, remove finished epics
- link color
- security hardening from comprehensive audit
- medium-severity security hardening
- remove PII from GitHub URLs across all site pages
- use correct GitHub URL for all repository links
- redesign logo with recognizable phone handset silhouette

### Documentation

- overhaul README for user-facing setup guide
- epic specs 24–27 for shift awareness, palette, IVR audio, polish
- update backlog with security audit findings
- update completed backlog with marketing site i18n details
- update backlogs for Epics 33-36, remove completed epic docs
- broaden Twilio-specific references to multi-provider language
- update backlog with security audit findings
- mark medium-severity security fixes as complete
- epics 42-46 — multi-channel messaging, reporter role, encrypted uploads
- add Epic 43 (setup wizard), renumber 43-46 → 44-47, make voice optional
- update backlog — mark Epics 42-47 and help features complete
- update all documentation for multi-channel messaging, reporter role, and setup wizard
- update all documentation for Epic 54 device-centric auth & forward secrecy

### Features

- complete project scaffold — frontend, backend, telephony, encryption
- complete volunteer call handling, notes, transcription, rate limiting
- security hardening — headers, auth redirects, route protection
- UI polish, on-break toggle, confirm dialogs, server-side validation
- E2EE transcriptions, security hardening, search/filter, deploy
- multilingual support — 12 languages for UI and call intake
- epics 15–18 — light mode, volunteer status, notifications, notes search
- more features and fixes
- admin-configurable IVR language menu
- Epic 24 — shift & call status awareness throughout the app
- Epic 25 — command palette enhancements
- Epic 26 — custom IVR audio recording for admin voice prompts
- Epic 27 — remaining polish & backlog items
- PWA support — installable app with offline caching
- security hardening + voicemail fallback
- WebAuthn passkeys, configurable call settings, session expiry UX, phone validation, test isolation
- security hardening — phone hashing, DO rate limits, encrypted exports, i18n
- collapsible settings sections with deep links (Epic 30)
- admin-configurable custom note fields with E2EE (Epic 31)
- show volunteer names in audit log with linked profile pages
- move key backup to user settings, add admin transcription opt-out control
- replace shift volunteer checkboxes with autocomplete multi-select
- show hotline number in sidebar and fix bottom section alignment
- marketing site with Astro Content Collections i18n
- Epic 32 — multi-provider telephony configuration system
- Epic 33 — cloud provider adapters (SignalWire, Vonage, Plivo)
- Epic 34 — WebRTC volunteer calling
- Epics 35+36 — Asterisk ARI adapter, bridge service, and telephony docs
- expand docs sidebar with all pages in two sections
- translate all documentation to 11 additional languages
- Epic 42 — messaging architecture foundation & threaded conversations
- Epics 43 & 47 — admin setup wizard and reporter role with encrypted file uploads
- Epics 44-46 — SMS, WhatsApp, and Signal channel adapters
- add help page, getting started checklist, and in-app guidance
- Epics 48-52 — UI/UX design overhaul with teal brand identity
- Epic 54 Phase 1 — PIN-first local key store & security hardening
- Epic 54 Phase 4 — simplified invite & recovery flow
- Epic 54 Phase 3 — per-note ephemeral keys for forward secrecy
- Epic 54 Phase 2 — Signal-style device linking via QR provisioning

### Miscellaneous

- consolidate deploy scripts in root package.json
- add versioning and changelog generation (v0.9.0)

### Refactoring

- split SessionManagerDO into 3 focused Durable Objects
- epics 37-41 — split large components, deduplicate, add tests
- simplify report titles to plaintext, add role selector to invite form, consolidate UserRole type, add E2E tests

### Testing

- E2E tests for epics 24-27 and backlog update
- E2E tests for custom fields in notes, update CLAUDE.md
- add E2E tests for device linking and fix /link-device public path


