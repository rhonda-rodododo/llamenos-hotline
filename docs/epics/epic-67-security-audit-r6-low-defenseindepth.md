# Epic 67: Security Audit R6 — Low Severity & Defense-in-Depth

## Overview

Address Low severity findings and defense-in-depth improvements from Security Audit Round 6. These are not blocking for production but improve the overall security posture.

## Tasks

### L-1: Restrict `adminPubkey` to Authenticated Users

**File**: `src/worker/routes/config.ts`

Move `adminPubkey` from the public config response to a separate authenticated endpoint (or include it only when the requester is authenticated). The client needs it for note encryption, which only happens post-login.

**Consideration**: The onboarding flow needs the admin pubkey before the new volunteer is fully authenticated (to encrypt the initial note). May need to return it after invite code validation instead.

### L-2: Mask Phone Numbers in Invite List and Delete Dialogs

**Files**: `src/client/routes/volunteers.tsx:184-186,538-540`

Apply the existing `maskedPhone()` function to:
- Pending invite list items
- Delete confirmation dialog description
- Any other location where full phone numbers appear without masking

### L-3: Refactor `keyPair` Out of React State

**File**: `src/client/lib/auth.tsx:396-412`, consumers in `routes/`

1. Remove the deprecated `keyPair` from `AuthContext`
2. Replace all consumers with `keyManager.getSecretKey()` called at the point of use
3. This confines the raw secret key to the key-manager closure instead of React's component tree

### L-4: Bind Schnorr Tokens to Request Path

**File**: `src/client/lib/crypto.ts:363-371`, `src/worker/lib/auth.ts:35`

Include the HTTP method and path in the signed message:
```
message = `llamenos:auth:${pubkey}:${timestamp}:${method}:${path}`
```

This prevents a captured token from being reused across different endpoints.

**Note**: Requires coordinating the change on both client and server. Consider a version flag or supporting both formats during migration.

### L-5: Fix Rate Limiter Off-by-One

**File**: `src/worker/durable-objects/settings-do.ts:281`

Change `recent.length > data.maxPerMinute` to `recent.length >= data.maxPerMinute`.

### L-6: Validate Shift Time Format

**File**: `src/worker/durable-objects/shift-manager.ts`

Add `HH:MM` format validation on `startTime` and `endTime`:
```typescript
const TIME_REGEX = /^\d{2}:\d{2}$/
if (!TIME_REGEX.test(shift.startTime) || !TIME_REGEX.test(shift.endTime)) {
  return new Response('Invalid time format', { status: 400 })
}
```

### L-7: Document CSP `style-src 'unsafe-inline'` Trade-off

**File**: `docs/security/THREAT_MODEL.md` or inline comment in `security-headers.ts`

Add documentation explaining why `unsafe-inline` is present for styles and what the residual risk is. If Tailwind/shadcn ever supports nonce-based styles, revisit.

### L-8: Reduce Playwright Trace Artifact Retention

**File**: `.github/workflows/ci.yml`

Change `retention-days: 7` to `retention-days: 1` for test result artifacts.

### L-9: Add Auto-Lock Panic Wipe Mechanism

**Files**: `src/client/lib/key-manager.ts`, new UI component

Add a "panic button" (keyboard shortcut, e.g., triple-tap Escape) that:
1. Immediately locks the key manager (`secretKey.fill(0)`)
2. Clears sessionStorage (session token)
3. Navigates to the login screen
4. Optionally clears the encrypted key from localStorage (full wipe)

This addresses device seizure scenarios where the volunteer has seconds to act.

### L-10: Add SRI Hashes for Service Worker Cached Assets

**File**: `vite.config.ts` (Workbox configuration)

Investigate adding Subresource Integrity verification for cached static assets. This would detect if a CDN or network intermediary tampers with cached JavaScript files.

## Acceptance Criteria

- [ ] All low findings addressed
- [ ] No regressions in existing functionality
- [ ] `bun run typecheck` and `bun run build` pass
- [ ] E2E tests pass
