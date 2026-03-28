# Plan: IdP Auth — Project Documentation Updates

**Status**: Not started
**Branch**: feat/idp-auth-hardening
**Context**: CLAUDE.md and internal docs need to reflect the new auth architecture. This is the source of truth for AI-assisted development.

## Tasks

### 1. CLAUDE.md — Auth Architecture Section
- [ ] Replace `**Auth**: Nostr keypairs (BIP-340 Schnorr signatures) + WebAuthn session tokens` with updated description:
  ```
  **Auth**: JWT sessions via IdP facade (Authentik default) + multi-factor nsec encryption
  (PIN + IdP value + optional WebAuthn PRF). Crypto Web Worker isolates nsec from main thread.
  ```
- [ ] Add IdP adapter pattern to "Key Technical Patterns" table:
  ```
  **IdP Adapter**: Abstract interface for identity providers (Authentik, generic OIDC).
  Auth facade (`/api/auth/*`) handles JWT lifecycle, WebAuthn ceremonies, and user provisioning.
  All auth goes through the facade — never call IdP APIs directly from UI code.
  ```
- [ ] Update "Key management" bullet to describe multi-factor KEK:
  ```
  **Key management**: key-store-v2 encrypts nsec with multi-factor KEK derived from
  PIN + IdP-bound value + optional WebAuthn PRF output. Crypto Worker holds nsec in
  closure — never exposed to main thread. Synthetic IdP values for offline/recovery.
  ```
- [ ] Add crypto Web Worker to key patterns:
  ```
  **Crypto Web Worker**: All private key operations (sign, decrypt, ECIES unwrap) run in
  an isolated Web Worker. Main thread communicates via postMessage. Single worker singleton
  shared by key-manager and decrypt-fields.
  ```
- [ ] Add decrypt-on-fetch pattern:
  ```
  **Decrypt-on-fetch**: Server returns `[encrypted]` placeholder + `encryptedFoo` + `fooEnvelopes`.
  Client hooks (`useDecryptedArray`/`useDecryptedObject`) decrypt via worker and re-render.
  Field convention: `encryptedFoo` ciphertext + `fooEnvelopes` ECIES envelopes → plaintext `foo`.
  ```
- [ ] Add Authentik to core services in Architecture table
- [ ] Add new env vars to "Gotchas" or new "Environment Variables" section:
  - `JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`, `AUTHENTIK_URL`, `AUTHENTIK_API_TOKEN`
  - `AUTH_WEBAUTHN_RP_ID`, `AUTH_WEBAUTHN_RP_NAME`, `AUTH_WEBAUTHN_ORIGIN`

### 2. CLAUDE.md — Directory Structure
- [ ] Add `src/server/idp/` directory with description:
  ```
  idp/              # Identity Provider adapters
    adapter.ts      # IdP adapter interface
    authentik-adapter.ts  # Authentik OIDC implementation
  ```
- [ ] Add `src/server/routes/auth-facade.ts` to routes description
- [ ] Add `src/client/lib/key-store-v2.ts`, `crypto-worker.ts`, `crypto-worker-client.ts` to client lib description
- [ ] Add `deploy/docker/authentik-blueprints/` to deployment docs

### 3. CLAUDE.md — Development Commands
- [ ] Add `docker-compose.dev-idp.yml` for IdP-isolated dev environment
- [ ] Document `bun run bootstrap-admin` still works (or note if changed)
- [ ] Add note about Authentik first-boot wait time (~60s)

### 4. CLAUDE.md — Gotchas
- [ ] Add: `getCryptoWorker()` must return the singleton — never create a second CryptoWorkerClient
- [ ] Add: Decrypt rate limit is 100/sec, 1000/min — auto-locks worker if exceeded
- [ ] Add: `key-store-v2` uses synthetic IdP values for device-link/recovery; real rotation happens on first unlock
- [ ] Add: Auth facade endpoints live at `/api/auth/*` — WebAuthn at `/api/auth/webauthn/*`

### 5. Architecture Decision Record (optional)
- [ ] Create `docs/architecture/adr-idp-auth-facade.md` explaining:
  - Why JWT + IdP instead of pure Nostr
  - Why Authentik (self-hosted, FOSS, OIDC-compliant, attribute store for nsec_secret)
  - Multi-factor KEK design rationale
  - Web Worker isolation rationale
  - Rate limiter design for envelope decryption

## Acceptance Criteria
- CLAUDE.md accurately describes the new auth architecture
- New developers can understand the auth flow from CLAUDE.md alone
- Directory structure section shows IdP and auth facade files
- All new gotchas documented
