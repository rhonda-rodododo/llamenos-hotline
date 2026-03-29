# Design: IdP Auth Documentation Overhaul

**Version:** 1.0
**Date:** 2026-03-28
**Status:** Draft
**Branch:** `docs/idp-auth-overhaul` (branched off `feat/idp-auth-hardening`, retargeted to `main` after feature merge)

## Problem

The IdP auth migration fundamentally changes how authentication, key management, and session handling work in Llamenos. Every documentation artifact — from the cryptographic protocol spec to the getting-started guide — still describes the old Nostr nsec-only auth model. Additionally, the E2EE improvements shipped in v0.28 (field-level encryption, envelope encryption for all PII) are not reflected in user-facing security documentation.

Separately, several docs still reference MinIO where the storage layer is now RustFS.

## Scope

Update **all existing documentation** to describe the current system. No new standalone docs (API reference waits for OpenAPI). No migration guide (no production instances exist). Translations are a follow-up.

### What Changed

| Aspect | Old | New |
|--------|-----|-----|
| Server auth | Schnorr signature (BIP-340) on every request | JWT access token (HS256, 15min) + httpOnly refresh cookie |
| Session model | 8-hour signed tokens | JWT with automatic silent refresh, configurable idle timeout |
| Key encryption | PIN-only KEK (PBKDF2, 600K iterations) | Multi-factor KEK: PIN + IdP-bound value + optional WebAuthn PRF |
| IdP | None | Authentik (self-hosted OIDC), adapter interface for other providers |
| Key storage | key-store v1 (PIN → nsec) | key-store v2 (PIN + IdP issuer + salt + PRF flag) |
| Private key access | Main thread (closure in key-manager) | Isolated Web Worker (nsec never on main thread) |
| Onboarding | Admin generates nsec → shares securely | Admin creates invite link → volunteer self-enrolls via IdP |
| Field decryption | Sync `tryDecryptField` on main thread | Async decrypt-on-fetch via Web Worker (`useDecryptedArray`/`useDecryptedObject`) |
| Volunteer PII | Server-key encrypted at rest | E2EE envelope encryption — server stores ciphertext + ECIES envelopes, returns `[encrypted]` placeholder |
| Remote revocation | None (PIN compromise = full access until key rotated) | IdP session revocation = immediate lockout across all devices |
| Blob storage | MinIO | RustFS (S3-compatible) |
| Core services | postgres, strfry, rustfs | postgres, strfry, rustfs, authentik-server, authentik-worker |

### Nostr Language Policy

Nostr is still the underlying technology for keypairs (secp256k1), relay-based real-time events (strfry, kind 20001), and event signing. In documentation:
- **Technical docs** (protocol, architecture, CLAUDE.md): Use "Nostr keypair", "nsec", "npub" where technically accurate
- **User-facing docs** (guides, site): Say "cryptographic identity" or "encryption key" — users never see nsec/npub
- **Marketing pages**: Mention Nostr once as underlying technology, don't make it the headline

## Files to Update

### Area 1: Deployment Configs (5 files)

**`scripts/docker-setup.sh`**
- Already fixed on main (MinIO→RustFS done). After merging main: add `JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`, `AUTHENTIK_SECRET_KEY`, `AUTHENTIK_BOOTSTRAP_TOKEN` generation
- Add `IDP_ADAPTER`, `AUTHENTIK_URL`, `AUTH_WEBAUTHN_RP_ID`, `AUTH_WEBAUTHN_RP_NAME`, `AUTH_WEBAUTHN_ORIGIN` writes (derive WebAuthn vars from `--domain` flag)
- Add Authentik health wait after `docker compose up`

**`deploy/ansible/roles/llamenos/templates/env.j2`**
- Add "IdP Auth" section: `JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`, `IDP_ADAPTER`, `AUTHENTIK_URL`, `AUTHENTIK_API_TOKEN`, `AUTH_WEBAUTHN_*`

**`deploy/helm/llamenos/values.yaml`**
- Add `idp` config block and `auth` secrets section

**`deploy/helm/llamenos/templates/secret.yaml`**
- Add `jwt-secret`, `idp-value-encryption-key`, `authentik-secret-key`, `authentik-api-token`

**`deploy/helm/llamenos/templates/deployment-app.yaml`**
- Add env vars from secrets for all IdP/auth config

### Area 2: CLAUDE.md (1 file)

- Update Auth line in tech stack
- Add to Key Technical Patterns: IdP adapter, auth facade, crypto Web Worker, decrypt-on-fetch, key-store-v2
- Update directory structure: `src/server/idp/`, `src/server/routes/auth-facade.ts`, `src/client/lib/key-store-v2.ts`, `src/client/lib/crypto-worker*.ts`
- Add gotchas: worker singleton, decrypt rate limiter (100/sec, 1000/min), synthetic IdP values, auth facade endpoints at `/api/auth/*`
- Add new env vars: `JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`, `AUTHENTIK_*`, `AUTH_WEBAUTHN_*`
- Add Authentik to core services, note first-boot wait (~60s)

### Area 3: Internal Technical Docs (11 files)

**`docs/architecture/E2EE_ARCHITECTURE.md`**
- Add multi-factor KEK derivation section
- Update key hierarchy to show IdP-bound factor
- Add Web Worker isolation architecture
- Add decrypt-on-fetch pattern description
- Update to reflect field-level E2EE for volunteer PII (name is E2EE via envelopes; phone remains server-encrypted for routing — shipped in v0.28)
- Add envelope encryption for messaging (shipped)

**`docs/protocol/llamenos-protocol.md`**
- **Key derivation**: Replace PIN-only PBKDF2 with multi-factor: `KEK = PBKDF2(PIN, salt, 600K) ⊕ HKDF(idpValue, LABEL_NSEC_KEK_2F) [⊕ HKDF(prfOutput, LABEL_NSEC_KEK_3F)]`
- **Auth flow**: Replace Schnorr challenge-response with JWT lifecycle (access token, refresh cookie, silent refresh)
- **Session model**: JWT claims, token rotation, idle timeout, IdP session binding
- **Key store**: Document v2 blob format (salt, nonce, ciphertext, idpIssuer, prfEnabled, version)
- **Domain labels**: Add any new labels from `crypto-labels.ts`
- **Remove**: Schnorr signature authentication section (replaced by JWT)

**`docs/security/THREAT_MODEL.md`**
- Add IdP as trust boundary (Authentik is self-hosted, so operator-controlled)
- Update device seizure scenario: multi-factor KEK means PIN brute-force alone is insufficient
- Add remote kill-switch: IdP session revocation invalidates all devices immediately
- Update JWT token theft scenario and mitigations
- Add WebAuthn PRF as hardware-bound factor analysis
- Update PIN entropy analysis (now one of 2-3 factors, not sole factor)

**`docs/security/DATA_CLASSIFICATION.md`**
- Volunteer `name`: change from "Encrypted-at-Rest" to "**E2EE**" (envelope encryption)
- Volunteer `phone`: remains server-encrypted (needed for call routing)
- Add: `idpValue` (encrypted with `IDP_VALUE_ENCRYPTION_KEY`), `webauthnCredentials` (update description)
- Remove: `sessionTokens` (8-hour TTL) → replace with JWT description (Authentik-managed)
- Add Authentik data store: user records, sessions, tokens (operator-managed)
- Update Durable Object references to PostgreSQL (if any remain)

**`docs/security/DEPLOYMENT_HARDENING.md`**
- Remove Cloudflare Workers architecture (no longer supported)
- Add Authentik hardening section: Redis security, Postgres isolation, blueprint-only provisioning, API token rotation
- MinIO→RustFS throughout
- Add JWT secret rotation procedure
- Update minimum specs (Authentik adds ~512MB RAM requirement)

**`docs/security/KEY_REVOCATION_RUNBOOK.md`**
- Update for multi-factor key: revoking means IdP session revoke + optional key re-enrollment
- Add IdP-level revocation procedure (disable user in Authentik)
- Add per-device session revocation via auth facade
- Update admin key compromise response (now includes IdP password reset)
- Add re-enrollment flow (admin initiates, volunteer re-onboards)

**`docs/security/README.md`**
- Update summary tables: auth model, encryption levels, key hierarchy
- Update "what's E2EE" list to include volunteer PII (name)

**`docs/QUICKSTART.md`**
- MinIO→RustFS throughout
- Add Authentik to service list and health check sequence
- Replace `bun run bootstrap-admin` with setup wizard description
- Add IdP secret generation to "Generate secrets" section
- Update first-login flow (IdP registration, not nsec entry)

**`docs/RUNBOOK.md`**
- MinIO→RustFS throughout
- Add Authentik operational procedures: health monitoring, backup, user management
- Add JWT secret rotation to "Secret rotation" section
- Update backup/restore to include Authentik database
- Update troubleshooting: auth failures (check IdP health, JWT expiry, token refresh)

**`docs/RELAY_OPERATIONS.md`**
- Light touch: relay itself unchanged
- Update any auth context mentions (events still signed with server Nostr key, not JWT)

**`docs/DESIGN.md`**
- Light touch: add note that auth evolved from nsec-only to JWT+IdP+multi-factor
- Keep original design notes as historical context

### Area 4: Docs Site Deploy Guides (4 files)

All in `site/src/content/docs/en/`:

**`deploy-docker.md`**
- MinIO→RustFS in services table, env vars, backup section
- Add `authentik-server` and `authentik-worker` to services table
- Add IdP secret generation to setup section
- Add "Authentik Configuration" subsection

**`deploy-kubernetes.md`**
- MinIO→RustFS in Helm values, PVCs, backup
- Add IdP Helm values section
- Add Authentik deployment (subchart or external)
- Remove `bootstrap-admin` Bun prerequisite

**`deploy-coopcloud.md`**
- MinIO→RustFS in secrets, config, backup
- Add Authentik service to stack
- Add IdP secrets to Swarm secret creation

**`self-hosting.md`**
- MinIO→RustFS in architecture table
- Add "Identity Provider" row (Authentik, self-hosted OIDC)
- Update hardware requirements (add ~512MB for Authentik)

### Area 5: Docs Site User Guides (4 files)

All in `site/src/content/docs/en/`:

**`getting-started.md`**
- Update setup wizard: IdP account creation replaces keypair generation
- Update "Add your first volunteer": invite-based flow, not nsec sharing
- Keep webhook docs as-is

**`admin-guide.md`**
- Rewrite "Logging in": IdP login → PIN unlock → worker decrypts
- Rewrite "Volunteer creation": create profile → generate invite link → volunteer self-onboards
- Update "WebAuthn policy": MFA enforcement settings (per-role)
- Add "Session management": active sessions, remote revocation
- Add "Account recovery": IdP password reset, backup key restore, admin re-enrollment

**`volunteer-guide.md`**
- Rewrite "Getting your credentials": receive invite link → create IdP account → set PIN
- Rewrite "Logging in": IdP session auto-refresh → PIN unlock if needed
- Update "Passkey registration": frame as security key for stronger auth
- Add "If you lose access": IdP password reset, backup file, contact admin

**`reporter-guide.md`**
- Same login/credential flow updates as volunteer guide (smaller scope — reporters have fewer features)

### Area 6: Docs Site Marketing Pages (2 files)

All in `site/src/content/pages/en/`:

**`features.md`**
- Rewrite "Authentication & Key Management" section:
  - Identity provider integration (self-hosted Authentik, OIDC)
  - Multi-factor key protection (PIN + IdP + WebAuthn PRF)
  - Crypto Web Worker isolation
  - Invite-based onboarding
  - JWT session management with auto-refresh
  - WebAuthn passkeys (FIDO2, phishing-resistant)
- Update session model description
- Update recovery/backup section for key-store-v2

**`security.md`**
- Update authentication model: multi-factor KEK, JWT sessions, IdP as remote kill-switch
- Update E2EE section: field-level encryption for ALL PII (shipped v0.28), envelope encryption for messages
- Update "Volunteer identities": now E2EE (not just encrypted-at-rest) — server returns `[encrypted]`, client decrypts
- Add session security: JWT lifecycle, idle auto-lock, remote revocation
- Update key management description with multi-factor derivation
- Remove "Future improvement: E2EE message storage" — it's shipped
- Update security properties table

## Non-Goals

- Spanish or other translations (separate follow-up)
- Existing specs, plans, or epics (internal working docs)
- API reference docs (waiting for OpenAPI in v2)
- New standalone architecture docs (only update existing)
- Migration guide (no production instances to migrate)
- Security audit re-run (separate engagement)

## Implementation Strategy

Create `docs/idp-auth-overhaul` branch off `feat/idp-auth-hardening`. After `feat/idp-auth-hardening` merges to main, retarget the docs PR to main. This keeps the feature PR focused on code and gives a clean review surface for docs.

Execute with parallel agents by area (deployment configs, CLAUDE.md, internal docs, site deploy guides, site user guides, site marketing). No code changes — documentation only.
