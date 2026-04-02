# Design: Core Documentation & CI/CD Overhaul (Spec A+B)

**Version:** 2.0
**Date:** 2026-04-01
**Status:** Draft
**Supersedes:** `2026-03-28-idp-auth-docs-overhaul-design.md` (absorbed — that spec's scope is a subset of this one)
**Companion spec:** `2026-04-01-doc-site-redesign-design.md` (Spec C — site IA, visual design, content, translations)

## Problem

The project has undergone rapid, transformative changes over the past month:

- Authentication migrated from Nostr nsec-only to JWT + Authentik IdP + multi-factor KEK
- MinIO replaced by RustFS
- Field-level E2EE shipped for all PII (envelope encryption) and org metadata (hub-key encryption)
- E2EE messaging shipped (was "planned")
- Client-side WASM Whisper transcription shipped (was "planned", previously CF Workers AI)
- Reproducible builds shipped (was "planned")
- Contact Directory CMS added (PBAC, teams, tags, bulk ops, intake)
- React Query refactor replaced all useState/useEffect data fetching
- Zod schema migration + OpenAPIHono for all routes
- Seven PostgreSQL-backed services replaced Durable Objects
- Voicemail elevated to first-class feature
- WebRTC/SIP calling via JsSIP + Asterisk bridge

None of these changes are reflected in:

- The marketing/docs site (19 doc pages + 3 marketing pages, 13 locales)
- Internal developer docs (QUICKSTART, RUNBOOK, security docs, architecture docs)
- Protocol specification
- Deployment configurations (Helm chart missing IdP, docker-setup.sh missing IdP secrets)
- CI/CD pipeline (site deploy to Cloudflare Pages missing, monolithic ci.yml)

Additionally, the doc site needs structural improvements:

- No tag-based browsing or semantic search
- Role-based guides hardcode "Admin/Volunteer/Reporter" (but roles are configurable via PBAC)
- No feature-focused articles (Contact Directory, Shifts, Encryption, Voicemail, etc.)
- Security page — praised by users for accessibility — needs refresh for the dramatically stronger security model

## Principles

1. **Core out**: Fix canonical technical truth first (protocol, architecture), then infrastructure (CI, deploy), then user-facing content (site)
2. **Preserve the voice**: The security page's plain-language, "what can they see" style is beloved. Every user-facing page uses accessible language — no jargon
3. **Audience, not role**: Since roles are configurable (PBAC), docs use generic audience terms (Operator, Staff, Caller) not role names
4. **Tag-based discovery**: Articles organized by feature, browsable by audience + task tags, with semantic search
5. **Maintainable**: Each doc has a clear owner (protocol → architecture team, site → content, deploy → ops). No duplication between internal docs and site content
6. **Replete**: Every feature, every security property, every deployment path documented. No gaps, no "coming soon"

## Scope

This is **Spec A+B** — the canonical technical documentation and infrastructure work. It covers Layers 1-4 only:

- **Spec A** (Layers 1-3): Protocol, architecture, security, internal docs, deploy configs
- **Spec B** (Layer 4): CI/CD pipeline restructuring

**Spec C** (doc site redesign — information architecture, visual design, tag system, search, content rewrite, translations) is a separate spec that depends on A being complete so the content it presents is accurate.

### In Scope

- Protocol & architecture documentation overhaul (Layer 1)
- Internal developer/operator documentation overhaul (Layer 2)
- Deployment configuration fixes (Layer 3)
- CI/CD pipeline split and site deploy addition (Layer 4)

### Out of Scope (deferred to Spec C)

- Doc site information architecture redesign (user-facing vs technical separation)
- Tag-based guide system with audience + task tags
- Pagefind semantic search
- Site content overhaul (security page, features page, guide articles)
- Frontend visual design
- Translation updates

### Out of Scope (not planned)

- Full professional translation of all 12 locales (follow-up — content must stabilize first)
- API reference docs (auto-generated via OpenAPI at `/api/docs` — link to it, don't duplicate)
- Desktop/Tauri app docs (app not ready)
- New epics or feature work

---

## Layer 1: Protocol & Architecture Documentation

The canonical source of truth. Everything downstream derives from these.

### 1.1 Overhaul: `docs/protocol/llamenos-protocol.md`

**Key derivation** — Replace PIN-only PBKDF2 with multi-factor:

```
KEK = PBKDF2(PIN, salt, 600K) ⊕ HKDF(idpValue, LABEL_NSEC_KEK_2F) [⊕ HKDF(prfOutput, LABEL_NSEC_KEK_3F)]
```

**Auth flow** — Replace Schnorr challenge-response with:

- JWT access token (HS256, 15min) + httpOnly refresh cookie
- Authentik OIDC flow (authorization code + PKCE)
- Silent refresh lifecycle
- Session binding to IdP session

**Key store** — Document v2 blob format:

- Fields: salt, nonce, ciphertext, idpIssuer, prfEnabled, version
- Migration: v1 blobs auto-upgrade on next unlock when IdP is available

**Session model** — JWT claims structure, token rotation, idle timeout, configurable expiry, jti-based revocation via `jwtRevocations` table

**Domain separation** — Audit `crypto-labels.ts` and document all 25 labels with their contexts

**Remove** — Schnorr signature authentication section (replaced by JWT)

### 1.2 Overhaul: `docs/architecture/E2EE_ARCHITECTURE.md`

Add sections for:

- **Multi-factor KEK derivation** — diagram showing PIN + IdP value + optional PRF → XOR → KEK
- **Three encryption tiers** — envelope-encrypted PII, hub-key encrypted org metadata, per-note forward secrecy
- **Web Worker isolation** — nsec lives in dedicated Worker, never on main thread. Diagram: main thread → postMessage → crypto worker → result
- **Decrypt-on-fetch pattern** — React Query queryFn calls decryptHubField/decryptObjectFields, components receive plaintext
- **Envelope encryption for messaging** — per-message random key, ECIES-wrapped per reader
- **Hub key distribution** — random 32 bytes, ECIES-wrapped per member, rotation on departure

Update existing sections:

- Data-at-rest table: add JWT tokens (not E2EE, server-issued), Authentik credentials (external), volunteer name (now E2EE via envelopes), org metadata (hub-key encrypted)
- Key hierarchy diagram: add IdP-bound factor, WebAuthn PRF factor
- Server layer: add Authentik as dependency

### 1.3 Overhaul: `docs/security/THREAT_MODEL.md`

- **Add IdP trust boundary**: Authentik is self-hosted (operator-controlled), but if compromised, attacker gets IdP values (one KEK factor). Multi-factor means this alone is insufficient.
- **Update device seizure**: PIN brute-force alone insufficient — attacker needs IdP value too. With WebAuthn PRF: three factors needed. Quantify: 6-digit PIN (600K PBKDF2) + IdP value (256-bit HKDF) = infeasible without IdP compromise.
- **Add remote kill-switch**: IdP session revocation = immediate lockout across all devices. JWT refresh fails → forced re-auth → IdP blocks.
- **JWT token threats**: Access token theft (15min window, no revocation needed), refresh token theft (revocable via jti), token injection (HS256 requires server secret).
- **Update attack surface**: Add Authentik endpoints (OIDC callback, token refresh), auth facade (`/api/auth/*`), JWT validation middleware.
- **Add Authentik compromise scenario**: Attacker gets IdP values but not PINs or WebAuthn PRF. Can create sessions but cannot decrypt any E2EE content. Mitigation: detect anomalous sessions, rotate IdP values.

### 1.4 Overhaul: `docs/security/DATA_CLASSIFICATION.md`

- Replace all "IdentityDO" / Durable Objects references with PostgreSQL `users` table
- Update volunteer `name`: "Encrypted-at-Rest" → "E2EE" (envelope encryption)
- Update volunteer `phone`: remains server-encrypted (needed for call routing)
- Add `idpValue` (encrypted with `IDP_VALUE_ENCRYPTION_KEY`, server-side)
- Add `webauthnCredentials` classification
- Add JWT token storage classification (access: memory-only, refresh: httpOnly cookie)
- Add Authentik data store: user records, sessions, tokens (operator-managed, external to app DB)
- Add hub-key encrypted fields: role names, shift names, report type names, custom field labels, team names, tag names
- Update revision history

### 1.5 Overhaul: `docs/security/DEPLOYMENT_HARDENING.md`

- Remove Cloudflare Workers architecture section (no longer supported)
- Add Authentik hardening: Redis security, Postgres isolation, blueprint-only provisioning, API token rotation, rate limiting
- MinIO → RustFS throughout
- Add JWT secret rotation procedure
- Update minimum hardware specs (+512MB RAM for Authentik, +256MB for Authentik worker)
- Add Authentik network isolation (internal-only, Caddy proxies if external access needed)

### 1.6 Overhaul: `docs/security/KEY_REVOCATION_RUNBOOK.md`

- Update admin key compromise: now includes IdP password reset + JWT bulk revocation + re-enrollment
- Add IdP-level revocation: disable user in Authentik → immediate lockout
- Add per-device session revocation via auth facade
- Add JWT jti bulk revocation procedure (insert all active jtis for user into `jwtRevocations`)
- Update volunteer departure (friendly): deactivate + IdP disable + JWT revoke
- Add re-enrollment flow: admin initiates → volunteer re-onboards via new invite

### 1.7 Overhaul: `docs/security/README.md`

- Update encryption levels table: add E2EE for volunteer PII, hub-key for org metadata, JWT for sessions
- Update auth model summary: JWT + IdP + multi-factor KEK
- Update "what we don't claim": add Authentik compromise resistance caveat
- Update feature table with shipped items (E2EE messaging, client-side transcription, reproducible builds)

### 1.8 Create: `docs/architecture/PBAC_ARCHITECTURE.md`

New document covering:

- Permission-based access control design
- Default roles (admin, volunteer, reporter) as templates, not fixed
- Permission scoping hierarchy (hub → team → individual)
- Team-based access patterns
- How permissions interact with E2EE (decryption gated by permission checks client-side)

### 1.9 Create: `docs/architecture/CONTACT_DIRECTORY.md`

New document covering:

- Contact data model (contacts, relationships, tags, teams)
- Auto-linking: call/message → contact matching via phone hash
- Intake workflows: how new contacts enter the system
- Encryption: all contact PII envelope-encrypted
- Bulk operations: import/export with encryption
- PBAC integration: who can see/edit which contacts

---

## Layer 2: Internal Developer Documentation

For operators and contributors. References Layer 1 for deep technical detail.

### 2.1 Overhaul: `docs/QUICKSTART.md`

- MinIO → RustFS throughout
- Add Authentik to service list and health check sequence (`docker-compose.dev.yml` starts it)
- Replace `bun run bootstrap-admin` with setup wizard description (IdP registration → PIN → key generation)
- Add IdP secret generation to "Generate secrets" section (JWT_SECRET, IDP_VALUE_ENCRYPTION_KEY, AUTHENTIK_SECRET_KEY, AUTHENTIK_BOOTSTRAP_TOKEN)
- Update first-login flow: IdP account creation, not nsec entry
- Fix webhook URLs: add `/api/` prefix where missing
- Add Contact Directory to feature overview
- Update dev port offsets table if changed

### 2.2 Overhaul: `docs/RUNBOOK.md`

- MinIO → RustFS throughout
- Add Authentik operational procedures: health monitoring, backup (Authentik DB + Redis), user management, blueprint updates
- Add JWT secret rotation to "Secret rotation" section
- Add IDP_VALUE_ENCRYPTION_KEY rotation (versioned — increment `IDP_VALUE_KEY_VERSION`, re-encrypt)
- Update backup/restore to include Authentik database
- Update troubleshooting: auth failures (check IdP health, JWT expiry, token refresh, check `jwtRevocations`)
- Add Contact Directory operations (bulk import/export, tag management)

### 2.3 Overhaul: `docs/DESIGN.md`

- Mark as "Original Design Notes (v0.x)" — historical context
- Add brief "Current Architecture" summary pointing to `docs/architecture/` for up-to-date docs
- Light touch: note auth evolution, storage evolution, service architecture evolution

### 2.4 Overhaul: `docs/RELAY_OPERATIONS.md`

- Light touch: relay itself unchanged
- Update Nosflare section: document deprecation status (strfry is primary, Nosflare for CF-only deployments which are no longer supported)
- Clarify: relay auth is still NIP-42 with server Nostr key, not JWT

### 2.5 Overhaul: `docs/REPRODUCIBLE_BUILDS.md`

- Update scope: Authentik is an external image (not built by us), document digest pinning
- Clarify: reproducible builds cover app image only, not Authentik/strfry/RustFS

### 2.6 Overhaul: `docs/TEST_COVERAGE_GAPS.md`

- Add gaps for: JWT/Authentik auth flows, multi-factor KEK scenarios, Contact Directory CRUD, PBAC permission checks, hub-key encryption/decryption, envelope encryption for messaging
- Remove gaps that have been filled by recent work

### 2.6b Overhaul: `docs/ops/restore-runbook.md`

- Add Authentik database to backup/restore procedures
- Add Authentik Redis cache rebuild after restore
- Document restore order: PostgreSQL → Authentik DB → RustFS → strfry → app restart

### 2.6c Overhaul: `deploy/PRODUCTION_CHECKLIST.md`

- Add IdP/Authentik checklist items: secrets generated, health check passing, blueprint applied, admin account created
- Add JWT secret rotation verification
- Add WebAuthn RP configuration verification
- Update any MinIO references to RustFS
- Add Contact Directory initial setup verification

### 2.7 Overhaul: Root `README.md`

- Update auth description: JWT + Authentik IdP + multi-factor KEK
- Update storage: clarify RustFS is the default (MinIO compatibility layer removed)
- Update core services list: add Authentik
- Update feature highlights with shipped items

### 2.8 Overhaul: `CLAUDE.md`

- Update Auth line in tech stack
- Add to Key Technical Patterns: IdP adapter, auth facade, crypto Web Worker, decrypt-on-fetch, key-store-v2
- Update directory structure: `src/server/idp/`, `src/server/routes/auth-facade.ts`, `src/client/lib/key-store-v2.ts`, `src/client/lib/crypto-worker*.ts`
- Add gotchas: worker singleton, decrypt rate limiter, synthetic IdP values, auth facade endpoints
- Add new env vars: JWT*SECRET, IDP_VALUE_ENCRYPTION_KEY, AUTHENTIK*_, AUTH*WEBAUTHN*_
- Add Authentik to core services, note first-boot wait (~60s)

---

## Layer 3: Deployment Configurations

Make configs match reality. Ansible is already complete — Helm and scripts are not.

### 3.1 Fix: `deploy/helm/llamenos/values.yaml`

Add IdP configuration section:

```yaml
idp:
  adapter: authentik
  authentikUrl: http://authentik-server:9000

secrets:
  jwtSecret: "" # Required — 32+ hex chars
  idpValueEncryptionKey: "" # Required — base64, 32 bytes
  authentikSecretKey: "" # Required — 50+ chars
  authentikBootstrapToken: "" # Required — 32+ hex bytes
  webauthnRpId: "" # Defaults to ingress host
  webauthnRpName: "Hotline"
  webauthnOrigin: "" # Defaults to https://{ingress.host}
```

### 3.2 Fix: `deploy/helm/llamenos/templates/secret.yaml`

Add all IdP secret keys: `jwt-secret`, `idp-value-encryption-key`, `authentik-secret-key`, `authentik-bootstrap-token`

### 3.3 Fix: `deploy/helm/llamenos/templates/deployment-app.yaml`

Add env vars from secrets for all IdP/auth configuration

### 3.4 Fix: `scripts/docker-setup.sh`

Add generation of:

- `JWT_SECRET` (64 hex chars via `openssl rand -hex 32`)
- `IDP_VALUE_ENCRYPTION_KEY` (base64 via `openssl rand -base64 32`)
- `AUTHENTIK_SECRET_KEY` (64 chars via `openssl rand -hex 32`)
- `AUTHENTIK_BOOTSTRAP_TOKEN` (64 hex chars via `openssl rand -hex 32`)
- `AUTH_WEBAUTHN_RP_ID` (derived from `--domain` flag or `localhost`)
- `AUTH_WEBAUTHN_RP_NAME` (default: "Hotline")
- `AUTH_WEBAUTHN_ORIGIN` (derived from domain)

Add Authentik health wait after `docker compose up` (poll `/api/v3/core/root/` until ready)

### 3.5 Cleanup: Stale references

- `docker-compose.dev.yml`: Update MinIO comment to RustFS
- Any remaining MinIO references in deploy/ scripts

---

## Layer 4: CI/CD Pipeline Restructuring

Split the monolithic `ci.yml` and add site deployment.

### 4.1 Restructure: Split into 3 workflows

**`ci.yml`** (PR validation only):

- Trigger: `pull_request` only
- Jobs: detect-changes, lint, build (app + site), audit, unit-tests, integration-tests, api-tests, e2e-tests, ansible-validate
- No versioning, no releases, no deployment
- Fast feedback for contributors

**`release.yml`** (main branch releases):

- Trigger: `push` to `main` (excluding docs-only changes)
- Jobs: detect-changes, version-bump (conventional commits → semver), changelog (git-cliff), create GitHub Release, CHECKSUMS.txt, GPG signing
- Triggers: `docker.yml` (via tag), `auto-deploy-demo.yml` (via release event)

**`deploy-site.yml`** (marketing site deployment):

- Trigger: `release: published` OR `push` to `main` with `site/**` path filter OR `workflow_dispatch`
- Jobs: build Astro site, deploy to Cloudflare Pages via `cloudflare/wrangler-action@v3`
- Secrets required: `CF_API_TOKEN`, `CF_ACCOUNT_ID`
- Environment: `cloudflare-pages`

### 4.2 Keep unchanged

- `docker.yml` — triggered by tags, builds Docker images
- `auto-deploy-demo.yml` — triggered by release, deploys demo VPS
- `deploy-demo.yml` — manual dispatch for demo VPS
- `security-audit.yml` — daily + on-push security scans
- `secret-scan.yml` — gitleaks scanning

---

## Implementation Strategy

Execute core-out, layer by layer. Each layer is a logical commit boundary.

**Layer 1** (Protocol & Architecture): 11 files — can parallelize across security docs vs architecture docs
**Layer 2** (Internal Docs): 10 files — depends on Layer 1 for accuracy
**Layer 3** (Deploy Configs): 5 files — independent of Layers 1-2, can parallelize
**Layer 4** (CI/CD): 3 workflow files — independent, can parallelize with Layer 3

Layers 3 and 4 can execute in parallel with Layers 1-2.
Layer 2 depends on Layer 1 for technical accuracy.

After this spec is complete, **Spec C** (doc site redesign) begins with its own brainstorm using the `frontend-design` skill for visual/UX treatment. Spec C covers:
- Information architecture: clean separation of user-facing content (About, Guides) from technical content (Deploy, Reference)
- Tag-based guide system with audience (Operator, Staff, Caller) + task (Setup, Daily Use, Configuration, Troubleshooting, Security) dimensions
- Pagefind semantic search integration
- Security page overhaul (preserving the beloved plain-language voice)
- Features page overhaul (reflecting all shipped improvements)
- New feature guide articles (Contact Directory, Shifts, Encryption, etc.)
- Retirement of role-based guides → migration to feature-focused tag-filtered articles
- Frontend visual design for new layouts, tag filtering, search UI
- Translation stub updates for all 12 non-English locales

## Non-Goals

- Full professional translation (follow-up after content stabilizes)
- API reference documentation (auto-generated via OpenAPI — just link to `/api/docs`)
- Desktop/Tauri app documentation (app not ready)
- New feature development
- Migration guides (no production instances exist)
- Security audit re-run (separate engagement)
