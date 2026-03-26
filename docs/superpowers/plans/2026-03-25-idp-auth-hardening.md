# IdP-Agnostic Auth Facade & Multi-Factor Nsec Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PIN-only nsec encryption with multi-factor KEK (PIN + WebAuthn PRF + IdP value), isolate the nsec in a Web Worker, and route all authentication through an IdP-agnostic facade with Authentik as the default backend.

**Architecture:** Auth facade on our Hono server proxies WebAuthn and delegates user/secret management to a pluggable IdP adapter. The client never talks to the IdP directly. JWTs replace custom session tokens. A crypto Web Worker holds the nsec in isolation — the main thread never touches it.

**Tech Stack:** Bun, Hono, `@simplewebauthn/server` + `@simplewebauthn/browser`, `jose` (JWT), `@noble/ciphers` + `@noble/hashes`, Authentik REST API, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-03-25-idp-auth-hardening-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/server/idp/adapter.ts` | IdPAdapter interface + shared types (IdPUser, TokenSet, InviteOpts) |
| `src/server/idp/authentik-adapter.ts` | Authentik REST API implementation of IdPAdapter |
| `src/server/idp/index.ts` | Factory: reads `IDP_ADAPTER` env, returns adapter instance |
| `src/server/idp/authentik-adapter.test.ts` | Unit tests for Authentik adapter |
| `src/server/lib/jwt.ts` | JWT sign/verify/decode utilities using `jose` |
| `src/server/lib/jwt.test.ts` | Unit tests for JWT utilities |
| `src/server/routes/auth-facade.ts` | Auth facade routes (/auth/*) — WebAuthn + token + device management |
| `src/server/routes/auth-facade.test.ts` | Unit tests for facade route handlers |
| `src/client/lib/crypto-worker.ts` | Web Worker entry point — holds nsec, exposes sign/decrypt/encrypt/lock |
| `src/client/lib/crypto-worker-client.ts` | Main-thread wrapper for postMessage API to worker |
| `src/client/lib/key-store-v2.ts` | Multi-factor KEK derivation + v2 blob storage |
| `src/client/lib/key-store-v2.test.ts` | Unit tests for v2 key store |
| `src/client/lib/auth-facade-client.ts` | Client-side HTTP client for /auth/* facade endpoints |

### Modified Files

| File | Change |
|------|--------|
| `src/shared/crypto-labels.ts` | Add 4 new constants: LABEL_KEK_PRF, LABEL_NSEC_KEK_3F, LABEL_NSEC_KEK_2F, LABEL_IDP_VALUE_WRAP |
| `src/server/lib/auth.ts` | Remove Schnorr verification, replace with JWT validation |
| `src/server/middleware/auth.ts` | Simplify to JWT-only path |
| `src/server/services/identity.ts` | Remove session methods (createSession, validateSession, revokeSession, revokeAllSessions). Keep WebAuthn + volunteer CRUD. |
| `src/server/db/schema/identity.ts` | Remove `serverSessions` table. Add `jwtRevocations` table. |
| `src/server/app.ts` | Wire auth facade routes, inject IdP adapter |
| `src/server/routes/auth.ts` | Remove Schnorr login, update bootstrap to use facade |
| `src/client/lib/key-manager.ts` | Remove getSecretKey/getNsec/createAuthToken, delegate to crypto-worker-client |
| `src/client/lib/webauthn.ts` | Add PRF support, point at facade endpoints instead of /api/webauthn/* |
| `src/client/lib/auth.tsx` | Refactor auth provider to use facade client + JWT tokens |
| `src/client/lib/api.ts` | Replace Schnorr fallback with JWT-only auth headers |
| `src/client/lib/hub-key-cache.ts` | Use crypto-worker-client instead of getSecretKey() |
| `deploy/docker/docker-compose.yml` | Add authentik-server + authentik-worker services |
| `deploy/ansible/templates/docker-compose.j2` | Add Authentik services to Ansible template |

### Deleted Files/Code

| Target | Reason |
|--------|--------|
| `src/client/lib/key-store.ts` | Replaced by key-store-v2.ts |
| `serverSessions` table | Replaced by JWTs |
| Schnorr auth in `src/server/lib/auth.ts` | No longer a server auth method |
| `AUTH_PREFIX` in `crypto-labels.ts` | Deprecated with Schnorr auth removal |

---

## Task Dependency Graph

```
Task 1 (crypto-labels) ─────────────────────────────────────────────┐
Task 2 (IdP adapter interface) ──────┬──────────────────────────────┤
Task 3 (Authentik adapter) ──────────┘                              │
Task 4 (JWT utilities) ─────────────────────────────────────────────┤
Task 5 (DB schema changes) ─────────────────────────────────────────┤
Task 6 (Auth facade routes) ← depends on 2, 4, 5 ──────────────────┤
Task 7 (Server auth middleware) ← depends on 4, 6 ─────────────────┤
Task 8 (Crypto Web Worker) ← depends on 1 ─────────────────────────┤
Task 9 (Key-store v2) ← depends on 1, 8 ───────────────────────────┤
Task 10 (Key-manager refactor) ← depends on 8, 9, 11 ──────────────┤
Task 11 (Auth facade client) ← depends on 6 ───────────────────────┤
Task 12 (WebAuthn PRF + facade) ← depends on 11 ───────────────────┤
Task 13 (Auth provider refactor) ← depends on 10, 11, 12 ──────────┤
Task 14 (API client refactor) ← depends on 13 ─────────────────────┤
Task 15a (Crypto lib refactor) ← depends on 8, 10 ─────────────────┤
Task 15b (Nostr relay refactor) ← depends on 8, 10 ────────────────┤
Task 15c (UI component updates) ← depends on 10, 14 ───────────────┤
Task 16 (Docker/Ansible Authentik) ← depends on 3 ─────────────────┤
Task 17 (Integration tests) ← depends on all above ────────────────┤
Task 18 (CSP headers) ← depends on 8 ──────────────────────────────┤
Task 19 (Account recovery) ← depends on 6 ─────────────────────────┘
```

**Parallelism:** Tasks 1-5 can run in parallel. Tasks 8-9 can run in parallel with 6-7. Task 16 is independent of client work. Tasks 15a, 15b can run in parallel. Tasks 18, 19 can run in parallel with 15c.

---

## Task 1: Add New Crypto-Labels Constants

**Files:**
- Modify: `src/shared/crypto-labels.ts`

- [ ] **Step 1: Add the four new constants**

```typescript
// After existing constants, add:

/** WebAuthn PRF evaluation salt for KEK derivation */
export const LABEL_KEK_PRF = 'llamenos:kek-prf'

/** HKDF info for 3-factor (PIN + PRF + IdP) KEK derivation */
export const LABEL_NSEC_KEK_3F = 'llamenos:nsec-kek:3f'

/** HKDF info for 2-factor (PIN + IdP) KEK derivation */
export const LABEL_NSEC_KEK_2F = 'llamenos:nsec-kek:2f'

/** Envelope encryption of idp_value at rest in the IdP */
export const LABEL_IDP_VALUE_WRAP = 'llamenos:idp-value-wrap'
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/crypto-labels.ts
git commit -m "feat: add KEK and IdP value crypto-labels constants"
```

---

## Task 2: IdP Adapter Interface + Types

**Files:**
- Create: `src/server/idp/adapter.ts`

- [ ] **Step 1: Write the interface and types**

```typescript
// src/server/idp/adapter.ts

export interface IdPUser {
  /** Nostr public key (hex) — the user's identity */
  pubkey: string
  /** Whether the user exists and is active in the IdP */
  active: boolean
  /** IdP-internal user ID (opaque, adapter-specific) */
  externalId: string
}

export interface NsecSecretRotation {
  current: Uint8Array
  previous?: Uint8Array
}

export interface InviteOpts {
  /** Nostr pubkey of the admin creating the invite */
  createdBy: string
  /** Optional: pre-assigned roles for the invitee */
  roles?: string[]
  /** Expiry duration in milliseconds (default: 7 days) */
  expiresInMs?: number
}

export interface IdPAdapter {
  /** Initialize the adapter (called once at server startup) */
  initialize(): Promise<void>

  // --- User lifecycle ---
  createUser(pubkey: string): Promise<IdPUser>
  getUser(pubkey: string): Promise<IdPUser | null>
  deleteUser(pubkey: string): Promise<void>

  // --- Nsec encryption secret (the idp_value) ---
  /**
   * Retrieve the per-user secret used as one factor in KEK derivation.
   * Requires a valid IdP session for the user (verified via adapter's
   * service account credentials, not the user's OIDC tokens).
   */
  getNsecSecret(pubkey: string): Promise<Uint8Array>

  /**
   * Generate a new nsec secret, retaining the old one for migration.
   * Returns both current (new) and previous (old) values.
   * Call confirmRotation() after the client re-encrypts.
   */
  rotateNsecSecret(pubkey: string): Promise<NsecSecretRotation>

  /** Discard the previous nsec secret after client confirms re-encryption */
  confirmRotation(pubkey: string): Promise<void>

  // --- Session management ---
  /** Check if the user's IdP session is still valid */
  refreshSession(pubkey: string): Promise<{ valid: boolean }>

  /** Revoke a single user's IdP session */
  revokeSession(pubkey: string): Promise<void>

  /** Revoke all sessions for a user (e.g., on departure or compromise) */
  revokeAllSessions(pubkey: string): Promise<void>

  // --- Invite / enrollment ---
  createInviteLink(opts: InviteOpts): Promise<string>
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/idp/adapter.ts
git commit -m "feat: add IdPAdapter interface and types"
```

---

## Task 3: Authentik Adapter Implementation

**Files:**
- Create: `src/server/idp/authentik-adapter.ts`
- Create: `src/server/idp/index.ts`
- Create: `src/server/idp/authentik-adapter.test.ts`

**Docs:** Look up the Authentik REST API docs via context7 or web search before implementing. Key endpoints: `/api/v3/core/users/`, `/api/v3/core/tokens/`, user custom attributes.

- [ ] **Step 1: Write failing test for createUser**

```typescript
// src/server/idp/authentik-adapter.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { AuthentikAdapter } from './authentik-adapter'

// Mock fetch for Authentik API calls
const mockFetch = mock(() => Promise.resolve(new Response()))

describe('AuthentikAdapter', () => {
  let adapter: AuthentikAdapter

  beforeEach(() => {
    adapter = new AuthentikAdapter({
      url: 'http://authentik:9000',
      apiToken: 'test-token',
      idpValueEncryptionKey: '0'.repeat(64),
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  test('createUser sends correct API call', async () => {
    const pubkey = 'a'.repeat(64)
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      pk: 1,
      username: pubkey,
      is_active: true,
      attributes: {},
    }), { status: 201 }))

    const user = await adapter.createUser(pubkey)
    expect(user.pubkey).toBe(pubkey)
    expect(user.active).toBe(true)

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v3/core/users/')
    expect(opts.method).toBe('POST')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/idp/authentik-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AuthentikAdapter**

Implement in `src/server/idp/authentik-adapter.ts`:
- `createUser`: POST `/api/v3/core/users/` with `{ username: pubkey, name: pubkey, is_active: true, attributes: { nsec_secret: <envelope-encrypted random 32 bytes> } }`
- `getUser`: GET `/api/v3/core/users/?search=<pubkey>`
- `deleteUser`: DELETE `/api/v3/core/users/<pk>/`
- `getNsecSecret`: GET user, decrypt `attributes.nsec_secret` with `IDP_VALUE_ENCRYPTION_KEY`
- `rotateNsecSecret`: GET user, generate new secret, PATCH attributes with both old and new
- `confirmRotation`: PATCH attributes to remove `previous_nsec_secret`
- `refreshSession`: GET `/api/v3/core/users/<pk>/` and check `is_active`
- `revokeSession` / `revokeAllSessions`: DELETE user sessions via Authentik API
- `createInviteLink`: POST `/api/v3/stages/invitation/invitations/`

Use `LABEL_IDP_VALUE_WRAP` from crypto-labels for envelope encryption of the nsec secret at rest.

- [ ] **Step 4: Write the adapter factory**

```typescript
// src/server/idp/index.ts
import type { IdPAdapter } from './adapter'

export async function createIdPAdapter(): Promise<IdPAdapter> {
  const adapterType = process.env.IDP_ADAPTER || 'authentik'

  switch (adapterType) {
    case 'authentik': {
      const { AuthentikAdapter } = await import('./authentik-adapter')
      const adapter = new AuthentikAdapter({
        url: process.env.AUTHENTIK_URL || 'http://authentik-server:9000',
        apiToken: process.env.AUTHENTIK_API_TOKEN || '',
        idpValueEncryptionKey: process.env.IDP_VALUE_ENCRYPTION_KEY || '',
      })
      await adapter.initialize()
      return adapter
    }
    default:
      throw new Error(`Unknown IdP adapter: ${adapterType}`)
  }
}

export type { IdPAdapter, IdPUser, NsecSecretRotation, InviteOpts } from './adapter'
```

- [ ] **Step 5: Run tests**

Run: `bun test src/server/idp/authentik-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/idp/
git commit -m "feat: add Authentik IdP adapter implementation"
```

---

## Task 4: JWT Utilities

**Files:**
- Create: `src/server/lib/jwt.ts`
- Create: `src/server/lib/jwt.test.ts`

**Dependencies:** Install `jose` — `bun add jose`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/lib/jwt.test.ts
import { describe, test, expect } from 'bun:test'
import { signAccessToken, verifyAccessToken } from './jwt'

describe('JWT utilities', () => {
  const secret = '0'.repeat(64)
  const pubkey = 'a'.repeat(64)

  test('signAccessToken returns a JWT string', async () => {
    const token = await signAccessToken({ pubkey, permissions: ['calls:answer'] }, secret)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
  })

  test('verifyAccessToken decodes a valid token', async () => {
    const token = await signAccessToken({ pubkey, permissions: ['calls:answer'] }, secret)
    const payload = await verifyAccessToken(token, secret)
    expect(payload.sub).toBe(pubkey)
    expect(payload.permissions).toContain('calls:answer')
  })

  test('verifyAccessToken rejects expired token', async () => {
    const token = await signAccessToken(
      { pubkey, permissions: [] },
      secret,
      { expiresIn: '1s' }
    )
    // Wait for token to expire
    await new Promise(r => setTimeout(r, 1500))
    await expect(verifyAccessToken(token, secret)).rejects.toThrow()
  })

  test('verifyAccessToken rejects tampered token', async () => {
    const token = await signAccessToken({ pubkey, permissions: [] }, secret)
    const tampered = token.slice(0, -5) + 'XXXXX'
    await expect(verifyAccessToken(tampered, secret)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/lib/jwt.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement JWT utilities**

```typescript
// src/server/lib/jwt.ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

export interface AccessTokenPayload extends JWTPayload {
  sub: string // pubkey
  permissions: string[]
}

export interface SignOptions {
  expiresIn?: string
}

const DEFAULT_EXPIRES_IN = '15m'

export async function signAccessToken(
  data: { pubkey: string; permissions: string[] },
  secret: string,
  opts?: SignOptions
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ permissions: data.permissions })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(data.pubkey)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(opts?.expiresIn ?? DEFAULT_EXPIRES_IN)
    .setIssuer('llamenos')
    .sign(key)
}

export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<AccessTokenPayload> {
  const key = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, key, {
    issuer: 'llamenos',
    algorithms: ['HS256'],
  })
  return payload as AccessTokenPayload
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/lib/jwt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/jwt.ts src/server/lib/jwt.test.ts
git commit -m "feat: add JWT sign/verify utilities with jose"
```

---

## Task 5: Database Schema Changes

**Files:**
- Modify: `src/server/db/schema/identity.ts`

- [ ] **Step 1: Remove `serverSessions` table definition**

In `src/server/db/schema/identity.ts`, delete the `serverSessions` table definition (lines ~23-28). Keep all other tables.

- [ ] **Step 2: Add `jwtRevocations` table**

```typescript
export const jwtRevocations = pgTable('jwt_revocations', {
  /** JWT ID (jti claim) */
  jti: text('jti').primaryKey(),
  /** Pubkey of the revoked user */
  pubkey: text('pubkey').notNull(),
  /** When the JWT expires (rows can be cleaned up after this) */
  expiresAt: timestamp('expires_at').notNull(),
  /** When this revocation was created */
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

- [ ] **Step 3: Generate migration**

Run: `bun run migrate:generate`
Expected: Migration file created in `src/server/db/migrations/`

- [ ] **Step 4: Fix any references to `serverSessions`**

Grep for `serverSessions` across the codebase. Update imports in:
- `src/server/services/identity.ts` — remove session CRUD methods
- `src/server/services/gdpr.ts` — update GDPR data export to query `jwtRevocations` instead of `serverSessions`, update GDPR deletion to clear `jwtRevocations` for the user
- `src/server/db/schema/index.ts` — remove export if present
- Any test reset functions (e.g., `resetForTest()` in identity service)

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: Will likely fail due to references to removed session methods. Note the failures — they will be fixed in Tasks 6 and 7.

- [ ] **Step 6: Commit (schema change only)**

```bash
git add src/server/db/
git commit -m "feat: replace serverSessions with jwtRevocations table"
```

---

## Task 6: Auth Facade Server Routes

**Files:**
- Create: `src/server/routes/auth-facade.ts`
- Create: `src/server/routes/auth-facade.test.ts`

**Depends on:** Task 2 (adapter interface), Task 4 (JWT), Task 5 (schema)

This is the largest server-side task. The facade routes handle:
- WebAuthn registration + login (proxied through our server, RP = our domain)
- Token refresh (JWT + IdP session check + idp_value retrieval)
- Session revocation
- Userinfo (returns idp_value for KEK derivation)
- Device management (list/delete credentials)
- Invite acceptance
- Rotation confirmation

- [ ] **Step 1: Write failing test for POST /auth/webauthn/login-options**

```typescript
// src/server/routes/auth-facade.test.ts
import { describe, test, expect } from 'bun:test'
import { Hono } from 'hono'
import { authFacadeRoutes } from './auth-facade'

describe('Auth Facade', () => {
  test('POST /auth/webauthn/login-options returns challenge', async () => {
    // Setup with mock IdP adapter and test DB
    const app = new Hono()
    // ... wire routes with test dependencies
    const res = await app.request('/auth/webauthn/login-options', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.challenge).toBeDefined()
  })
})
```

- [ ] **Step 2: Implement auth facade routes**

Create `src/server/routes/auth-facade.ts` with a Hono router:

**Public routes (no auth required):**
- `POST /auth/webauthn/login-options` — generate WebAuthn authentication challenge. Uses existing `generateAuthOptions` from `src/server/lib/webauthn.ts`.
- `POST /auth/webauthn/login-verify` — verify WebAuthn assertion, issue JWT access token + set refresh token httpOnly cookie. Uses existing `verifyAuthResponse`. On success:
  1. Verify counter (replay detection)
  2. Call `idpAdapter.refreshSession(pubkey)` to confirm user is active
  3. Sign JWT via `signAccessToken()`
  4. Set refresh cookie: `SameSite=Strict; Secure; HttpOnly; Path=/auth/token`
  5. Return `{ accessToken, pubkey }`
- `POST /auth/invite/accept` — validate invite code, return invite metadata. No auth needed (invite code is the credential).

**Authenticated routes (JWT required):**
- `POST /auth/webauthn/register-options` — generate WebAuthn registration challenge
- `POST /auth/webauthn/register-verify` — verify registration, store credential
- `POST /auth/token/refresh` — validate refresh cookie, call `idpAdapter.refreshSession()`, fetch `idpAdapter.getNsecSecret()`, issue new JWT. CSRF: requires JSON body.
- `GET /auth/userinfo` — return pubkey + idp_value (nsec secret for KEK derivation). If rotation pending, include `pendingRotation` field.
- `POST /auth/rotation/confirm` — call `idpAdapter.confirmRotation(pubkey)`
- `POST /auth/session/revoke` — revoke own session (delete refresh cookie, call `idpAdapter.revokeSession()`)
- `GET /auth/devices` — list WebAuthn credentials for authenticated user
- `DELETE /auth/devices/:id` — delete a WebAuthn credential

**Rate limiting:** Apply per-IP rate limits to login-options and login-verify (10 per 5 min).

- [ ] **Step 3: Write additional tests for token refresh, userinfo, revocation**

Test each authenticated route with mock JWT and mock IdP adapter.

- [ ] **Step 4: Run all tests**

Run: `bun test src/server/routes/auth-facade.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/auth-facade.ts src/server/routes/auth-facade.test.ts
git commit -m "feat: add auth facade routes with WebAuthn proxy and JWT issuance"
```

---

## Task 7: Server Auth Middleware Refactor

**Files:**
- Modify: `src/server/lib/auth.ts`
- Modify: `src/server/middleware/auth.ts`
- Modify: `src/server/routes/auth.ts`
- Modify: `src/server/services/identity.ts`
- Modify: `src/server/app.ts`

**Depends on:** Task 4 (JWT), Task 6 (facade routes)

- [ ] **Step 1: Rewrite `src/server/lib/auth.ts` to JWT-only**

Remove:
- `parseAuthHeader()` (Schnorr payload parsing)
- `validateToken()` (Schnorr timestamp check)
- `verifyAuthToken()` (Schnorr signature verification)

Replace `authenticateRequest()` with:

```typescript
import { verifyAccessToken, type AccessTokenPayload } from './jwt'

export async function authenticateRequest(
  request: Request,
  identity: IdentityService
): Promise<{ pubkey: string; volunteer: Volunteer } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) throw new Error('JWT_SECRET not configured')

  try {
    const payload = await verifyAccessToken(token, jwtSecret)
    const volunteer = await identity.getVolunteer(payload.sub)
    if (!volunteer) return null
    return { pubkey: payload.sub, volunteer }
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Update middleware to use JWT permissions from token**

In `src/server/middleware/auth.ts`, extract permissions from the JWT payload instead of re-resolving from roles (the facade already resolved permissions when issuing the JWT).

- [ ] **Step 3: Remove session methods from identity service**

In `src/server/services/identity.ts`, remove:
- `createSession()`
- `validateSession()`
- `revokeSession()`
- `revokeAllSessions()`

Keep all WebAuthn methods and volunteer CRUD intact.

- [ ] **Step 4: Update `src/server/routes/auth.ts`**

Remove `POST /login` (Schnorr login). Update `POST /bootstrap` to work with the new auth facade. Keep `GET /me`.

- [ ] **Step 5: Wire facade routes and delete old WebAuthn routes**

In `src/server/app.ts`:
```typescript
import { authFacadeRoutes } from './routes/auth-facade'
// Add after existing route setup:
app.route('/auth', authFacadeRoutes)
```

Inject the IdP adapter into the facade routes via Hono context or dependency injection.

**Delete `src/server/routes/webauthn.ts`** — this file is fully replaced by `auth-facade.ts`. Remove its import from `app.ts`. If both exist, there will be duplicate endpoint conflicts.

Also deprecate `AUTH_PREFIX` in `src/shared/crypto-labels.ts` by adding a `@deprecated` JSDoc comment.

- [ ] **Step 6: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS (server-side). Client will have errors from removed Schnorr auth — those are fixed in Tasks 13-14.

- [ ] **Step 7: Commit**

```bash
git add src/server/
git commit -m "feat: replace Schnorr auth with JWT validation, wire auth facade"
```

---

## Task 8: Crypto Web Worker

**Files:**
- Create: `src/client/lib/crypto-worker.ts`
- Create: `src/client/lib/crypto-worker-client.ts`

**Depends on:** Task 1 (crypto-labels)

The worker holds the nsec in a closure and exposes only operation-based APIs. The main thread NEVER receives the raw key bytes.

- [ ] **Step 1: Define the worker message protocol**

```typescript
// Message types shared between worker and client
// Put these in crypto-worker-client.ts (main-thread side)

type WorkerRequest =
  | { type: 'unlock'; id: string; kekHex: string; encryptedBlob: string }
  | { type: 'lock'; id: string }
  | { type: 'sign'; id: string; messageHex: string }
  | { type: 'decrypt'; id: string; ciphertextHex: string; labelHex: string; senderPubkeyHex: string }
  | { type: 'encrypt'; id: string; plaintextHex: string; recipientPubkeyHex: string; label: string }
  | { type: 'getPublicKey'; id: string }
  | { type: 'isUnlocked'; id: string }

type WorkerResponse =
  | { type: 'success'; id: string; result: unknown }
  | { type: 'error'; id: string; error: string }
```

- [ ] **Step 2: Implement the worker entry point**

```typescript
// src/client/lib/crypto-worker.ts
// This file runs in a dedicated Web Worker context.
// The nsec (secret key) lives ONLY in this closure.

let secretKey: Uint8Array | null = null
let publicKeyHex: string | null = null

// Operation rate limiting
const opCounts = { sign: 0, decrypt: 0, encrypt: 0 }
const OP_LIMITS = { sign: { perSec: 10, perMin: 100 }, decrypt: { perSec: 5, perMin: 50 }, encrypt: { perSec: 10, perMin: 100 } }
// ... rate limiting logic with auto-lock on burst

self.onmessage = async (event: MessageEvent) => {
  const req = event.data as WorkerRequest
  try {
    switch (req.type) {
      case 'unlock': {
        // Decrypt nsec blob using provided KEK
        // Store in closure, derive pubkey
        // Return pubkey (NOT the nsec)
        break
      }
      case 'lock': {
        // Zero out secretKey bytes, set to null
        if (secretKey) secretKey.fill(0)
        secretKey = null
        publicKeyHex = null
        break
      }
      case 'sign': {
        // Schnorr sign with secretKey (for Nostr relay events only)
        // Rate limit check
        break
      }
      case 'decrypt': {
        // ECIES unwrap using secretKey
        break
      }
      case 'encrypt': {
        // ECIES wrap for recipient
        break
      }
      case 'getPublicKey': {
        // Return publicKeyHex (safe — public key is not secret)
        break
      }
      case 'isUnlocked': {
        // Return boolean
        break
      }
    }
    self.postMessage({ type: 'success', id: req.id, result })
  } catch (err) {
    self.postMessage({ type: 'error', id: req.id, error: String(err) })
  }
}
```

Fill in each case with the actual crypto operations using `@noble/curves/secp256k1` and `@noble/ciphers`. Import the same crypto functions currently used in `src/client/lib/crypto.ts`.

- [ ] **Step 3: Implement the main-thread client wrapper**

```typescript
// src/client/lib/crypto-worker-client.ts

export class CryptoWorkerClient {
  private worker: Worker
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private idCounter = 0

  constructor() {
    this.worker = new Worker(
      new URL('./crypto-worker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker.onmessage = (event) => {
      const { type, id, result, error } = event.data
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      if (type === 'success') p.resolve(result)
      else p.reject(new Error(error))
    }
  }

  private call(req: Omit<WorkerRequest, 'id'>): Promise<unknown> {
    const id = String(++this.idCounter)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id })
    })
  }

  async unlock(kekHex: string, encryptedBlob: string): Promise<string> {
    return this.call({ type: 'unlock', kekHex, encryptedBlob }) as Promise<string>
  }

  async lock(): Promise<void> {
    await this.call({ type: 'lock' })
  }

  async sign(messageHex: string): Promise<string> {
    return this.call({ type: 'sign', messageHex }) as Promise<string>
  }

  async decrypt(ciphertextHex: string, labelHex: string, senderPubkeyHex: string): Promise<string> {
    return this.call({ type: 'decrypt', ciphertextHex, labelHex, senderPubkeyHex }) as Promise<string>
  }

  async encrypt(plaintextHex: string, recipientPubkeyHex: string, label: string): Promise<string> {
    return this.call({ type: 'encrypt', plaintextHex, recipientPubkeyHex, label }) as Promise<string>
  }

  async getPublicKey(): Promise<string | null> {
    return this.call({ type: 'getPublicKey' }) as Promise<string | null>
  }

  async isUnlocked(): Promise<boolean> {
    return this.call({ type: 'isUnlocked' }) as Promise<boolean>
  }
}

/** Singleton instance */
export const cryptoWorker = new CryptoWorkerClient()
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts
git commit -m "feat: add crypto Web Worker with main-thread client wrapper"
```

---

## Task 9: Key-Store v2 (Multi-Factor KEK)

**Files:**
- Create: `src/client/lib/key-store-v2.ts`
- Create: `src/client/lib/key-store-v2.test.ts`

**Depends on:** Task 1 (crypto-labels), Task 8 (crypto-worker)

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/key-store-v2.test.ts
import { describe, test, expect } from 'bun:test'
import { deriveKEK, type KEKFactors } from './key-store-v2'
import { LABEL_NSEC_KEK_3F, LABEL_NSEC_KEK_2F } from '@shared/crypto-labels'

describe('key-store-v2', () => {
  const pin = '123456'
  const idpValue = new Uint8Array(32).fill(0xAA)
  const prfOutput = new Uint8Array(32).fill(0xBB)
  const salt = new Uint8Array(32).fill(0xCC)

  test('deriveKEK with 3 factors produces 32-byte key', async () => {
    const kek = await deriveKEK({ pin, idpValue, prfOutput, salt })
    expect(kek).toBeInstanceOf(Uint8Array)
    expect(kek.length).toBe(32)
  })

  test('deriveKEK with 2 factors produces different key than 3 factors', async () => {
    const kek3 = await deriveKEK({ pin, idpValue, prfOutput, salt })
    const kek2 = await deriveKEK({ pin, idpValue, salt })
    // Different info labels mean different outputs even with same IKM subset
    expect(Buffer.from(kek3).equals(Buffer.from(kek2))).toBe(false)
  })

  test('deriveKEK is deterministic', async () => {
    const a = await deriveKEK({ pin, idpValue, prfOutput, salt })
    const b = await deriveKEK({ pin, idpValue, prfOutput, salt })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  test('wrong PIN produces different KEK', async () => {
    const a = await deriveKEK({ pin: '123456', idpValue, salt })
    const b = await deriveKEK({ pin: '654321', idpValue, salt })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/client/lib/key-store-v2.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement key-store-v2**

```typescript
// src/client/lib/key-store-v2.ts
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'
import { hkdf } from '@noble/hashes/hkdf'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/webcrypto'
import {
  LABEL_NSEC_KEK_3F,
  LABEL_NSEC_KEK_2F,
  HMAC_KEYID_PREFIX,
} from '@shared/crypto-labels'

const STORAGE_KEY = 'llamenos-encrypted-key-v2'
const PBKDF2_ITERATIONS = 600_000

export interface KEKFactors {
  pin: string
  idpValue: Uint8Array
  prfOutput?: Uint8Array // undefined = 2-factor mode
  salt: Uint8Array
}

export interface EncryptedKeyDataV2 {
  version: 2
  kdf: 'pbkdf2-sha256'
  cipher: 'xchacha20-poly1305'
  salt: string       // hex, 32 bytes
  nonce: string      // hex, 24 bytes
  ciphertext: string // hex
  pubkeyHash: string // HMAC_KEYID_PREFIX hash
  prfUsed: boolean
  idpIssuer: string
}

export async function deriveKEK(factors: KEKFactors): Promise<Uint8Array> {
  // Step 1: PIN → PBKDF2-SHA256
  const pinDerived = pbkdf2(sha256, factors.pin, factors.salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  })

  // Step 2: Concatenate available factors (each exactly 32 bytes)
  const ikm = factors.prfOutput
    ? new Uint8Array([...pinDerived, ...factors.prfOutput, ...factors.idpValue])
    : new Uint8Array([...pinDerived, ...factors.idpValue])

  // Step 3: HKDF-SHA256 with factor-specific info
  const info = factors.prfOutput ? LABEL_NSEC_KEK_3F : LABEL_NSEC_KEK_2F
  return hkdf(sha256, ikm, factors.salt, info, 32)
}

export function encryptNsec(
  nsecHex: string,
  kek: Uint8Array,
  pubkey: string,
  prfUsed: boolean,
  idpIssuer: string,
  salt: Uint8Array
): EncryptedKeyDataV2 {
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(kek, nonce)
  const plaintext = new TextEncoder().encode(nsecHex)
  const ciphertext = cipher.encrypt(plaintext)

  // Hash pubkey for storage identification (not leaking pubkey)
  const pubkeyHash = Buffer.from(
    sha256(new TextEncoder().encode(HMAC_KEYID_PREFIX + pubkey))
  ).toString('hex')

  return {
    version: 2,
    kdf: 'pbkdf2-sha256',
    cipher: 'xchacha20-poly1305',
    salt: Buffer.from(salt).toString('hex'),
    nonce: Buffer.from(nonce).toString('hex'),
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    pubkeyHash,
    prfUsed,
    idpIssuer,
  }
}

export function storeEncryptedKeyV2(data: EncryptedKeyDataV2): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function loadEncryptedKeyV2(): EncryptedKeyDataV2 | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  const parsed = JSON.parse(raw)
  if (parsed.version !== 2) return null
  return parsed as EncryptedKeyDataV2
}

export function hasStoredKeyV2(): boolean {
  return loadEncryptedKeyV2() !== null
}

export function clearStoredKeyV2(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function isValidPin(pin: string): boolean {
  return /^\d{6,8}$/.test(pin)
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/lib/key-store-v2.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/key-store-v2.ts src/client/lib/key-store-v2.test.ts
git commit -m "feat: add multi-factor key-store v2 with HKDF KEK derivation"
```

---

## Task 10: Key-Manager Refactor

**Files:**
- Modify: `src/client/lib/key-manager.ts`

**Depends on:** Task 8 (crypto-worker), Task 9 (key-store-v2)

This is the highest-risk refactor — 27 files import from key-manager. The strategy is to keep the same export surface where possible, but change the internals to delegate to the crypto worker.

- [ ] **Step 1: Remove dangerous exports**

Remove these functions entirely:
- `getSecretKey(): Uint8Array` — breaks worker isolation
- `getNsec(): string | null` — breaks worker isolation
- `createAuthToken(timestamp, method, path): string` — Schnorr auth is removed

- [ ] **Step 2: Make `unlock()` async and multi-factor**

The new `unlock()` must:
1. Accept PIN
2. Fetch `idpValue` from the auth facade (`/auth/userinfo`)
3. Request WebAuthn PRF if `prfUsed` is true in the stored blob
4. Derive KEK via `deriveKEK()`
5. Send KEK + encrypted blob to the crypto worker for decryption
6. Return pubkey on success, null on failure

```typescript
export async function unlock(pin: string): Promise<string | null> {
  const blob = loadEncryptedKeyV2()
  if (!blob) return null

  // Fetch idp_value from facade (requires valid session)
  const idpValue = await authFacadeClient.getUserInfo()
  if (!idpValue) return null

  // Request PRF if this device uses it
  let prfOutput: Uint8Array | undefined
  if (blob.prfUsed) {
    prfOutput = await requestWebAuthnPRF()
  }

  const salt = hexToBytes(blob.salt)
  const kek = await deriveKEK({ pin, idpValue: idpValue.nsecSecret, prfOutput, salt })
  const kekHex = bytesToHex(kek)

  try {
    const pubkey = await cryptoWorker.unlock(kekHex, blob.ciphertext + ':' + blob.nonce)
    if (pubkey) {
      resetAutoLockTimers()
      notifyUnlockCallbacks()

      // Handle idp_value rotation if pending
      if (idpValue.pendingRotation) {
        await handleIdpValueRotation(pin, blob, idpValue, prfOutput)
      }
    }
    return pubkey
  } catch {
    return null
  }
}

/**
 * Re-encrypt the nsec blob with the new idp_value and confirm rotation.
 * Called automatically during unlock when a rotation is pending.
 */
async function handleIdpValueRotation(
  pin: string,
  currentBlob: EncryptedKeyDataV2,
  userInfo: UserInfo,
  prfOutput?: Uint8Array
): Promise<void> {
  // The nsec is already decrypted in the worker from the unlock above.
  // We need the raw nsec hex to re-encrypt with the new idp_value.
  // The worker exposes getPublicKey but NOT the nsec — so we ask the
  // worker to re-export the nsec encrypted under a NEW KEK.
  const newSalt = randomBytes(32)
  const newKek = await deriveKEK({
    pin,
    idpValue: userInfo.nsecSecret, // new (current) value
    prfOutput,
    salt: newSalt,
  })

  // Ask worker to re-encrypt the nsec under the new KEK
  const reEncrypted = await cryptoWorker.reEncrypt(bytesToHex(newKek))
  const newBlob: EncryptedKeyDataV2 = {
    ...currentBlob,
    salt: bytesToHex(newSalt),
    nonce: reEncrypted.nonce,
    ciphertext: reEncrypted.ciphertext,
  }
  storeEncryptedKeyV2(newBlob)
  await authFacadeClient.confirmRotation()
}
```

**Note:** This requires adding a `reEncrypt` operation to the crypto worker (Task 8) that re-encrypts the currently-held nsec under a new KEK without exposing the nsec to the main thread.

- [ ] **Step 3: Update `lock()` to delegate to worker**

```typescript
export async function lock(): Promise<void> {
  await cryptoWorker.lock()
  notifyLockCallbacks()
  clearAutoLockTimers()
}
```

- [ ] **Step 4: Update `isUnlocked()` to be async**

```typescript
export async function isUnlocked(): Promise<boolean> {
  return cryptoWorker.isUnlocked()
}
```

Note: This changes the signature from sync to async. All 27 consumer files will need to `await` this. See Task 15.

- [ ] **Step 5: Update `getPublicKeyHex()` to be async**

```typescript
export async function getPublicKeyHex(): Promise<string | null> {
  return cryptoWorker.getPublicKey()
}
```

- [ ] **Step 6: Keep backward-compatible exports where possible**

Keep these unchanged:
- `onLock(cb)` / `onUnlock(cb)` — callback registration (sync, no worker needed)
- `wipeKey()` — calls `cryptoWorker.lock()` + `clearStoredKeyV2()`
- `isValidPin()` — re-export from key-store-v2
- `hasStoredKey()` — re-export from key-store-v2 as `hasStoredKeyV2()`
- `setLockDelay()` / `getLockDelayMs()` — auto-lock timer config (no change)
- `disableAutoLock()` — no change

- [ ] **Step 7: Delete `src/client/lib/key-store.ts` (old v1)**

Remove the file entirely. All references should now point to key-store-v2.

- [ ] **Step 8: Run typecheck (expect many errors from consumers)**

Run: `bun run typecheck`
Expected: FAIL — many consumer files will error on:
- `getSecretKey()` no longer exists
- `isUnlocked()` now returns `Promise<boolean>` instead of `boolean`
- `getPublicKeyHex()` now returns `Promise<string | null>`

Note each failing file — these are addressed in Task 15.

- [ ] **Step 9: Commit**

```bash
git add src/client/lib/key-manager.ts
git rm src/client/lib/key-store.ts
git commit -m "feat: refactor key-manager to use crypto-worker, remove v1 key-store"
```

---

## Task 11: Auth Facade Client

**Files:**
- Create: `src/client/lib/auth-facade-client.ts`

**Depends on:** Task 6 (facade routes exist)

- [ ] **Step 1: Implement the facade client**

```typescript
// src/client/lib/auth-facade-client.ts

interface UserInfo {
  pubkey: string
  nsecSecret: Uint8Array
  pendingRotation?: {
    previousNsecSecret: Uint8Array
  }
}

interface TokenRefreshResult {
  accessToken: string
  userInfo: UserInfo
}

class AuthFacadeClient {
  private accessToken: string | null = null

  getAccessToken(): string | null {
    return this.accessToken
  }

  setAccessToken(token: string): void {
    this.accessToken = token
  }

  clearAccessToken(): void {
    this.accessToken = null
  }

  private async authedFetch(path: string, opts: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) throw new Error('Not authenticated')
    return fetch(path, {
      ...opts,
      headers: {
        ...opts.headers,
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    })
  }

  // --- Public (no auth) ---

  async getLoginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const res = await fetch('/auth/webauthn/login-options', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to get login options')
    return res.json()
  }

  async verifyLogin(response: AuthenticationResponseJSON): Promise<{ accessToken: string; pubkey: string }> {
    const res = await fetch('/auth/webauthn/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
      credentials: 'include', // for httpOnly refresh cookie
    })
    if (!res.ok) throw new Error('Login verification failed')
    const data = await res.json()
    this.accessToken = data.accessToken
    return data
  }

  async acceptInvite(code: string): Promise<{ valid: boolean }> {
    const res = await fetch('/auth/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    return res.json()
  }

  // --- Authenticated ---

  async getRegisterOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const res = await this.authedFetch('/auth/webauthn/register-options', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to get register options')
    return res.json()
  }

  async verifyRegistration(response: RegistrationResponseJSON): Promise<void> {
    const res = await this.authedFetch('/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify(response),
    })
    if (!res.ok) throw new Error('Registration verification failed')
  }

  async refreshToken(): Promise<TokenRefreshResult> {
    const res = await fetch('/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // JSON body required for CSRF
      credentials: 'include',
    })
    if (!res.ok) throw new Error('Token refresh failed')
    const data = await res.json()
    this.accessToken = data.accessToken
    return data
  }

  async getUserInfo(): Promise<UserInfo | null> {
    try {
      const res = await this.authedFetch('/auth/userinfo')
      if (!res.ok) return null
      const data = await res.json()
      return {
        pubkey: data.pubkey,
        nsecSecret: new Uint8Array(Buffer.from(data.nsecSecret, 'hex')),
        pendingRotation: data.pendingRotation ? {
          previousNsecSecret: new Uint8Array(Buffer.from(data.pendingRotation.previousNsecSecret, 'hex')),
        } : undefined,
      }
    } catch {
      return null
    }
  }

  async confirmRotation(): Promise<void> {
    await this.authedFetch('/auth/rotation/confirm', { method: 'POST', body: '{}' })
  }

  async revokeSession(): Promise<void> {
    await this.authedFetch('/auth/session/revoke', {
      method: 'POST',
      body: '{}',
      credentials: 'include',
    })
    this.accessToken = null
  }

  async listDevices(): Promise<WebAuthnCredentialInfo[]> {
    const res = await this.authedFetch('/auth/devices')
    if (!res.ok) return []
    return res.json()
  }

  async deleteDevice(id: string): Promise<void> {
    await this.authedFetch(`/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}

export const authFacadeClient = new AuthFacadeClient()
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (this is a standalone module)

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/auth-facade-client.ts
git commit -m "feat: add auth facade HTTP client"
```

---

## Task 12: WebAuthn PRF Support + Facade Integration

**Files:**
- Modify: `src/client/lib/webauthn.ts`

**Depends on:** Task 11 (auth facade client)

- [ ] **Step 1: Add PRF extension support**

```typescript
import { LABEL_KEK_PRF } from '@shared/crypto-labels'

/**
 * Request WebAuthn PRF evaluation for KEK derivation.
 * Returns the PRF output (32 bytes) or null if PRF is not supported.
 */
export async function requestWebAuthnPRF(): Promise<Uint8Array | null> {
  if (!isWebAuthnAvailable()) return null

  try {
    const salt = new TextEncoder().encode(LABEL_KEK_PRF)
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        extensions: {
          prf: { eval: { first: salt } },
        },
      },
    }) as PublicKeyCredential

    const prfResults = (credential.getClientExtensionResults() as { prf?: { results?: { first: ArrayBuffer } } }).prf
    if (!prfResults?.results?.first) return null

    return new Uint8Array(prfResults.results.first)
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Rewrite registration/login to use facade endpoints**

Replace all `/api/webauthn/*` calls with `authFacadeClient.*` calls. Remove direct `fetch` calls and `keyManager.createAuthToken()` usage.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/webauthn.ts
git commit -m "feat: add WebAuthn PRF support and facade endpoint integration"
```

---

## Task 13: Auth Provider Refactor

**Files:**
- Modify: `src/client/lib/auth.tsx`

**Depends on:** Task 10 (key-manager), Task 11 (facade client), Task 12 (WebAuthn PRF)

- [ ] **Step 1: Replace session token storage with JWT**

Remove `sessionStorage.setItem('llamenos-session-token', ...)`. Replace with `authFacadeClient.setAccessToken(jwt)`.

- [ ] **Step 2: Replace `signInWithPasskey()` with facade flow**

```typescript
async function signInWithPasskey(): Promise<void> {
  const options = await authFacadeClient.getLoginOptions()
  const response = await startAuthentication(options)
  const { accessToken, pubkey } = await authFacadeClient.verifyLogin(response)
  // Token is already set in the facade client
  setPublicKey(pubkey)
}
```

- [ ] **Step 3: Update `signOut()` to revoke via facade**

```typescript
async function signOut(): Promise<void> {
  await keyManager.lock()
  await authFacadeClient.revokeSession()
  setPublicKey(null)
}
```

- [ ] **Step 4: Add token refresh on app load and periodic refresh**

On app mount, attempt `authFacadeClient.refreshToken()`. Set up a 10-minute interval to silently refresh before the 15-minute JWT expires.

- [ ] **Step 5: Update context value types**

Since `isUnlocked` is now async, the auth context may need to track this as state updated via effect rather than computed inline.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: May still fail on consumer components — addressed in Task 15.

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/auth.tsx
git commit -m "feat: refactor auth provider to use facade + JWT tokens"
```

---

## Task 14: API Client Refactor

**Files:**
- Modify: `src/client/lib/api.ts`

**Depends on:** Task 13 (auth provider)

- [ ] **Step 1: Replace `getAuthHeaders()` with JWT-only**

```typescript
import { authFacadeClient } from './auth-facade-client'

export function getAuthHeaders(): Record<string, string> {
  const token = authFacadeClient.getAccessToken()
  if (!token) return {}
  return { 'Authorization': `Bearer ${token}` }
}
```

Remove all Schnorr fallback code. Remove `keyManager.createAuthToken()` import.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS for this file

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat: simplify API client to JWT-only auth headers"
```

---

## Task 15a: Core Crypto Library Refactor

**Files:**
- Modify: `src/client/lib/crypto.ts`
- Modify: `src/client/lib/hub-key-cache.ts`

**Depends on:** Task 10 (key-manager), Task 8 (crypto-worker)

These files currently accept `secretKey: Uint8Array` as a parameter (passed by callers who got it from `getSecretKey()`). They must be rewritten to delegate to the crypto worker.

- [ ] **Step 1: Refactor `crypto.ts` functions to use worker**

Functions that currently take `secretKey` param:
- `eciesUnwrapKey(envelope, secretKey, label)` → `eciesUnwrapKey(envelope, label)` (worker holds the key)
- `decryptNoteV2(encrypted, secretKey)` → `decryptNoteV2(encrypted)` (worker decrypts)
- `createAuthToken(secretKey, ...)` → DELETE (Schnorr auth removed)

Functions that wrap for recipients (don't need the secret key, only the recipient's public key):
- `eciesWrapKey(key, recipientPubkeyHex, label)` → unchanged (no secret key needed)
- `encryptNoteV2(payload, authorPubkey, adminPubkeys)` → unchanged (uses ephemeral keys)

The worker needs additional operations beyond sign/decrypt/encrypt — specifically ECIES unwrap. Add a `eciesUnwrap` message type to the worker protocol.

- [ ] **Step 2: Refactor `hub-key-cache.ts`**

Replace `getSecretKey()` calls with `cryptoWorker.eciesUnwrap()` for hub key unwrapping.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Fix errors in callers of the changed function signatures.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/crypto.ts src/client/lib/hub-key-cache.ts
git commit -m "feat: refactor crypto and hub-key-cache to use worker isolation"
```

---

## Task 15b: Nostr Relay Refactor

**Files:**
- Modify: `src/client/lib/nostr/relay.ts`

**Depends on:** Task 10 (key-manager), Task 8 (crypto-worker)

- [ ] **Step 1: Replace direct nsec signing with worker**

The relay module signs Nostr events with the nsec directly. Replace with `cryptoWorker.sign()`:

```typescript
// Before: const sig = schnorr.sign(eventHash, secretKey)
// After:  const sig = await cryptoWorker.sign(eventHashHex)
```

Event serialization (computing the event hash) stays in the main thread — only the signing step moves to the worker.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/nostr/
git commit -m "feat: sign Nostr relay events via crypto worker"
```

---

## Task 15c: UI Component Updates (Async Lock State)

**Files:** ~20 route and component files

**Depends on:** Task 10 (key-manager), Task 14 (API client)

- [ ] **Step 1: Find all affected UI files**

Run: `grep -rl 'isUnlocked\|getPublicKeyHex\|getSecretKey\|createAuthToken' src/client/routes/ src/client/components/ --include='*.ts' --include='*.tsx'`

- [ ] **Step 2: Establish async lock state pattern**

Most UI files check lock state via the auth context (from `auth.tsx`). Since Task 13 already updated the auth context to track lock state via useEffect, most component changes are minimal — they read from context which is already async-aware.

For files that import `keyManager` directly (bypassing context):
- Replace `keyManager.isUnlocked()` (sync boolean) with state from auth context
- Replace `keyManager.getPublicKeyHex()` (sync) with value from auth context
- Remove `keyManager.getSecretKey()` calls — use `cryptoWorker` methods
- Remove `keyManager.createAuthToken()` calls — no longer needed

- [ ] **Step 3: Update device linking route**

`src/client/routes/link-device.tsx` — **enforce ordering per spec**: WebAuthn registration and IdP enrollment must complete BEFORE nsec provisioning. Add a gate that checks for completed WebAuthn registration + valid IdP session before allowing the device linking protocol to proceed.

- [ ] **Step 4: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS — full client build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/client/
git commit -m "feat: update UI components for async key-manager and enforce device linking order"
```

---

## Task 16: Docker/Ansible Authentik Integration

**Files:**
- Modify: `deploy/docker/docker-compose.yml`
- Modify: `deploy/ansible/templates/docker-compose.j2`

**Depends on:** Task 3 (Authentik adapter)

- [ ] **Step 1: Add Authentik services to docker-compose.yml**

**Note:** Authentik 2025.10+ removed the Redis requirement — all caching, sessions, and task queuing use PostgreSQL. No Redis service needed.

```yaml
  authentik-server:
    image: ghcr.io/goauthentik/server:2025.12
    command: server
    restart: unless-stopped
    environment:
      AUTHENTIK_SECRET_KEY: ${AUTHENTIK_SECRET_KEY}
      AUTHENTIK_POSTGRESQL__HOST: postgres
      AUTHENTIK_POSTGRESQL__PORT: 5432
      AUTHENTIK_POSTGRESQL__USER: ${POSTGRES_USER:-llamenos}
      AUTHENTIK_POSTGRESQL__PASSWORD: ${POSTGRES_PASSWORD}
      AUTHENTIK_POSTGRESQL__NAME: authentik
    ports:
      - "${AUTHENTIK_PORT:-9000}:9000"
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - authentik-media:/media
      - authentik-templates:/templates

  authentik-worker:
    image: ghcr.io/goauthentik/server:2025.12
    command: worker
    restart: unless-stopped
    environment:
      AUTHENTIK_SECRET_KEY: ${AUTHENTIK_SECRET_KEY}
      AUTHENTIK_POSTGRESQL__HOST: postgres
      AUTHENTIK_POSTGRESQL__PORT: 5432
      AUTHENTIK_POSTGRESQL__USER: ${POSTGRES_USER:-llamenos}
      AUTHENTIK_POSTGRESQL__PASSWORD: ${POSTGRES_PASSWORD}
      AUTHENTIK_POSTGRESQL__NAME: authentik
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - authentik-media:/media
      - authentik-templates:/templates
```

Add volumes:
```yaml
volumes:
  authentik-media:
  authentik-templates:
```

**Verify:** After `docker compose up`, confirm Authentik starts without Redis by checking logs for successful startup (`authentik-server` should report ready on port 9000). If the 2025.12 image still requires Redis, add a `redis:alpine` service.

- [ ] **Step 2: Add Authentik database creation to postgres init**

Create or modify the postgres init script to create the `authentik` database alongside the main `llamenos` database.

- [ ] **Step 3: Add env vars to .env.example**

```env
# Authentik IdP
AUTHENTIK_SECRET_KEY=<generate with: openssl rand -hex 50>
AUTHENTIK_API_TOKEN=<created via Authentik admin UI after first boot>
IDP_ADAPTER=authentik
AUTHENTIK_URL=http://authentik-server:9000
IDP_VALUE_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
IDP_VALUE_KEY_VERSION=1
JWT_SECRET=<generate with: openssl rand -hex 32>
```

- [ ] **Step 4: Update Ansible template**

Mirror the docker-compose changes in `deploy/ansible/templates/docker-compose.j2`.

- [ ] **Step 5: Commit**

```bash
git add deploy/ .env.example
git commit -m "feat: add Authentik to Docker Compose and Ansible deployment"
```

---

## Task 17: Integration Tests

**Files:**
- Modify: `tests/ui/webauthn.spec.ts`
- Create: `tests/api/auth-facade.spec.ts`

**Depends on:** All previous tasks

- [ ] **Step 1: Write API integration tests for auth facade**

Test the full flow without a browser:
- POST /auth/webauthn/login-options returns valid challenge
- POST /auth/webauthn/login-verify with virtual authenticator returns JWT
- POST /auth/token/refresh with valid cookie returns new JWT
- GET /auth/userinfo returns idp_value
- POST /auth/session/revoke invalidates session
- Rate limiting on login endpoints

Use `tests/helpers/authed-request.ts` pattern adapted for JWT auth.

**Note:** These tests require Authentik running. Use docker-compose.test.yml or mock the IdP adapter at the service layer for faster tests.

- [ ] **Step 2: Update existing WebAuthn UI tests**

Update `tests/ui/webauthn.spec.ts` to:
- Register passkeys via `/auth/webauthn/*` facade endpoints (not `/api/webauthn/*`)
- Login via facade endpoints
- Verify JWT is returned instead of session token

- [ ] **Step 3: Write unit tests for multi-factor unlock flow**

Test the key-manager unlock path end-to-end with mocked:
- Auth facade client (returns mock idp_value)
- WebAuthn PRF (returns mock PRF output)
- Crypto worker (mock or in-process version)

- [ ] **Step 4: Run all tests**

Run: `bun run test:all`
Expected: PASS

- [ ] **Step 5: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "feat: add auth facade integration tests and update WebAuthn tests"
```

---

## Task 18: CSP Headers and Security Headers

**Files:**
- Create or modify: `src/server/middleware/security-headers.ts`
- Modify: Caddy config or Hono middleware (whichever currently sets headers)

**Depends on:** Task 8 (crypto worker must load under CSP)

- [ ] **Step 1: Audit current external resource loading**

Before setting COEP, check what external resources the app loads:
```bash
grep -r 'https://' src/client/ --include='*.ts' --include='*.tsx' --include='*.html' | grep -v node_modules
```
Any CDN fonts, analytics, or external scripts will break under `Cross-Origin-Embedder-Policy: require-corp`. Document each and decide: inline it, proxy it, or add `crossorigin` attribute.

- [ ] **Step 2: Create security headers middleware**

```typescript
// src/server/middleware/security-headers.ts
import type { MiddlewareHandler } from 'hono'

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next()

  // CSP
  c.header('Content-Security-Policy', [
    "script-src 'self'",
    "worker-src 'self'",
    "service-worker-src 'self'",
    "style-src 'self' 'unsafe-inline'", // shadcn/ui needs unsafe-inline for now
    "img-src 'self' data: blob:",
    "connect-src 'self' wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; '))

  // Cross-origin isolation for Spectre mitigation
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Embedder-Policy', 'require-corp')

  // Standard security headers
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
}
```

**Note:** `require-trusted-types-for 'script'` may break React — test carefully before enabling. Start without it and add in a follow-up if React is compatible.

- [ ] **Step 3: Wire middleware in app.ts**

```typescript
import { securityHeaders } from './middleware/security-headers'
app.use('*', securityHeaders)
```

- [ ] **Step 4: Test crypto worker loads under CSP**

Run: `bun run dev:server` and open the app in a browser. Verify:
- No CSP violation errors in console
- Crypto worker loads and responds to messages
- App renders correctly
- WebAuthn operations work

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/security-headers.ts src/server/app.ts
git commit -m "feat: add CSP and cross-origin isolation security headers"
```

---

## Task 19: Account Recovery Endpoints

**Files:**
- Modify: `src/server/routes/auth-facade.ts` (add admin endpoints)

**Depends on:** Task 6 (auth facade routes)

- [ ] **Step 1: Add admin re-enrollment endpoint**

```typescript
// In auth-facade.ts, add admin-only routes:

// POST /auth/admin/re-enroll/:pubkey
// Requires admin permissions. Revokes all sessions, deregisters all credentials.
// Volunteer must re-enroll as if setting up a new device.
router.post('/admin/re-enroll/:pubkey', async (c) => {
  const adminPubkey = c.get('pubkey')
  const targetPubkey = c.req.param('pubkey')

  // Verify admin permissions
  const permissions = c.get('permissions')
  if (!permissions.has('volunteers:update')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Revoke all IdP sessions
  await idpAdapter.revokeAllSessions(targetPubkey)

  // Delete all WebAuthn credentials
  const creds = await identity.getWebAuthnCredentials(targetPubkey)
  for (const cred of creds) {
    await identity.deleteWebAuthnCredential(targetPubkey, cred.id)
  }

  // Audit log
  await audit.log({
    action: 'volunteer.re-enrolled',
    actorPubkey: adminPubkey,
    targetPubkey,
  })

  return c.json({ success: true })
})
```

- [ ] **Step 2: Add credential count warning to GET /auth/devices**

When returning the device list, include a `warning` field if the user has only 1 registered credential:

```typescript
const creds = await identity.getWebAuthnCredentials(pubkey)
return c.json({
  devices: creds,
  warning: creds.length === 1 ? 'Register a backup device to prevent lockout' : undefined,
})
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "feat: add admin re-enrollment and single-credential warning"
```

---

## Deprecated Constants Cleanup

After all tasks are complete and passing:

- [ ] Remove `AUTH_PREFIX` from `src/shared/crypto-labels.ts` (deprecated in Task 7)
- [ ] Remove old v1 key store localStorage key (`llamenos-encrypted-key`) during first v2 write
- [ ] Update `docs/NEXT_BACKLOG.md` and `docs/COMPLETED_BACKLOG.md`
