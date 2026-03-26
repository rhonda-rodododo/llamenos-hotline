# IdP-Agnostic Auth Facade & Multi-Factor Nsec Hardening

**Date:** 2026-03-25
**Status:** Draft
**Scope:** Core integration — single-instance self-hosted. Multi-tenant hosted IdP is a follow-up spec.

## Problem

The current authentication architecture has four vulnerabilities against well-funded adversaries:

1. **PIN-only nsec encryption** — 6-8 digit PIN (~20-26 bits) protecting the Nostr secret key in localStorage. Offline brute-force is trivial with GPU farms on a seized device.
2. **No remote kill switch** — if a device is stolen, there's no way to remotely invalidate the nsec encryption. The encrypted blob persists and can be attacked indefinitely.
3. **No centralized auth policy** — WebAuthn is optional, session management is custom, MFA enforcement is per-volunteer choice. No organizational control over auth posture.
4. **XSS nsec exposure** — the decrypted nsec lives in the main thread's JS closure. Any XSS can exfiltrate it permanently.

## Solution

Three architectural changes:

1. **IdP-agnostic auth facade** — our server proxies all authentication (including WebAuthn) and delegates user/session management to a pluggable IdP backend. Authentik is the default. The client never talks to the IdP directly.
2. **Multi-factor nsec encryption** — the KEK (Key Encryption Key) is derived from three independent factors: user PIN, WebAuthn PRF output (hardware-bound), and an IdP-stored per-user secret. Revoking the IdP session permanently prevents nsec decryption.
3. **Web Worker key isolation** — the decrypted nsec never exists in the main thread. All crypto operations happen in a dedicated Web Worker that exposes only `sign()` and `decrypt()` operations.

## Architecture Overview

### Separation of Concerns

| Layer | Owner | Responsibility |
|-------|-------|----------------|
| **Authentication** | Auth facade (our server) + IdP adapter | WebAuthn ceremonies, session lifecycle, MFA enforcement |
| **Authorization** | Hono backend | Permission resolution, hub membership, role checks (unchanged) |
| **Cryptographic identity** | Nostr keypair (client-side) | E2EE operations — note encryption, hub key wrapping, relay event signing |
| **Nsec protection** | Multi-factor KEK (client-side) | PIN + IdP-derived value + WebAuthn PRF (when available) |

### Key Architectural Decision: Remove Schnorr as Server Auth

Schnorr signature authentication is **removed as a server authentication method**. The backend validates JWTs issued by the auth facade only. Schnorr signing is retained exclusively for Nostr relay event signatures.

**Rationale:** if both Schnorr and JWT auth paths are accepted, an attacker who extracts the nsec bypasses all IdP hardening. Single auth path through the facade means the IdP's protections (session revocation, MFA, device trust) can't be circumvented.

## Auth Facade

### Endpoint Surface

The client only ever talks to our server's auth endpoints:

```
POST /auth/webauthn/register-options
POST /auth/webauthn/register-verify
POST /auth/webauthn/login-options
POST /auth/webauthn/login-verify
POST /auth/token/refresh
POST /auth/session/revoke
GET  /auth/userinfo              # returns idp_value + pubkey
POST /auth/invite/accept
GET  /auth/devices               # list registered passkeys
DELETE /auth/devices/:id
```

### Request Flow

```
Client -> Auth Facade (our server) -> IdP Adapter -> IdP (Authentik, etc.)
```

WebAuthn credentials are bound to **our domain** (e.g., `app.llamenos.org`), not the IdP's. Swapping IdP providers does not invalidate passkeys.

### IdP Adapter Interface

Follows the same pattern as `TelephonyAdapter`:

```typescript
interface IdPAdapter {
  // User lifecycle
  createUser(pubkey: string): Promise<IdPUser>
  getUser(pubkey: string): Promise<IdPUser | null>
  deleteUser(pubkey: string): Promise<void>

  // Nsec encryption secret (the idp_value)
  // getNsecSecret: called by facade during token refresh to return the
  // per-user secret for KEK derivation. Uses the adapter's service account
  // credentials, not the user's OIDC tokens.
  getNsecSecret(pubkey: string): Promise<Uint8Array>
  // rotateNsecSecret: generates a new secret, retains old for migration window.
  // Returns the new secret. See "idp_value Rotation Procedure" section.
  rotateNsecSecret(pubkey: string): Promise<{ current: Uint8Array; previous?: Uint8Array }>
  confirmRotation(pubkey: string): Promise<void>

  // Session management — the facade does NOT use OIDC code exchange flows.
  // The facade authenticates users via WebAuthn (which it owns) and uses
  // the IdP purely as a user/secret store via service account API calls.
  // These methods manage the IdP's internal session state for revocation.
  refreshSession(pubkey: string): Promise<{ valid: boolean }>
  revokeSession(pubkey: string): Promise<void>
  revokeAllSessions(pubkey: string): Promise<void>

  // Invite / enrollment
  createInviteLink(opts: InviteOpts): Promise<string>
}
```

**Note on OIDC code exchange:** The original design considered OIDC authorization code flows where the client redirects to the IdP. Since the facade proxies all auth (including WebAuthn), there is no OIDC redirect. The facade communicates with the IdP via **service account API calls** (e.g., Authentik's REST API with `AUTHENTIK_API_TOKEN`). The `exchangeCode()` method from earlier iterations has been removed.

### What the Facade Owns vs. What the IdP Owns

| Concern | Facade (our server) | IdP (behind adapter) |
|---------|---------------------|----------------------|
| WebAuthn ceremonies | Registration, authentication, PRF — RP is our domain | Nothing |
| Session tokens | Issues JWTs signed with our key | Stores user record, issues idp_value |
| MFA policy | Enforces "WebAuthn required" at registration | N/A |
| Rate limiting | Our middleware | N/A |
| User creation | Orchestrates: WebAuthn register -> create IdP user -> link pubkey | Stores user + nsec_secret attribute |
| Token refresh | Client calls `/auth/token/refresh` -> facade calls adapter | Returns fresh idp_value |
| Session revocation | Invalidate JWTs + call adapter | Revokes its own session/tokens |
| Invite links | Generate + validate invite codes | Create user account on acceptance |
| Auth audit | Log to hash-chained audit log | Adapter can pull IdP events (deferred) |

### Session Strategy

The facade issues its own JWTs:

- **Access JWT**: 15-minute TTL, signed with server key, contains `{ sub: pubkey, permissions: [...] }`
- **Refresh flow**: client calls `/auth/token/refresh` -> facade validates refresh token -> calls IdP adapter to confirm session validity + fetch fresh `idp_value` -> issues new access JWT
- **Revocation**: revoke at IdP, next refresh fails. Short JWT TTL (15 min) limits the window.
- **CSRF protection**: refresh token cookie uses `SameSite=Strict; Secure; HttpOnly; Path=/auth/token`. The `/auth/token/refresh` endpoint additionally requires a JSON body (`Content-Type: application/json`), which triggers a CORS preflight and prevents simple cross-origin form submissions.
- **JWT signing**: symmetric HMAC-SHA256 for single-instance deployments. The spec notes that multi-instance deployments (follow-up) should migrate to asymmetric signing (EdDSA) so that the signing key and verification key are separate.

## Multi-Factor Nsec Encryption

### New Domain Separation Constants

The following constants must be added to `src/shared/crypto-labels.ts`:

```typescript
LABEL_KEK_PRF = 'llamenos:kek-prf'           // WebAuthn PRF evaluation salt
LABEL_NSEC_KEK_3F = 'llamenos:nsec-kek:3f'   // HKDF info for 3-factor KEK derivation
LABEL_NSEC_KEK_2F = 'llamenos:nsec-kek:2f'   // HKDF info for 2-factor KEK derivation
LABEL_IDP_VALUE_WRAP = 'llamenos:idp-value-wrap'  // Envelope encryption of idp_value at rest
```

### Key Derivation

```
+--------------+  +-------------------+  +------------------+
|  User PIN    |  |  WebAuthn PRF     |  |  IdP-derived     |
|  (memory)    |  |  (hardware)       |  |  value (remote)  |
+------+-------+  +--------+----------+  +--------+---------+
       |                    |                      |
  PBKDF2-SHA256      PRF extension           Fetch from IdP
  600K iterations    LABEL_KEK_PRF           via auth facade
       |                    |                      |
       v                    v                      v
  pin_derived(32B)    prf_output(32B)        idp_value(32B)
       |                    |                      |
       +----------+---------+----------------------+
                  |
            HKDF-SHA256
            salt: random 32 bytes (stored with blob)
            info: LABEL_NSEC_KEK_3F (or LABEL_NSEC_KEK_2F)
                  |
                  v
              KEK (32 bytes)
                  |
          XChaCha20-Poly1305
                  |
                  v
          encrypted nsec blob
```

**HKDF input construction:** The IKM is the concatenation of all available factors. Each factor is exactly 32 bytes, so no length-prefixing is needed. The `info` parameter differentiates the factor combination (`LABEL_NSEC_KEK_3F` vs `LABEL_NSEC_KEK_2F`), preventing domain confusion if the same salt is reused across an upgrade.

**PIN entropy note:** The PIN's entropy is intentionally low for UX. Security against offline brute-force comes from the IdP value and PRF factors, not the PIN. The PIN exists to prevent trivial unauthorized use of an already-authenticated device.

### Factor Properties

| Factor | Source | Extractable from device? | Remotely revocable? |
|--------|--------|--------------------------|---------------------|
| PIN | User memory | No (never stored) | No |
| WebAuthn PRF | Hardware authenticator | No (bound to authenticator chip) | No (but credential can be deregistered) |
| IdP value | OIDC provider via facade | Only if refresh token is valid | Yes — revoke session, blob is permanently dead |

### Graceful Degradation

```
PRF available   -> KEK = HKDF(pin_derived || prf_output || idp_value, info=LABEL_NSEC_KEK_3F)  [3-factor]
PRF unavailable -> KEK = HKDF(pin_derived || idp_value, info=LABEL_NSEC_KEK_2F)               [2-factor]
```

Both paths require the IdP to be reachable. Remote revocation works regardless.

**`prfUsed` flag integrity:** The `prfUsed` flag in the stored blob is NOT integrity-protected (it's outside the ciphertext). An attacker could flip it from `true` to `false` to attempt 2-factor decryption. This is harmless: the 3-factor KEK and 2-factor KEK are derived with different HKDF `info` parameters, so a 2-factor derivation produces a completely different key and XChaCha20-Poly1305 decryption will fail with an authentication error.

### The `idp_value`

A dedicated per-user random 32-byte secret:

- Generated at account creation, stored as a user attribute in the IdP
- Returned via the auth facade's `/auth/userinfo` endpoint (requires valid session)
- Never changes unless explicitly rotated (which triggers nsec re-encryption on next login)
- **Envelope-encrypted at rest in the IdP** — the value stored in Authentik's user attributes is encrypted with a key held by our server (`IDP_VALUE_ENCRYPTION_KEY`). An IdP database breach alone yields nothing.

### `idp_value` Rotation Procedure

When `rotateNsecSecret()` is called (admin-initiated only):

1. The IdP adapter generates a new 32-byte secret but **retains the old value** temporarily
2. On the volunteer's next login/unlock, the facade returns both old and new values via `/auth/userinfo` (a one-time `pendingRotation` field)
3. The client decrypts the nsec blob using the old `idp_value`, then immediately re-encrypts with the new `idp_value` and stores the updated blob
4. The client confirms re-encryption to the facade via `POST /auth/rotation/confirm`
5. The facade instructs the IdP adapter to discard the old value

If the volunteer does not log in within a configurable window (default: 30 days), the old value is discarded and the volunteer must re-enroll via admin-assisted device linking. This is acceptable because inactive volunteers are an operational concern regardless.

Bulk rotation (e.g., after IdP compromise detection) follows the same per-user flow — each volunteer re-encrypts on their next login.

### Storage Format (localStorage)

```json
{
  "version": 2,
  "kdf": "pbkdf2-sha256",
  "cipher": "xchacha20-poly1305",
  "salt": "<32-byte hex>",
  "nonce": "<24-byte hex>",
  "ciphertext": "<encrypted nsec>",
  "pubkeyHash": "<HMAC_KEYID_PREFIX-hashed pubkey>",
  "prfUsed": true,
  "idpIssuer": "https://app.llamenos.org/auth"
}
```

The `kdf` and `cipher` fields enable future algorithm upgrades (e.g., Argon2id) without breaking the version check. The `pubkeyHash` uses the existing `HMAC_KEYID_PREFIX` constant from `crypto-labels.ts` for continuity with v1.

## Authentication Flows

### Flow 1: Initial Device Setup

```
Volunteer receives invite link
  -> Browser opens, redirected to facade login
  -> WebAuthn passkey registration (mandatory)
      Mobile: biometrics
      Desktop with platform auth: Touch ID / Windows Hello
      Desktop without: cross-device QR -> phone passkey
  -> Facade creates IdP user, generates idp_value
  -> App: "Choose a PIN" (6-8 digits)
  -> App: request WebAuthn PRF
      PRF supported -> prf_output captured
      PRF unsupported -> 2-factor mode
  -> Derive KEK -> encrypt nsec -> store v2 blob
  -> Device trusted, volunteer lands on dashboard
```

**New volunteers:** nsec generated client-side after WebAuthn registration and IdP enrollment are complete.

**Existing volunteers (new device):** The ordering is critical for security:
1. New device completes WebAuthn registration via facade (gets PRF capability)
2. New device authenticates via facade, establishing an IdP session (gets idp_value access)
3. New device initiates device linking protocol with primary device (ephemeral ECDH + QR)
4. Primary device provisions nsec to new device via encrypted channel
5. New device encrypts nsec under its own multi-factor KEK (PIN + PRF + idp_value)

WebAuthn and IdP enrollment must complete BEFORE nsec provisioning, so the nsec is never stored unprotected.

### Flow 1b: Invite Acceptance

```
Volunteer clicks invite link with code
  -> App validates invite code via POST /auth/invite/accept
      Invalid/expired -> error page
      Valid -> proceed to registration
  -> WebAuthn registration (same as Flow 1)
  -> Facade creates IdP user, associates with invite
  -> Invite marked as consumed (one-time use)
  -> Continue with PIN setup, KEK derivation, nsec generation
```

### Flow 2: Daily Unlock (Happy Path)

```
Push notification -> volunteer taps
  -> App loads, PIN prompt displayed
  -> Volunteer enters PIN
  -> App: silent token refresh via facade
      Success -> fetch idp_value from /auth/userinfo
      Failure -> go to Flow 3
  -> App: if prfUsed, request WebAuthn PRF (biometric tap)
  -> Derive KEK -> decrypt nsec -> open call screen
```

UX: volunteer enters PIN + biometric tap. Two quick gestures.

### Flow 3: Session Expiry Re-Auth

```
PIN entered -> token refresh fails (session expired)
  -> "Session expired, please sign in"
  -> WebAuthn passkey prompt via facade
      Mobile: biometric
      Desktop: platform auth or cross-device QR -> phone
  -> Facade issues new tokens -> fetch idp_value
  -> PRF if available -> derive KEK -> decrypt nsec
  -> Call screen (or dashboard)
```

No grace windows, no cached secrets. If session is expired, full re-auth required. Parallel ringing covers the operational delay.

### Flow 4: Account Recovery (Lockout)

If a volunteer loses all factors (forgotten PIN, lost authenticator, expired IdP session), the nsec blob is **permanently undecryptable** on that device. This is by design — it's the security property that protects against device seizure.

**Recovery path:**

1. Volunteer contacts an admin
2. Admin verifies identity out-of-band (video call, in-person, organizational verification)
3. Admin triggers re-enrollment: revokes all sessions, deregisters all credentials
4. Volunteer re-enrolls as if setting up a new device
5. If the volunteer has another trusted device, they use the existing device linking protocol to provision their nsec to the new device
6. If no other trusted device exists, admin generates a new nsec for the volunteer. **Impact:** all previously encrypted notes remain readable by admins but become unreadable by the volunteer. New notes use the new key.

**Operational guidance:** volunteers should be encouraged to register passkeys on at least two devices (phone + laptop, or phone + hardware key) to reduce single-point-of-failure risk. The admin UI should surface warnings when a volunteer has only one registered credential.

### Session Lifecycle

| Token | TTL | Renewal | Storage |
|-------|-----|---------|---------|
| Access JWT | 15 min | Via refresh through facade | Memory only |
| Refresh token | 7-30 days (IdP configured) | Rotated on use | httpOnly cookie |
| Nsec (decrypted) | Until auto-lock (5 min idle / 30s tab hide) | Re-derive KEK on unlock | Web Worker memory only |

## Web Worker Key Isolation

### Architecture

The decrypted nsec **never exists in the main thread**.

```
+----------------------------------+     +----------------------------+
|          MAIN THREAD             |     |      CRYPTO WORKER         |
|                                  |     |                            |
|  Cannot access nsec directly.    |     |  nsec in closure scope     |
|  Sends operation requests:       |---->|                            |
|                                  |     |  Exposed operations:       |
|  worker.sign(message)            |     |    sign(message) -> sig    |
|  worker.decrypt(ciphertext)      |     |    decrypt(ct) -> pt       |
|  worker.encrypt(plaintext, pk)   |     |    encrypt(pt, pk) -> ct   |
|  worker.lock()                   |     |    lock() -> zeros key     |
|                                  |<----|                            |
|  Receives results only.          |     |  Refuses raw key export    |
|  Never receives nsec bytes.      |     |  Operation throttling      |
+----------------------------------+     +----------------------------+
```

### XSS Mitigation Properties

- **Key extraction via JS API impossible** — XSS in the main thread cannot read the worker's closure scope. Hardware side-channels are mitigated by COOP/COEP but not fully eliminated (see below).
- **Operation abuse limited** — the worker enforces rate limiting on crypto operations:
  - **Sign operations**: max 10 per second, max 100 per minute. Exceeding triggers auto-lock.
  - **Decrypt operations**: max 5 per second, max 50 per minute. Exceeding triggers auto-lock.
  - **Encrypt operations**: max 10 per second, max 100 per minute. Exceeding triggers auto-lock.
  - Thresholds are configurable at build time and should be tuned during implementation based on actual usage patterns.
- **Worker CSP** — `worker-src 'self'` prevents loading workers from attacker-controlled URLs. Workers refuse dynamic code execution, dynamic imports, and `postMessage` to non-origin targets.
- **Service Worker restrictions** — CSP includes `service-worker-src 'self'` to prevent XSS from registering a malicious service worker that could intercept `/auth/userinfo` responses or PIN input.
- **Strict page CSP** — `script-src 'self'`, no inline scripts, no dynamic code execution. Subresource integrity on vendor bundles.
- **`crossOriginIsolated` headers** — `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` mitigate Spectre-style side-channel reads from worker memory. Note: these headers also enable `SharedArrayBuffer`, which is needed for some Spectre mitigations but can also be used for timing attacks. The trade-off is accepted because the mitigation value outweighs the risk.
- **Trusted Types** — enforced via CSP to prevent DOM injection at the browser level
- **Operation logging** — every crypto operation is tagged with timestamp and calling context, fed to the audit trail for anomaly detection

**Net effect:** XSS can abuse signing/decryption during the session but cannot extract the nsec. The blast radius shrinks from "permanent key compromise" to "session-duration abuse" — and auto-lock + operation throttling limit even that window.

## Threat Model

### Threat A: Physical Device Seizure

| Attack | Before | After |
|--------|--------|-------|
| Brute-force PIN on seized device | ~20-26 bits, crackable in minutes | PIN alone is useless — need IdP value (revoked on report) + PRF (hardware-bound) |
| Extract refresh token | N/A | Admin revokes IdP session -> token invalid -> idp_value unretrievable -> blob permanently dead |
| Extract nsec from memory | Possible if app unlocked | Unchanged — mitigated by auto-lock timers |

### Threat B: Remote Browser Compromise (XSS)

| Attack | Before | After |
|--------|--------|-------|
| Read nsec from memory | XSS reads closure-scoped key in main thread | nsec in Web Worker — main thread XSS cannot extract it via JS API. Hardware side-channels mitigated by COOP/COEP. |
| Read nsec from localStorage | Encrypted but PIN-brutable | Multi-factor KEK — blob useless without IdP value + PRF |
| Steal session token | 8-hour window | 15-min JWT. Refresh token in httpOnly cookie, inaccessible to JS |
| Register rogue credential | Possible | Requires valid session + rogue credential can't produce correct PRF for KEK |
| Abuse crypto operations | N/A (had the key) | Worker rate-limits operations, auto-locks on burst patterns |

### Threat C: Session Hijacking

| Attack | Before | After |
|--------|--------|-------|
| Stolen session replay | 8-hour sliding window | 15-min JWT, no sliding renewal. Revocation kills next refresh. |
| Cross-device session theft | Full access | API calls work but nsec decryption requires PRF from registered authenticator |

### Threat D: Organizational Security

| Concern | Before | After |
|---------|--------|-------|
| MFA enforcement | Optional | Mandatory WebAuthn at registration |
| Device visibility | No admin UI | Facade exposes `/auth/devices` for admin management |
| Remote revocation on departure | Manual | IdP adapter revokes all sessions, nsec blobs die on all devices |
| Auth audit trail | Inconsistent | Every auth event through facade -> hash-chained audit log |

### Threat E: IdP Compromise

| Attack | Before | After |
|--------|--------|-------|
| IdP database breach | N/A | `idp_value` is envelope-encrypted with our server's key — IdP dump is useless |
| IdP + our server both breached | N/A | Attacker gets `idp_value` but still needs PIN (memory) + PRF (hardware) |
| Rotation on detection | N/A | Bulk `idp_value` rotation on next login for all users, old values worthless |

### Threat F: Caller Phone Exposure

| Attack | Before | After |
|--------|--------|-------|
| Volunteer sees real phone | Yes, during active call | Proxy number masking — volunteer sees proxy, never real number |
| Post-call phone access | Potentially accessible | Time-limited — proxy mapping only available during active call |
| Coerced volunteer exfiltrates | Real number available | Proxy + audit trail identifies who had access. Admin-configurable "no number" mode. |

### Threat G: Plaintext Outbound Messaging

| Attack | Before | After |
|--------|--------|-------|
| Server sees SMS/WhatsApp content | Plaintext during send | Minimal dwell time — decrypt, send to provider, discard immediately. No logging. |
| Provider sees content | Inherent to protocol | Signal recommended for high-sensitivity. Admin controls which channels are enabled. |
| In-transit interception | TLS | TLS 1.3 only for provider connections |

### Security Invariants

1. The server **never** holds a plaintext nsec or the full KEK
2. The decrypted nsec **never** exists in the main thread — Web Worker isolation only
3. Nsec decryption **always** requires at least PIN + IdP value (2 factors minimum)
4. Revoking an IdP session **permanently** prevents nsec decryption on that device
5. WebAuthn credentials are **bound to our domain**, not the IdP's
6. Schnorr signatures are **never** accepted as server authentication
7. Every authentication event is recorded in the **hash-chained audit log**
8. `idp_value` is **envelope-encrypted** in the IdP's storage
9. Caller phone numbers are **never** shown to volunteers — proxy masking only

## Code Architecture

### New Files

```
src/server/
  idp/
    adapter.ts              # IdPAdapter interface + types
    authentik-adapter.ts    # Authentik implementation
    index.ts                # Factory: reads config, returns adapter
  routes/
    auth.ts                 # Auth facade endpoints

src/client/
  lib/
    crypto-worker.ts        # Web Worker: holds nsec, exposes sign/decrypt/encrypt
    key-store.ts            # Rewritten: v2 format, multi-factor KEK derivation
    auth.ts                 # New: talks to auth facade endpoints
    webauthn.ts             # Refactored: keeps PRF logic, hits facade for ceremonies
```

### Modified Files

| File | Change |
|------|--------|
| `src/server/lib/auth.ts` | Remove Schnorr verification, add JWT validation |
| `src/server/middleware/auth.ts` | Simplify to JWT-only auth path |
| `src/client/lib/key-manager.ts` | Delegates to crypto-worker, unlock fetches idp_value via facade. **Must remove:** `getSecretKey()`, `getNsec()`, `createAuthToken()` — these return or use raw nsec bytes and would break Web Worker isolation. Replace with worker-delegated equivalents. |
| `src/server/services/identity.ts` | Remove session management methods, keep volunteer CRUD + permissions |
| `src/server/app.ts` | Wire auth facade routes, inject IdP adapter |
| `docker-compose.yml` | Add authentik-server + authentik-worker containers |
| `deploy/ansible/` | Authentik provisioning playbook |

### Deleted Code

| File / Code | Reason |
|-------------|--------|
| `src/server/routes/webauthn.ts` | Replaced by `src/server/routes/auth.ts` |
| Schnorr auth in `src/server/lib/auth.ts` | No longer a server auth method. Also remove/deprecate `AUTH_PREFIX` from `crypto-labels.ts`. |
| `serverSessions` table + methods | Replaced by JWTs |
| Custom login rate limiting | Facade handles uniformly |

### Database Changes

**Keep:** `webauthnCredentials`, `webauthnChallenges`, `volunteers`, all E2EE tables.
**Remove:** `serverSessions`.
**Add:** `jwtRevocations` (optional, only if JWT TTL > acceptable revocation delay).

### Configuration

```env
# IdP adapter
IDP_ADAPTER=authentik
AUTHENTIK_URL=http://authentik-server:9000
AUTHENTIK_API_TOKEN=<service account token>

# Envelope encryption for idp_value at rest in the IdP.
# Rotation: generate new key, re-encrypt all idp_values with new key (batch operation),
# then discard old key. Versioned: store key version with each encrypted value.
IDP_VALUE_ENCRYPTION_KEY=<random 64 hex chars>
IDP_VALUE_KEY_VERSION=1

# JWT (symmetric HMAC-SHA256 for single-instance; migrate to EdDSA for multi-instance)
JWT_SECRET=<random 64 hex chars>

# WebAuthn (facade owns the RP)
AUTH_WEBAUTHN_RP_ID=app.llamenos.org
AUTH_WEBAUTHN_RP_NAME=Llamenos
AUTH_WEBAUTHN_ORIGIN=https://app.llamenos.org
```

## Bun Native Crypto Note

Bun provides native `Bun.password` (Argon2id, bcrypt) and `Bun.CryptoHasher` (SHA-256, HMAC) APIs. Assessment for this spec:

- **`Bun.password` Argon2id** — memory-hard, stronger than PBKDF2 against GPU brute-force. However, PIN derivation happens **client-side** in the browser where Bun APIs are unavailable. Could be used for any future server-side credential hashing.
- **`Bun.CryptoHasher` HMAC** — could replace `@noble/hashes/hmac` for server-side HMAC operations (audit log, phone hashing). Marginal benefit since `@noble/*` is already a dependency.
- **Not available in Bun**: HKDF, ChaCha20-Poly1305, secp256k1/ECDH. The `@noble/*` libraries (`ciphers`, `hashes`, `curves`) remain necessary for the core crypto stack.

**Recommendation:** use `Bun.CryptoHasher` for new server-side HMAC/SHA-256 operations where no `@noble/*` import is already present. Keep `@noble/*` as the primary crypto library for consistency across client and server.

## Adapter Shipping Schedule

**This spec:**
- `AuthentikAdapter` — full implementation
- `IdPAdapter` interface — documented contract

**Follow-up specs:**
- `KeycloakAdapter`, `GenericOIDCAdapter`
- Multi-tenant hosted Authentik instance
- Extended account recovery (social recovery, backup codes)
- IdP audit event federation

## WebAuthn Desktop Support

WebAuthn is mandatory. Desktop users without hardware keys or platform biometrics use the **cross-device / hybrid authenticator** flow:

1. Browser displays QR code
2. Volunteer scans with their phone
3. Phone prompts for biometric (Face ID, fingerprint)
4. Bluetooth proximity confirms the phone is nearby
5. Authentication completes

This works for both registration and daily PRF requests. No hardware key purchase required.

### Coverage Matrix

| Platform | Primary Method | Fallback |
|----------|---------------|----------|
| Mobile (iOS/Android) | Platform biometrics (Face ID, fingerprint) | — |
| Desktop + Touch ID / Windows Hello | Platform authenticator | Cross-device QR |
| Desktop without biometrics | Cross-device QR -> phone passkey | — |
| Desktop without smartphone | TOTP (admin-configurable, edge case) | — |

TOTP is available as an admin-configurable fallback for the rare case of a desktop user without a smartphone. It is weaker (phishable) and documented as such. When TOTP is the only second factor, PRF is unavailable, so the nsec encryption falls back to 2-factor (PIN + IdP value). **Security trade-off:** TOTP provides weaker authentication assurance than WebAuthn (phishable, no hardware binding, no PRF). For a crisis hotline where volunteer safety is paramount, requiring a smartphone is strongly recommended. TOTP should only be enabled by admins who understand the reduced security posture and have no alternative.
