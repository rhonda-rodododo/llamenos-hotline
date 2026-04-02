# Core Documentation & CI/CD Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update all internal documentation, protocol specs, security docs, deploy configs, and CI/CD workflows to reflect the current system (JWT+IdP auth, RustFS, field-level E2EE, Contact Directory CMS, PBAC, Zod schemas, PostgreSQL services).

**Architecture:** Two independent tracks executed core-out. Track A (Layers 1-3) updates canonical technical docs, then internal docs, then deploy configs. Track B (Layer 4) restructures CI/CD. Both tracks can run in parallel. Each task is a logical commit.

**Tech Stack:** Markdown documentation, YAML (Helm/Ansible), Bash (docker-setup.sh), GitHub Actions YAML

**Spec:** `docs/superpowers/specs/2026-04-01-documentation-infrastructure-overhaul-design.md`

---

## Track A: Documentation & Deploy Configs

### Task 1: Overhaul Protocol Specification

**Files:**
- Modify: `docs/protocol/llamenos-protocol.md` (649 lines)
- Reference: `src/shared/crypto-labels.ts` (196 lines — 25 domain separation labels)
- Reference: `src/server/lib/jwt.ts` (40 lines — JWT claims structure)
- Reference: `src/client/lib/key-store-v2.ts` (200 lines — v2 blob format)

- [ ] **Step 1: Read current protocol spec and source files**

Read `docs/protocol/llamenos-protocol.md` fully. Then read `src/shared/crypto-labels.ts`, `src/server/lib/jwt.ts`, and `src/client/lib/key-store-v2.ts` to get the ground truth for what needs to be documented.

- [ ] **Step 2: Replace auth flow section**

Find the Schnorr signature authentication section. Replace it with JWT lifecycle documentation:

```markdown
## Authentication

### JWT Token Lifecycle

Authentication uses JWT access tokens (HS256) with httpOnly refresh cookies:

1. **Login**: Client completes Authentik OIDC flow (authorization code + PKCE) → receives IdP tokens
2. **Token exchange**: Client sends IdP access token to `/api/auth/token` → server validates with Authentik, issues JWT access token (15min) + sets httpOnly refresh cookie
3. **API requests**: Client sends `Authorization: Bearer <access_token>` header
4. **Silent refresh**: Before expiry, client calls `/api/auth/refresh` → server validates refresh cookie, issues new access token
5. **Logout**: Client calls `/api/auth/logout` → server revokes refresh token jti in `jwtRevocations` table

### JWT Claims

```typescript
interface AccessTokenPayload {
  sub: string;     // User hex pubkey
  hubId: string;   // Current hub ID
  jti: string;     // Unique token ID (for revocation)
  iat: number;     // Issued at
  exp: number;     // Expiry (15 minutes)
}
```

### Session Binding

JWT sessions are bound to the IdP session. If the Authentik session is revoked (admin action or timeout), the next refresh attempt fails, forcing re-authentication.

### Token Revocation

Individual tokens are revoked by inserting their `jti` into the `jwtRevocations` table. Bulk revocation (e.g., on user deactivation) inserts all active jtis for that user.
```

- [ ] **Step 3: Replace key derivation section**

Find the PIN-only PBKDF2 key derivation section. Replace with multi-factor KEK:

```markdown
## Key Derivation

### Multi-Factor Key Encryption Key (KEK)

The user's private key (nsec) is encrypted at rest using a KEK derived from multiple independent factors:

**Two-factor (default):**
```
factor1 = PBKDF2(PIN, salt, 600_000 iterations, SHA-256) → 32 bytes
factor2 = HKDF-SHA256(idpValue, LABEL_NSEC_KEK_2F) → 32 bytes
KEK = factor1 ⊕ factor2
```

**Three-factor (with WebAuthn PRF):**
```
factor1 = PBKDF2(PIN, salt, 600_000 iterations, SHA-256) → 32 bytes
factor2 = HKDF-SHA256(idpValue, LABEL_NSEC_KEK_2F) → 32 bytes
factor3 = HKDF-SHA256(prfOutput, LABEL_NSEC_KEK_3F) → 32 bytes
KEK = factor1 ⊕ factor2 ⊕ factor3
```

- `PIN`: User-chosen 6+ digit PIN (knowledge factor)
- `idpValue`: Opaque value bound to the user's Authentik account (possession factor — tied to IdP session)
- `prfOutput`: WebAuthn PRF extension output from hardware security key (possession factor — hardware-bound)

### Key Store v2 Blob Format

```typescript
interface KeyStoreV2 {
  version: 2;
  salt: Uint8Array;        // PBKDF2 salt (32 bytes)
  nonce: Uint8Array;       // XChaCha20-Poly1305 nonce (24 bytes)
  ciphertext: Uint8Array;  // Encrypted nsec
  idpIssuer: string;       // Authentik issuer URL (identifies which IdP)
  prfEnabled: boolean;     // Whether WebAuthn PRF factor is included
}
```

v1 blobs (PIN-only) auto-upgrade to v2 on next unlock when an IdP is available.
```

- [ ] **Step 4: Update session model section**

Replace old 8-hour signed token description with JWT session model, idle timeout, configurable expiry.

- [ ] **Step 5: Audit and document all domain separation labels**

Read `src/shared/crypto-labels.ts` and list all 25 labels with their contexts in a table:

```markdown
## Domain Separation Constants

All cryptographic operations use domain-specific context strings from `src/shared/crypto-labels.ts`:

| Label | Context | Used In |
|-------|---------|---------|
| LABEL_NSEC_KEK_2F | Two-factor KEK derivation | key-store-v2.ts |
| LABEL_NSEC_KEK_3F | Three-factor KEK (WebAuthn PRF) | key-store-v2.ts |
| LABEL_HUB_KEY_WRAP | Hub key ECIES wrapping | hub-key-manager.ts |
| ... | ... | ... |
```

Fill in all 25 labels from the actual source file.

- [ ] **Step 6: Remove obsolete sections**

Remove: Schnorr signature challenge-response section, old session token description, old key store v1-only documentation. Keep historical note: "Prior to v0.28, authentication used BIP-340 Schnorr signatures."

- [ ] **Step 7: Commit**

```bash
git add docs/protocol/llamenos-protocol.md
git commit -m "docs: overhaul protocol spec — JWT auth, multi-factor KEK, key-store v2"
```

---

### Task 2: Overhaul E2EE Architecture Document

**Files:**
- Modify: `docs/architecture/E2EE_ARCHITECTURE.md` (534 lines)
- Reference: `src/client/lib/crypto-worker.ts` (Web Worker isolation)
- Reference: `src/client/lib/hub-key-manager.ts` (hub key distribution)
- Reference: `src/client/lib/query-client.ts` (decrypt-on-fetch pattern, ENCRYPTED_QUERY_KEYS)

- [ ] **Step 1: Read current architecture doc and source files**

Read `docs/architecture/E2EE_ARCHITECTURE.md` fully. Then read the crypto worker, hub key manager, and query client source files to understand the current implementation.

- [ ] **Step 2: Add multi-factor KEK derivation section**

After the existing key hierarchy section, add:

```markdown
## Multi-Factor KEK Derivation

The Key Encryption Key (KEK) that protects the user's private key is derived from multiple independent factors:

```
┌─────────┐   ┌───────────┐   ┌──────────────┐
│   PIN   │   │ IdP Value │   │ WebAuthn PRF │
│(knowledge)│   │(possession)│   │  (hardware)  │
└────┬────┘   └─────┬─────┘   └──────┬───────┘
     │              │                │
  PBKDF2         HKDF             HKDF
  600K iter    LABEL_2F          LABEL_3F
     │              │                │
     └──────┬───────┘                │
            XOR                      │
            └────────────┬───────────┘
                         XOR (if 3F enabled)
                         │
                     ┌───┴───┐
                     │  KEK  │
                     └───┬───┘
                         │
                  XChaCha20-Poly1305
                         │
                   ┌─────┴─────┐
                   │ nsec blob │
                   └───────────┘
```

**Security properties:**
- Compromising any single factor is insufficient to derive the KEK
- PIN brute-force requires the IdP value (attacker must also compromise the identity provider)
- IdP compromise requires the PIN (attacker must also brute-force or phish the PIN)
- With WebAuthn PRF: three independent factors must all be compromised simultaneously
```

- [ ] **Step 3: Add three encryption tiers section**

```markdown
## Three Encryption Tiers

Llamenos uses three distinct encryption tiers for stored data:

### Tier 1: Envelope-Encrypted PII (per-user keys)

User names, phone numbers, and contact directory records use ECIES envelope encryption:
- Each field encrypted with a random symmetric key
- Symmetric key ECIES-wrapped for each authorized reader (the user + each admin)
- Decrypted client-side via `decryptObjectFields()` / `decryptArrayFields()` in the crypto worker
- Server stores ciphertext + reader envelopes, returns `[encrypted]` placeholder for unauthorized readers

### Tier 2: Hub-Key Encrypted Org Metadata (shared symmetric key)

Role names, shift names, report type names, custom field labels, team names, and tag names:
- Encrypted with XChaCha20-Poly1305 using the hub's shared symmetric key
- Hub key is a random 32 bytes, ECIES-wrapped individually per member
- Decrypted client-side via `decryptHubField()` using the cached hub key
- On member departure: hub key rotated, re-wrapped for remaining members (departed member excluded)

### Tier 3: Per-Note Forward Secrecy (ephemeral keys)

Call notes, transcripts, and report content:
- Each note encrypted with a unique random symmetric key
- Note key ECIES-wrapped separately for the author and each admin
- Compromising the identity key does NOT reveal past notes (forward secrecy)
- Decrypted client-side via the crypto worker
```

- [ ] **Step 4: Add Web Worker isolation section**

```markdown
## Web Worker Isolation

The user's private key (nsec) never exists on the main thread:

```
┌──────────────────┐         ┌──────────────────┐
│    Main Thread    │         │   Crypto Worker  │
│                   │         │                  │
│  React components │         │  nsec in closure │
│  React Query      │ ──────> │  ECIES decrypt   │
│  UI state         │ postMsg │  ECIES encrypt   │
│                   │ <────── │  HKDF derive     │
│  Receives only    │ result  │  Sign events     │
│  plaintext results│         │                  │
└──────────────────┘         └──────────────────┘
```

- Worker is a singleton — one instance per browser tab
- nsec loaded into worker closure on PIN unlock, zeroed on lock
- All cryptographic operations dispatched via `postMessage`
- Main thread never sees raw key material
- Worker enforces rate limiting: 100 ops/sec, 1000 ops/min
```

- [ ] **Step 5: Add decrypt-on-fetch pattern section**

```markdown
## Decrypt-on-Fetch Pattern

Encrypted data is decrypted in React Query `queryFn` callbacks, not in components:

```typescript
// In queryFn — components receive plaintext
queryFn: async () => {
  const items = await api.getShifts(hubId);
  return items.map(item => ({
    ...item,
    name: decryptHubField(item.encryptedName, hubId, item.name),
  }));
}
```

**ENCRYPTED_QUERY_KEYS** in `src/client/lib/query-client.ts` tracks which query domains contain encrypted data. On lock: encrypted caches are cleared. On unlock: encrypted queries are invalidated and refetched (triggering decryption with the now-available key).

Every query key domain in `queryKeys` must be classified as either `ENCRYPTED_QUERY_KEYS` or `PLAINTEXT_QUERY_KEYS`. Adding a new domain without classifying it produces a compile-time error.
```

- [ ] **Step 6: Add envelope encryption for messaging section**

```markdown
## Envelope Encryption for Messaging

Inbound messages (SMS, WhatsApp, Signal) are encrypted on arrival:

1. Webhook receives plaintext message from provider
2. Server generates random 32-byte symmetric key
3. Message content encrypted with XChaCha20-Poly1305
4. Symmetric key ECIES-wrapped for: assigned volunteer + each admin
5. Server stores ciphertext + envelopes, discards plaintext immediately
6. Client decrypts in conversation view using their private key

**Provider limitation:** The telephony/messaging provider may retain the original plaintext. Encryption protects against server seizure, not provider subpoena.
```

- [ ] **Step 7: Update data-at-rest table**

Update the existing data-at-rest classification table to include:
- JWT tokens: Not E2EE (server-issued, time-limited)
- Authentik credentials: External (managed by Authentik, not in app DB)
- Volunteer name: E2EE (Tier 1 envelope encryption) — was "encrypted at rest"
- Org metadata fields: Tier 2 hub-key encrypted
- Message content: Tier 1 envelope encrypted — was "plaintext"

- [ ] **Step 8: Update key hierarchy diagram**

Update the existing key hierarchy to show:
- IdP-bound factor feeding into KEK derivation
- WebAuthn PRF factor (optional) feeding into KEK derivation
- Hub key as separate branch (not derived from identity key)

- [ ] **Step 9: Commit**

```bash
git add docs/architecture/E2EE_ARCHITECTURE.md
git commit -m "docs: overhaul E2EE architecture — 3 tiers, Web Worker, decrypt-on-fetch, messaging"
```

---

### Task 3: Overhaul Security Documentation (6 files)

**Files:**
- Modify: `docs/security/THREAT_MODEL.md` (761 lines)
- Modify: `docs/security/DATA_CLASSIFICATION.md` (291 lines)
- Modify: `docs/security/DEPLOYMENT_HARDENING.md` (637 lines)
- Modify: `docs/security/KEY_REVOCATION_RUNBOOK.md` (384 lines)
- Modify: `docs/security/README.md` (155 lines)
- Reference: `src/server/db/schema.ts` (for table names and JWT revocations)
- Reference: `src/shared/permissions.ts` (for PBAC permission names)

This task updates all 5 security docs as a batch since they cross-reference each other.

- [ ] **Step 1: Read all security docs and schema**

Read all 5 security docs. Read `src/server/db/schema.ts` to find the `jwtRevocations` table definition and the `users` table (replacing old IdentityDO references). Read `src/shared/permissions.ts` for permission names.

- [ ] **Step 2: Overhaul THREAT_MODEL.md**

Add IdP trust boundary section after existing trust boundaries:

```markdown
### Identity Provider (Authentik) Trust Boundary

Authentik is self-hosted (operator-controlled) and serves as the OIDC identity provider.

**What Authentik knows:**
- User email/username (for OIDC login)
- IdP-bound value (opaque, used as KEK factor — encrypted at rest with IDP_VALUE_ENCRYPTION_KEY)
- Session state (active sessions, last login)

**What Authentik does NOT know:**
- User PIN
- nsec (private key)
- Note content, message content, contact records
- Hub keys

**Compromise scenario:** An attacker who compromises Authentik obtains IdP values (one KEK factor) but NOT PINs or WebAuthn PRF outputs. They can:
- Create new sessions (but cannot decrypt E2EE content without the other KEK factors)
- Block legitimate users (denial of service)
- Read IdP-bound values (but these are one factor of a multi-factor KEK)

**Mitigation:** Multi-factor KEK means IdP compromise alone is insufficient. Detect anomalous sessions via audit logs. Rotate IdP values on suspected compromise.
```

Update device seizure section:
- Old: "6-digit PIN with 600K PBKDF2 iterations takes hours to brute-force on GPU hardware"
- New: "PIN brute-force alone is insufficient — attacker also needs the IdP value (requires compromising the identity provider) and optionally the WebAuthn PRF output (requires the physical hardware key). With all three factors: infeasible without simultaneous compromise of the device, the identity provider, AND the hardware key."

Add JWT token threats:
```markdown
### JWT Token Threats

| Threat | Window | Mitigation |
|--------|--------|------------|
| Access token theft | 15 minutes (token expiry) | Short-lived, no revocation needed for individual tokens |
| Refresh token theft | Until revoked | httpOnly cookie (XSS-resistant), revocable via jti in `jwtRevocations` |
| Token injection | N/A | HS256 requires server-side JWT_SECRET — cannot forge without it |
| Session fixation | N/A | New jti on every refresh, old jti revoked |
```

Add remote kill-switch:
```markdown
### Remote Session Revocation

IdP session revocation provides an immediate remote kill-switch:
1. Admin disables user in Authentik
2. User's next JWT refresh attempt calls Authentik → IdP rejects
3. Refresh fails → client forced to re-authenticate → IdP blocks login
4. All devices locked out simultaneously
5. Optional: bulk insert all user's active jtis into `jwtRevocations` for immediate effect
```

Update attack surface to include Authentik endpoints.

- [ ] **Step 3: Overhaul DATA_CLASSIFICATION.md**

Replace all "IdentityDO" references with PostgreSQL `users` table. Update classification for each data type:

| Data | Old Classification | New Classification |
|------|-------------------|-------------------|
| Volunteer name | Encrypted at rest | E2EE (Tier 1 envelope) |
| Volunteer phone | Encrypted at rest | Server-encrypted (needed for routing) |
| Message content | Plaintext | E2EE (Tier 1 envelope, on server arrival) |
| Role/shift/team names | Plaintext | Encrypted (Tier 2 hub-key) |
| Contact records | N/A (new) | E2EE (Tier 1 envelope) |

Add new data types:
- `idpValue`: Encrypted with `IDP_VALUE_ENCRYPTION_KEY` (server-side, symmetric)
- `webauthnCredentials`: Stored in `users` table, public key material (not sensitive)
- JWT access tokens: Memory-only (client), never persisted
- JWT refresh tokens: httpOnly cookie (client), jti tracked server-side
- Authentik data store: External to app DB (user records, sessions — managed by Authentik)
- Hub-key encrypted fields: role names, shift names, report type names, custom field labels, team names, tag names

Update revision history.

- [ ] **Step 4: Overhaul DEPLOYMENT_HARDENING.md**

Remove Cloudflare Workers architecture section. Add:

```markdown
### Authentik Hardening

- **Network isolation**: Authentik runs on internal Docker network. Only Caddy reverse-proxies the OIDC endpoints needed by clients.
- **Database isolation**: Authentik uses its own PostgreSQL database (separate from app DB in production; shared in dev for simplicity).
- **Blueprint-only provisioning**: Use Authentik custom blueprints (`deploy/docker/authentik-blueprints/llamenos.yaml`) for repeatable configuration. Avoid manual UI changes.
- **API token rotation**: Rotate `AUTHENTIK_BOOTSTRAP_TOKEN` periodically. Use short-lived API tokens for automation.
- **Redis security**: Authentik uses Redis for caching. Bind to localhost/internal network only. Enable `requirepass` in production.
- **Rate limiting**: Authentik has built-in brute-force protection. Configure lockout thresholds in blueprint.
```

Add JWT secret rotation:
```markdown
### JWT Secret Rotation

1. Generate new JWT_SECRET: `openssl rand -hex 32`
2. Set `JWT_SECRET_PREVIOUS` to the old value (allows in-flight tokens to validate during transition)
3. Update `JWT_SECRET` to the new value
4. Restart the app
5. After 15 minutes (max access token lifetime), remove `JWT_SECRET_PREVIOUS`
```

Replace all MinIO → RustFS references. Update hardware specs to include Authentik (+512MB RAM).

- [ ] **Step 5: Overhaul KEY_REVOCATION_RUNBOOK.md**

Update admin key compromise response to include:
- IdP password reset in Authentik
- JWT bulk revocation (insert all active jtis)
- Optional: re-enrollment via new invite

Add IdP-level revocation procedure:
```markdown
### IdP Session Revocation (Immediate Lockout)

1. Open Authentik admin panel
2. Navigate to Directory → Users → select user
3. Click "Deactivate" (prevents new logins)
4. Navigate to Sessions → select all sessions for this user → "Revoke"
5. In Llamenos admin: deactivate the user (prevents API access even if JWT not yet expired)
6. Optional: bulk JWT revocation for immediate effect:
   ```sql
   INSERT INTO jwt_revocations (jti, user_id, expires_at)
   SELECT jti, user_id, expires_at FROM active_sessions WHERE user_id = '<user_id>';
   ```
```

Update volunteer departure to include: deactivate in app + disable in Authentik + JWT revoke.

- [ ] **Step 6: Overhaul security README.md**

Update encryption levels table, auth model summary, feature table (mark shipped items), and "what we don't claim" section (add Authentik compromise caveat).

- [ ] **Step 7: Commit**

```bash
git add docs/security/
git commit -m "docs: overhaul security docs — IdP trust boundary, JWT threats, E2EE classifications"
```

---

### Task 4: Create PBAC Architecture Document

**Files:**
- Create: `docs/architecture/PBAC_ARCHITECTURE.md`
- Reference: `src/shared/permissions.ts` (permission definitions)
- Reference: `src/server/services/identity-service.ts` (permission checking)

- [ ] **Step 1: Read source files for PBAC implementation**

Read `src/shared/permissions.ts` to get the full permission list, default role definitions, and permission scoping model. Read relevant sections of `identity-service.ts` for how permissions are checked server-side.

- [ ] **Step 2: Write PBAC architecture document**

Create `docs/architecture/PBAC_ARCHITECTURE.md` documenting:

1. **Overview**: Permission-based access control replaces fixed roles. Default roles (admin, volunteer, reporter) are templates — organizations can create custom roles with any permission combination.

2. **Permission catalog**: Table of all permissions from `permissions.ts` with descriptions and default role assignments.

3. **Scoping hierarchy**: Hub → Team → Individual. Permissions can be scoped to specific teams.

4. **Server enforcement**: How `requirePermission()` middleware checks permissions on API routes.

5. **Client enforcement**: How `usePermission()` hook gates UI elements. Note: client checks are UX convenience — server is the authority.

6. **E2EE interaction**: Decryption is gated by permission checks on the client side. The server cannot enforce decryption access (it doesn't have keys), but it can refuse to serve ciphertext to unauthorized users.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/PBAC_ARCHITECTURE.md
git commit -m "docs: add PBAC architecture document"
```

---

### Task 5: Create Contact Directory Architecture Document

**Files:**
- Create: `docs/architecture/CONTACT_DIRECTORY.md`
- Reference: `src/server/db/schema.ts` (contacts, contactRelationships, contactTags tables)
- Reference: `src/server/services/contact-service.ts`
- Reference: `src/shared/schemas/contacts.ts`

- [ ] **Step 1: Read source files for Contact Directory implementation**

Read the contacts-related schema definitions, service methods, and shared schemas to understand the data model, relationships, and encryption.

- [ ] **Step 2: Write Contact Directory architecture document**

Create `docs/architecture/CONTACT_DIRECTORY.md` documenting:

1. **Data model**: Contacts table (encrypted name, encrypted phone, encrypted email, encrypted notes), relationships, tags, team associations.

2. **Encryption**: All contact PII uses Tier 1 envelope encryption (ECIES-wrapped per authorized reader). Tags and team names use Tier 2 hub-key encryption.

3. **Auto-linking**: Incoming calls/messages matched to contacts via HMAC-hashed phone number lookup. When a match is found, the call/conversation is associated with the contact record.

4. **Intake workflows**: How new contacts enter the system — manual creation, auto-creation from calls, bulk import.

5. **Bulk operations**: Import/export with client-side encryption/decryption. CSV/JSON format with encrypted field handling.

6. **PBAC integration**: Which permissions gate contact access (view, create, edit, delete, export). Team-scoped access patterns.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/CONTACT_DIRECTORY.md
git commit -m "docs: add Contact Directory architecture document"
```

---

### Task 6: Overhaul Internal Developer Docs (Layer 2)

**Files:**
- Modify: `docs/QUICKSTART.md` (592 lines)
- Modify: `docs/RUNBOOK.md` (1006 lines)
- Modify: `docs/DESIGN.md` (26 lines)
- Modify: `docs/RELAY_OPERATIONS.md` (296 lines)
- Modify: `docs/REPRODUCIBLE_BUILDS.md` (175 lines)
- Modify: `docs/TEST_COVERAGE_GAPS.md` (103 lines)
- Modify: `docs/ops/restore-runbook.md` (121 lines)
- Modify: `deploy/PRODUCTION_CHECKLIST.md` (109 lines)

- [ ] **Step 1: Read all Layer 2 files**

Read all 8 files to understand current content and identify every section that needs updating.

- [ ] **Step 2: Overhaul QUICKSTART.md**

Key changes:
- Replace all MinIO references with RustFS
- Add Authentik to service list and health check sequence
- Replace `bun run bootstrap-admin` with setup wizard flow (IdP registration → PIN → key generation)
- Add IdP secret generation section:
  ```bash
  # Generate IdP/auth secrets
  JWT_SECRET=$(openssl rand -hex 32)
  IDP_VALUE_ENCRYPTION_KEY=$(openssl rand -base64 32)
  AUTHENTIK_SECRET_KEY=$(openssl rand -hex 32)
  AUTHENTIK_BOOTSTRAP_TOKEN=$(openssl rand -hex 32)
  ```
- Update first-login flow: Authentik account creation, not nsec entry
- Fix any webhook URLs missing `/api/` prefix
- Add Contact Directory to feature overview
- Verify dev port offsets table is current

- [ ] **Step 3: Overhaul RUNBOOK.md**

Key changes:
- Replace all MinIO references with RustFS
- Add Authentik operational procedures section:
  - Health monitoring: `curl http://authentik-server:9000/-/health/ready/`
  - Backup: Authentik PostgreSQL DB + Redis dump
  - User management: CLI commands for user creation/deactivation
  - Blueprint updates: how to apply blueprint changes
- Add JWT secret rotation to "Secret rotation" section (procedure from DEPLOYMENT_HARDENING.md)
- Add IDP_VALUE_ENCRYPTION_KEY rotation (versioned — increment `IDP_VALUE_KEY_VERSION`)
- Update backup/restore to include Authentik database
- Update troubleshooting: auth failures (check IdP health, JWT expiry, token refresh, `jwtRevocations`)
- Add Contact Directory operations section (bulk import/export, tag management)

- [ ] **Step 4: Update DESIGN.md**

Add header marking it as historical:
```markdown
# Design Notes (Original v0.x)

> **Note:** These are the original design notes from project inception. For current architecture, see `docs/architecture/`. For current protocol, see `docs/protocol/llamenos-protocol.md`.
```

Add brief summary of key evolutions: auth (nsec → JWT+IdP), storage (CF DO → PostgreSQL, R2/MinIO → RustFS), services (Durable Objects → PostgreSQL-backed services).

- [ ] **Step 5: Update RELAY_OPERATIONS.md**

Light touch:
- Update Nosflare section: mark as deprecated (strfry is the only supported relay)
- Clarify: relay auth is NIP-42 with server Nostr key, unrelated to JWT auth
- Remove any CF deployment references

- [ ] **Step 6: Update REPRODUCIBLE_BUILDS.md**

- Clarify scope: reproducible builds cover the Llamenos app image only
- Document digest pinning for external images (Authentik, strfry, RustFS, PostgreSQL)
- Add Authentik image to the list of pinned dependencies

- [ ] **Step 7: Update TEST_COVERAGE_GAPS.md**

Add new gaps:
- JWT/Authentik auth flow integration tests
- Multi-factor KEK derivation edge cases
- Contact Directory CRUD + search + auto-linking
- PBAC permission scoping (team-level, hub-level)
- Hub-key encryption/decryption round-trip
- Envelope encryption for messaging channels

Review and remove any gaps that have been filled by recent work.

- [ ] **Step 8: Update restore-runbook.md**

Add Authentik to restore procedure:
```markdown
## Restore Order

1. PostgreSQL (app database)
2. Authentik PostgreSQL (identity provider database)
3. RustFS (blob storage — voicemails, attachments, exports)
4. strfry (Nostr relay — optional, events regenerate)
5. Restart all services
6. Verify: app health check + Authentik health + user login
```

Add Authentik Redis cache note: Redis cache rebuilds automatically after Authentik restart.

- [ ] **Step 9: Update PRODUCTION_CHECKLIST.md**

Add IdP/Authentik checklist items:
```markdown
### Identity Provider (Authentik)
- [ ] `JWT_SECRET` generated (min 32 hex chars)
- [ ] `IDP_VALUE_ENCRYPTION_KEY` generated (base64, 32 bytes)
- [ ] `AUTHENTIK_SECRET_KEY` generated (min 50 chars)
- [ ] `AUTHENTIK_BOOTSTRAP_TOKEN` generated (min 32 hex bytes)
- [ ] `AUTH_WEBAUTHN_RP_ID` set to production domain
- [ ] `AUTH_WEBAUTHN_RP_NAME` set (default: "Hotline")
- [ ] `AUTH_WEBAUTHN_ORIGIN` set to `https://{domain}`
- [ ] Authentik health check passing (`/-/health/ready/`)
- [ ] Authentik blueprint applied (`llamenos.yaml`)
- [ ] Admin account created in Authentik
- [ ] First admin login + PIN setup completed
- [ ] Test invite link generation + volunteer onboarding
```

Update any MinIO → RustFS references. Add Contact Directory verification.

- [ ] **Step 10: Commit**

```bash
git add docs/QUICKSTART.md docs/RUNBOOK.md docs/DESIGN.md docs/RELAY_OPERATIONS.md \
  docs/REPRODUCIBLE_BUILDS.md docs/TEST_COVERAGE_GAPS.md docs/ops/restore-runbook.md \
  deploy/PRODUCTION_CHECKLIST.md
git commit -m "docs: overhaul internal docs — IdP auth, RustFS, Contact Directory, PBAC"
```

---

### Task 7: Update Root README.md and CLAUDE.md

**Files:**
- Modify: `README.md` (310 lines)
- Modify: `CLAUDE.md` (235 lines)

- [ ] **Step 1: Read both files**

Read `README.md` and `CLAUDE.md` fully.

- [ ] **Step 2: Update README.md**

Key changes:
- Update auth description: "JWT + Authentik IdP + multi-factor KEK + WebAuthn passkeys"
- Update storage: "RustFS (S3-compatible blob storage)" — remove any MinIO references
- Update core services list: add Authentik (authentik-server, authentik-worker)
- Update feature highlights: mark shipped items (E2EE messaging, client-side transcription, reproducible builds, Contact Directory, PBAC)
- Update architecture summary if it references Durable Objects or CF Workers
- Ensure development setup instructions reference Authentik

- [ ] **Step 3: Update CLAUDE.md**

Key changes (per spec section 2.8):
- Update Auth line in tech stack: "Nostr keypairs (BIP-340) + WebAuthn" → "JWT + Authentik IdP (OIDC) + multi-factor KEK + WebAuthn passkeys"
- Add Key Technical Patterns: IdP adapter interface, auth facade (`/api/auth/*`), crypto Web Worker isolation, decrypt-on-fetch via React Query, key-store-v2 multi-factor format
- Update directory structure: add `src/server/idp/`, `src/server/routes/auth-facade.ts`, `src/client/lib/key-store-v2.ts`, `src/client/lib/crypto-worker*.ts`
- Add gotchas: crypto worker is a singleton (one per tab), decrypt rate limiter (100/sec, 1000/min), synthetic IdP values in dev/test mode, auth facade endpoints at `/api/auth/*`
- Add env vars: `JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`, `AUTHENTIK_URL`, `AUTHENTIK_API_TOKEN`, `AUTHENTIK_SECRET_KEY`, `AUTHENTIK_BOOTSTRAP_TOKEN`, `AUTH_WEBAUTHN_RP_ID`, `AUTH_WEBAUTHN_RP_NAME`, `AUTH_WEBAUTHN_ORIGIN`
- Add Authentik to core services, note first-boot wait (~60s for migrations)

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md — IdP auth, RustFS, new features"
```

---

### Task 8: Fix Deployment Configurations (Layer 3)

**Files:**
- Modify: `deploy/helm/llamenos/values.yaml` (165 lines)
- Modify: `deploy/helm/llamenos/templates/secret.yaml` (27 lines)
- Modify: `deploy/helm/llamenos/templates/deployment-app.yaml` (159 lines)
- Modify: `scripts/docker-setup.sh` (178 lines)
- Modify: `deploy/docker/docker-compose.dev.yml` (90 lines)

- [ ] **Step 1: Read all deploy config files**

Read all 5 files to understand current structure and identify gaps.

- [ ] **Step 2: Update Helm values.yaml**

Add IdP configuration section after existing `secrets:` block:

```yaml
# Identity Provider (Authentik)
idp:
  adapter: authentik
  authentikUrl: http://authentik-server:9000

# Auth secrets (all required for production)
secrets:
  # ... existing secrets ...
  jwtSecret: ""                    # Required — 32+ hex chars
  idpValueEncryptionKey: ""        # Required — base64, 32 bytes
  authentikSecretKey: ""           # Required — 50+ chars
  authentikBootstrapToken: ""      # Required — 32+ hex bytes
  webauthnRpId: ""                 # Defaults to ingress host
  webauthnRpName: "Hotline"
  webauthnOrigin: ""               # Defaults to https://{ingress.host}
```

- [ ] **Step 3: Update Helm secret.yaml**

Add IdP secret data fields:

```yaml
  jwt-secret: {{ .Values.secrets.jwtSecret | b64enc }}
  idp-value-encryption-key: {{ .Values.secrets.idpValueEncryptionKey | b64enc }}
  authentik-secret-key: {{ .Values.secrets.authentikSecretKey | b64enc }}
  authentik-bootstrap-token: {{ .Values.secrets.authentikBootstrapToken | b64enc }}
```

- [ ] **Step 4: Update Helm deployment-app.yaml**

Add env vars sourced from secrets:

```yaml
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: {{ include "llamenos.secretName" . }}
              key: jwt-secret
        - name: IDP_VALUE_ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: {{ include "llamenos.secretName" . }}
              key: idp-value-encryption-key
        - name: IDP_ADAPTER
          value: {{ .Values.idp.adapter | quote }}
        - name: AUTHENTIK_URL
          value: {{ .Values.idp.authentikUrl | quote }}
        - name: AUTHENTIK_API_TOKEN
          valueFrom:
            secretKeyRef:
              name: {{ include "llamenos.secretName" . }}
              key: authentik-bootstrap-token
        - name: AUTH_WEBAUTHN_RP_ID
          value: {{ .Values.secrets.webauthnRpId | default .Values.ingress.host | quote }}
        - name: AUTH_WEBAUTHN_RP_NAME
          value: {{ .Values.secrets.webauthnRpName | default "Hotline" | quote }}
        - name: AUTH_WEBAUTHN_ORIGIN
          value: {{ .Values.secrets.webauthnOrigin | default (printf "https://%s" (.Values.ingress.host | default "localhost")) | quote }}
```

- [ ] **Step 5: Update docker-setup.sh**

After the existing secret generation block, add IdP secret generation:

```bash
# === IdP / Auth Secrets ===
JWT_SECRET=$(openssl rand -hex 32)
IDP_VALUE_ENCRYPTION_KEY=$(openssl rand -base64 32)
AUTHENTIK_SECRET_KEY=$(openssl rand -hex 32)
AUTHENTIK_BOOTSTRAP_TOKEN=$(openssl rand -hex 32)

# WebAuthn config (derived from domain)
if [[ -n "${DOMAIN:-}" ]]; then
  AUTH_WEBAUTHN_RP_ID="$DOMAIN"
  AUTH_WEBAUTHN_ORIGIN="https://$DOMAIN"
else
  AUTH_WEBAUTHN_RP_ID="localhost"
  AUTH_WEBAUTHN_ORIGIN="http://localhost:3000"
fi
AUTH_WEBAUTHN_RP_NAME="Hotline"
```

Add these vars to the `.env` file write section. Add Authentik health wait after `docker compose up`:

```bash
echo "Waiting for Authentik to be ready..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:9100/-/health/ready/ > /dev/null 2>&1; then
    echo "Authentik ready"
    break
  fi
  sleep 2
done
```

- [ ] **Step 6: Cleanup docker-compose.dev.yml**

Update the comment at the top: replace any MinIO references with RustFS. Verify port offset comments are accurate.

- [ ] **Step 7: Commit**

```bash
git add deploy/helm/llamenos/values.yaml deploy/helm/llamenos/templates/secret.yaml \
  deploy/helm/llamenos/templates/deployment-app.yaml scripts/docker-setup.sh \
  deploy/docker/docker-compose.dev.yml
git commit -m "fix: complete Helm IdP config, docker-setup.sh IdP secrets, cleanup stale refs"
```

---

## Track B: CI/CD Pipeline Restructuring

### Task 9: Split ci.yml into CI + Release workflows

**Files:**
- Modify: `.github/workflows/ci.yml` (827 lines)
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Read current ci.yml fully**

Read `.github/workflows/ci.yml` to understand the complete pipeline. Identify which jobs are PR-validation (lint, build, test) vs release (version-bump, changelog, GitHub Release, GPG signing, SLSA).

- [ ] **Step 2: Refactor ci.yml to PR-only**

Strip ci.yml down to PR validation only:

```yaml
name: CI

on:
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

Keep jobs: `detect-changes`, `lint`, `build` (app + site), `audit`, `unit-tests`, `integration-tests`, `api-tests`, `e2e-tests`, `ansible-validate`.

Remove jobs: `version`, `release`, `slsa-provenance`, `gpg-sign` (these move to release.yml).

Remove: the `push: branches: [main]` trigger. Remove the `if: github.ref == 'refs/heads/main'` conditions on PR-only jobs. Remove `needs: [version]` dependencies from removed jobs.

- [ ] **Step 3: Create release.yml**

Create `.github/workflows/release.yml` with the extracted release jobs:

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false  # Never cancel a release in progress
```

Include jobs: `detect-changes`, `build` (needed for CHECKSUMS), `version` (conventional commits → semver), `release` (GitHub Release + changelog), `slsa-provenance`, `gpg-sign`.

The `detect-changes` job should skip the entire workflow for docs-only changes (same logic as current ci.yml).

The version job creates a git tag, which triggers `docker.yml`. The release event triggers `auto-deploy-demo.yml` and `deploy-site.yml`.

- [ ] **Step 4: Verify all job dependencies are correct**

Check that:
- `version` depends on `build` (for CHECKSUMS)
- `release` depends on `version`
- `slsa-provenance` depends on `build`
- `gpg-sign` depends on `release`
- No circular dependencies
- All secrets referenced exist in the release workflow context

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: split ci.yml into PR-only CI + main-branch release workflow"
```

---

### Task 10: Create deploy-site.yml workflow

**Files:**
- Create: `.github/workflows/deploy-site.yml`
- Reference: `site/wrangler.jsonc` (Cloudflare Pages config)
- Reference: `site/package.json` (build scripts)

- [ ] **Step 1: Read site config files**

Read `site/wrangler.jsonc` and `site/package.json` to understand the build and deploy config.

- [ ] **Step 2: Create deploy-site.yml**

```yaml
name: Deploy Site

on:
  # Deploy on new release
  release:
    types: [published]
  # Deploy on site content changes pushed to main
  push:
    branches: [main]
    paths:
      - 'site/**'
  # Manual deploy
  workflow_dispatch:

concurrency:
  group: deploy-site
  cancel-in-progress: true

jobs:
  deploy:
    name: Deploy to Cloudflare Pages
    runs-on: ubuntu-latest
    environment: cloudflare-pages
    permissions:
      contents: read
      deployments: write

    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"

      - name: Install dependencies
        working-directory: site
        run: bun install --frozen-lockfile

      - name: Build
        working-directory: site
        run: bun run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@da0e0235b4e36800f54b0a64e623b8b3ef1c02e4 # v3.14.0
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          workingDirectory: site
          command: pages deploy dist --project-name llamenos-site
```

Note: The action SHA should be verified at implementation time. Use `cloudflare/wrangler-action@v3` and pin the SHA.

- [ ] **Step 3: Verify secrets documentation**

Ensure the plan documents that these GitHub secrets must be configured:
- `CF_API_TOKEN`: Cloudflare API token with Pages edit permission
- `CF_ACCOUNT_ID`: Cloudflare account ID

These go in the `cloudflare-pages` environment in GitHub repo settings.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-site.yml
git commit -m "ci: add deploy-site.yml — Cloudflare Pages deployment on release/site changes"
```

---

## Final Verification

### Task 11: Cross-reference check and build validation

- [ ] **Step 1: Verify all cross-references**

Grep for any remaining MinIO references across all modified files:
```bash
grep -ri "minio" docs/ deploy/ scripts/ README.md CLAUDE.md --include="*.md" --include="*.yaml" --include="*.yml" --include="*.sh"
```

Fix any remaining references.

- [ ] **Step 2: Grep for stale references**

Check for outdated terms:
```bash
grep -ri "durable object\|cloudflare worker\|IdentityDO\|worker\.ts\|wrangler deploy" docs/ --include="*.md"
```

Fix any remaining references.

- [ ] **Step 3: Verify Helm chart renders**

```bash
cd deploy/helm && helm template llamenos llamenos/ --set secrets.jwtSecret=test --set secrets.idpValueEncryptionKey=test --set secrets.authentikSecretKey=test --set secrets.authentikBootstrapToken=test | head -100
```

Verify the IdP env vars appear in the rendered deployment.

- [ ] **Step 4: Verify docker-setup.sh syntax**

```bash
bash -n scripts/docker-setup.sh
```

- [ ] **Step 5: Validate CI workflow syntax**

```bash
# Requires actionlint installed, or use:
for f in .github/workflows/*.yml; do echo "--- $f ---"; python3 -c "import yaml; yaml.safe_load(open('$f'))" && echo "OK"; done
```

- [ ] **Step 6: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

These should not be affected by docs/config changes, but verify nothing was accidentally modified.

- [ ] **Step 7: Final commit if any fixes needed**

```bash
git add -A
git commit -m "docs: fix cross-references and stale terms from overhaul"
```
