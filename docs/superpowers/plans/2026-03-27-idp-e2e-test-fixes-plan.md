# IdP Auth — E2E Test Fixes Plan

**Date**: 2026-03-27
**Spec**: [2026-03-27-idp-e2e-test-fixes-design.md](../specs/2026-03-27-idp-e2e-test-fixes-design.md)
**Goal**: Fix all 11 remaining E2E test failures from IdP auth migration

## Current State

- 424/450 UI E2E tests pass (94%)
- 285/285 API tests pass (100%)
- 249/259 unit tests pass (10 pre-existing telephony failures)

## Phase 1: loginAsVolunteer sessionStorage fix [5 min]

**Impact**: Fixes 5-7 tests (blasts, call-flow, profile-settings, capture-screenshots, pin-challenge)

- [ ] Add `sessionStorage.setItem('__TEST_JWT', token)` to `loginAsVolunteer` in `tests/helpers/index.ts` (line ~262)
- [ ] Run the 5 affected tests to confirm
- [ ] Run full suite to measure improvement

**Files**: `tests/helpers/index.ts`

## Phase 2: Demo mode signIn replacement [30 min]

**Impact**: Fixes demo-mode:132

The `signIn(nsec)` function in `auth.tsx` is a no-op stub. Demo mode calls it after `importKey`. Two options:

### Option A: Client-side demo JWT (simpler, test-friendly)
- [ ] In `DemoAccountPicker`, after `importKey`, call `unlockWithPin(DEMO_PIN)` instead of `signIn(nsec)`
- [ ] BUT: `unlockWithPin` calls `getMe()` which requires a JWT, creating a chicken-and-egg
- [ ] Solution: Have demo accounts pre-enrolled in Authentik (via test-reset or server init)
- [ ] Add `/api/auth/demo/session` endpoint that issues a JWT for known demo account pubkeys
- [ ] `DemoAccountPicker` calls this endpoint after `importKey`, gets JWT, sets in facade, then calls `unlockWithPin`

### Option B: Server-issued JWT during demo login (cleaner)
- [ ] Create `POST /api/auth/demo/session` endpoint:
  - Accepts `{ pubkey }`
  - Verifies pubkey is a known demo account (from DEMO_ACCOUNTS config)
  - Returns `{ accessToken }` (short-lived JWT)
  - Only available when `ENVIRONMENT=demo` or `ENVIRONMENT=development`
- [ ] Update `DemoAccountPicker` to call this endpoint after `importKey`
- [ ] Set JWT in facade client → call `unlockWithPin` or navigate directly

**Files**:
- `src/server/routes/auth.ts` or `src/server/routes/dev.ts` (new endpoint)
- `src/client/components/demo-account-picker.tsx` (use new endpoint)
- `src/client/lib/auth.tsx` (may need to update `signIn` or remove it)

## Phase 3: Invite onboarding auth flow [45 min]

**Impact**: Fixes invite-onboarding:7

The invite flow:
1. Admin creates invite → gets invite code
2. Volunteer opens invite link → `/onboarding?code=XXX`
3. Onboarding page: volunteer enters PIN, app calls `POST /api/invites/accept`
4. Server creates volunteer + enrolls in Authentik → returns nsecSecret
5. Client imports key with nsecSecret as IdP value → calls `signIn(nsec)` (BROKEN)

Fix:
- [ ] After invite accept returns nsecSecret, the onboarding flow should:
  1. Import key with real IdP value (nsecSecret) instead of synthetic
  2. Call `/api/auth/enroll` or use the nsecSecret to get a JWT
  3. Set JWT in facade client
  4. Navigate to dashboard (key is already imported + unlocked)
- [ ] Update `src/client/routes/onboarding.tsx` to use new auth flow
- [ ] May need a new endpoint: `POST /api/auth/session/from-enrollment` that accepts pubkey + nsecSecret proof and returns JWT

**Files**:
- `src/client/routes/onboarding.tsx` (update post-invite flow)
- `src/server/routes/auth-facade.ts` (may need new session endpoint)

## Phase 4: WebAuthn endpoint investigation [30 min]

**Impact**: Fixes 4 webauthn tests

- [ ] Add `page.on('request')` logging in webauthn test to capture Authorization headers
- [ ] Verify JWT is sent to `/api/auth/webauthn/register-options`
- [ ] If JWT missing: trace `registerCredential` → `authFacadeClient.authedFetch` path
- [ ] If JWT sent but 401: check server jwtAuth middleware for WebAuthn routes
- [ ] If registration succeeds but no credential row: check if `listCredentials` returns data
- [ ] Fix based on findings (likely either facade client state or server-side JWT validation)

**Files**:
- `tests/ui/webauthn.spec.ts` (debug logging first, then fix)
- `src/client/lib/webauthn.ts` (if client-side auth issue)
- `src/server/routes/auth-facade.ts` (if server-side auth issue)

## Phase 5: Verification [15 min]

- [ ] Run `bun run typecheck` — must pass
- [ ] Run `bun run build` — must pass
- [ ] Run full API test suite — 285/285
- [ ] Run full UI E2E test suite — target: 440+/450
- [ ] Commit and push

## Execution Order

Phase 1 first (trivial fix, biggest bang for buck), then Phase 4 (investigation may reveal it's also trivial), then Phase 2 and 3 (require app code changes).

## Risk Assessment

- **Phase 1**: Zero risk — one-line test helper fix
- **Phase 2**: Low risk — demo mode is dev/demo only, no production impact
- **Phase 3**: Medium risk — invite onboarding is a real user flow; changes affect the auth UX
- **Phase 4**: Unknown until investigated — could be trivial (missing header) or require auth flow changes
