# WebAuthn Registration & Authentication Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add E2E tests for WebAuthn passkey registration, authentication, multi-device session management, and credential deletion.

**Current state:** Device linking flow is tested. WebAuthn credential registration/verification/management (passkeys) is NOT tested.

**Challenge:** Playwright supports WebAuthn via the Virtual Authenticator (`cdp.send('WebAuthn.enable')`). Use this for testing without physical hardware keys.

---

## Phase 1: Playwright Virtual Authenticator Setup

### 1.1 Create WebAuthn test helper
- [ ] Add `setupVirtualAuthenticator(page)` to `tests/helpers.ts`:
  ```typescript
  async function setupVirtualAuthenticator(page: Page): Promise<string> {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('WebAuthn.enable', { enableUI: false })
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      }
    })
    return authenticatorId
  }
  ```
- [ ] Add `teardownVirtualAuthenticator(page, authenticatorId)` helper

### 1.2 Verify Playwright version supports WebAuthn CDP
- [ ] Check `playwright.config.ts` for browser version — WebAuthn virtual authenticator requires Chrome 87+
- [ ] Run a quick smoke test: `page.evaluate(() => navigator.credentials.create !== undefined)`

---

## Phase 2: Passkey Registration Tests

- [ ] Create `tests/webauthn.spec.ts`

### Test 2.1: Admin can register a passkey
```
Given: Admin is logged in with nsec + PIN
When: Admin navigates to profile settings → security section
When: Clicks "Add passkey"
When: Enters passkey label "My Laptop"
When: Browser passkey prompt appears (intercepted by virtual authenticator)
Then: Passkey registered successfully
Then: New credential appears in credentials list with label "My Laptop"
Then: Credential has creation date
```
- [ ] Use virtual authenticator (1.1) to auto-confirm the passkey prompt
- [ ] Verify `POST /api/webauthn/register-begin` and `POST /api/webauthn/register-end` called

### Test 2.2: Volunteer can register a passkey
```
Same as 2.1 but for volunteer role
```

### Test 2.3: Credential label is required
```
Given: Add passkey dialog open
When: Leave label empty, click register
Then: Error shown "Label is required"
Then: No API call made
```

### Test 2.4: Multiple passkeys can be registered
```
Given: One passkey already registered
When: Register second passkey with label "My Phone"
Then: Both credentials appear in list
Then: Each has distinct label and creation date
```

---

## Phase 3: Passkey Authentication Tests

### Test 3.1: Login with passkey (no nsec needed)
```
Given: A credential is registered for Admin
Given: Admin is logged out (cleared session)
When: Navigate to /login
When: Click "Sign in with passkey"
When: Browser passkey prompt appears (virtual authenticator selects credential)
Then: Login succeeds
Then: Admin is on dashboard
Then: No nsec was entered
```
- [ ] Verify `POST /api/webauthn/authenticate-begin` and `POST /api/webauthn/authenticate-end` called
- [ ] Verify session token stored in sessionStorage

### Test 3.2: Passkey login fails with wrong credential
```
Given: Volunteer A's credential registered
Given: Virtual authenticator has Volunteer B's credential loaded
When: Volunteer B attempts to log in as Volunteer A via passkey
Then: Authentication fails
Then: Error message shown
```

### Test 3.3: Session token from passkey works for API calls
```
Given: Logged in via passkey (no nsec)
When: Navigate to /volunteers (admin) or /notes (volunteer)
Then: Page loads successfully (session token valid for API calls)
Then: No 401 errors
```

---

## Phase 4: Credential Management Tests

### Test 4.1: Delete a passkey credential
```
Given: Admin has 2 credentials registered
When: Admin clicks delete on first credential
Then: Confirmation dialog appears
When: Confirms deletion
Then: Credential removed from list
Then: Only 1 credential remains
```

### Test 4.2: Cannot delete last credential (if PIN is also available)
```
Given: Admin has 1 credential and PIN-encrypted key
When: Admin attempts to delete last credential
Then: Deletion succeeds (PIN is still a login method)
```

### Test 4.3: Session management — view active sessions
```
Given: Admin logged in on two devices (two browser contexts)
When: Admin views "Active sessions" in profile settings
Then: Both sessions appear with device info and creation time
```

### Test 4.4: Revoke another session
```
Given: Admin logged in on two sessions
When: Admin revokes the "other" session from the sessions list
Then: The revoked session becomes invalid (returns 401 on next API call)
Then: Current session remains valid
```

---

## Phase 5: Multi-Device Flow Integration Test

### Test 5.1: Register passkey on newly linked device
```
Given: Volunteer has linked a new device (using device-linking flow from existing tests)
When: On the new device, navigate to security settings
When: Register a passkey for this device
Then: Passkey appears in credentials list on both devices
When: Log out of new device
When: Log back in via passkey (no nsec transfer needed)
Then: Login succeeds on new device
```

---

## Completion Checklist

- [ ] Virtual authenticator helper working in test context
- [ ] `bun run typecheck` passes
- [ ] Passkey registration: credential appears after successful registration
- [ ] Passkey authentication: login without nsec succeeds
- [ ] Session token from passkey auth works for API calls
- [ ] Credential deletion: removed from list
- [ ] Session revocation: revoked session returns 401
- [ ] `bunx playwright test tests/webauthn.spec.ts` passes
