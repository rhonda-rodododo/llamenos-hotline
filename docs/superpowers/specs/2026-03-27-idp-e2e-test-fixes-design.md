# IdP Auth — E2E Test Fixes Design Spec

**Date**: 2026-03-27
**Status**: Draft
**Context**: 11 E2E tests fail after IdP auth migration (JWT + Authentik + v2 key store)

## Problem Statement

After migrating from Schnorr/session-based auth to JWT + Authentik IdP, 11 of 450 UI E2E tests fail. Analysis reveals three distinct root cause categories:

1. **Test helper bug** (7 tests) — `loginAsVolunteer` doesn't persist JWT in sessionStorage
2. **Stubbed `signIn` function** (2 tests) — demo-mode and invite-onboarding call `signIn(nsec)` which is now a no-op error stub
3. **WebAuthn registration endpoint auth** (4 tests) — passkey flows fail because the WebAuthn API endpoints return 401 or the registration/verification flow doesn't properly issue JWTs

## Root Cause Analysis

### Category A: Missing `sessionStorage.setItem('__TEST_JWT')` in `loginAsVolunteer`

**Affected tests**: blasts:53, call-flow:284, profile-settings:139, capture-screenshots:220, pin-challenge:56

The `loginAsAdmin` helper correctly stores JWT in both sessionStorage and the facade client:
```ts
sessionStorage.setItem('__TEST_JWT', token)
window.__TEST_AUTH_FACADE.setAccessToken(token)
```

But `loginAsVolunteer` only calls `setAccessToken` — it's missing the `sessionStorage.setItem` line. After any page reload, the AuthFacadeClient constructor can't find the JWT.

**Fix**: Add `sessionStorage.setItem('__TEST_JWT', token)` to `loginAsVolunteer`.

### Category B: `signIn(nsec)` is a no-op stub

**Affected tests**: demo-mode:132, invite-onboarding:7

The `signIn` function in `auth.tsx` was converted to an error stub during the IdP migration:
```ts
const signIn = useCallback(async (_nsec: string) => {
  setState((s) => ({
    ...s,
    error: 'Direct nsec sign-in is no longer supported...',
  }))
}, [])
```

Both the demo account picker and invite acceptance flow call `signIn(nsec)` after key import. With the stub, login silently fails and the user stays on the login page.

**Design decision**: `signIn` should perform a lightweight JWT acquisition for cases where the user has a valid nsec but no existing JWT session. Options:

1. **Facade-based sign-in**: After key import, call a `/api/auth/session/create` endpoint that accepts a Schnorr challenge-response and returns a JWT. This is what passkey login does, but with nsec instead of WebAuthn.
2. **Synthetic session for demo/invite**: For demo mode specifically, have the server issue a JWT for known demo accounts without full Authentik enrollment. For invites, the invite-accept endpoint already creates the user in Authentik and returns the nsecSecret — use that to acquire a JWT.
3. **Test-only workaround**: Inject a JWT via test helpers after key import, bypassing `signIn` entirely.

**Recommended**: Option 2 for demo, Option 1 for invite. Option 3 is a fallback if app code changes are deferred.

### Category C: WebAuthn endpoints return 401

**Affected tests**: webauthn:97, webauthn:212, webauthn:341, webauthn-passkeys:87

The passkey registration/login flow calls these endpoints:
- `POST /api/auth/webauthn/register-options` (requires jwtAuth)
- `POST /api/auth/webauthn/register-verify` (requires jwtAuth)
- `POST /api/auth/webauthn/login-options` (public)
- `POST /api/auth/webauthn/login-verify` (public, returns JWT on success)

Registration requires an existing JWT session. The test has a valid JWT (admin is logged in via `loginAsAdmin`), but the registration may fail because:
1. The `registerCredential` function in the client reads the JWT from the facade, which should be populated
2. The server's jwtAuth middleware validates the JWT claims

**Investigation needed**: Run with `DEBUG=pw:api` to capture the actual HTTP requests and verify whether the JWT is being sent.

## Proposed Changes

### Phase 1: Quick fixes (test helpers only)

1. Add `sessionStorage.setItem('__TEST_JWT', token)` to `loginAsVolunteer` in `tests/helpers/index.ts`
2. Verify the 7 Category A tests pass

### Phase 2: Demo mode auth flow

1. Update `DemoAccountPicker` to use `unlockWithPin` instead of `signIn`:
   - Import key with synthetic IdP value (already done)
   - Store a test/demo JWT in the facade client directly
   - OR call a new `/api/auth/demo/session` endpoint that issues a JWT for demo accounts
2. The demo endpoint should verify the demo account exists and issue a short-lived JWT

### Phase 3: Invite onboarding auth flow

1. After invite acceptance creates the user in Authentik and returns nsecSecret:
   - The onboarding flow should call the auth facade to get a JWT
   - Use the nsecSecret + PIN to derive KEK and import the key
   - The facade's token is then available for subsequent API calls
2. Update `invite-onboarding.spec.ts` if the flow changes

### Phase 4: WebAuthn investigation

1. Add request logging to WebAuthn tests to verify JWT is being sent
2. If JWT is sent but rejected, check server-side jwtAuth middleware for WebAuthn routes
3. If JWT is not sent, trace the client's `registerCredential` → `authFacadeClient.authedFetch` path

## Non-goals

- Changing the auth architecture (JWT + Authentik is the target state)
- Supporting Schnorr-based auth as a fallback
- Production auth flows (only E2E test compatibility)
