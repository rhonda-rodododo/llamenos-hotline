# Epic 254: Remove Auth Token Unbound Fallback

**Priority**: P0 — Security
**Severity**: HIGH
**Category**: Authentication
**Status**: Pending

## Problem

`verifyAuthToken` in `apps/worker/lib/auth.ts:42-46` has a fallback that accepts Schnorr signatures without method+path binding. When the primary (request-bound) verification fails, it falls back to verifying `llamenos:auth:{pubkey}:{timestamp}` — no method, no path. A token captured from any endpoint can be replayed to any other endpoint within the 5-minute freshness window.

The comment says "transition period for old tokens" but there is no expiry, no feature flag, and no enforcement. All current clients (desktop, iOS, Android) already produce method+path-bound tokens.

## Affected Files

- `apps/worker/lib/auth.ts:42-46` — The fallback verification path

## Solution

Remove lines 42-46 entirely. The fallback path is dead code — no current client produces unbound tokens.

### Before

```typescript
export async function verifyAuthToken(auth: AuthPayload, method?: string, path?: string): Promise<boolean> {
  if (!validateToken(auth)) return false
  try {
    if (method && path) {
      const boundMessage = `${AUTH_PREFIX}${auth.pubkey}:${auth.timestamp}:${method}:${path}`
      const boundHash = sha256(utf8ToBytes(boundMessage))
      if (schnorr.verify(hexToBytes(auth.token), boundHash, hexToBytes(auth.pubkey))) {
        return true
      }
      // Fallback: verify without method+path (transition period for old tokens)
    }
    const message = `${AUTH_PREFIX}${auth.pubkey}:${auth.timestamp}`
    const messageHash = sha256(utf8ToBytes(message))
    return schnorr.verify(hexToBytes(auth.token), messageHash, hexToBytes(auth.pubkey))
  } catch {
    return false
  }
}
```

### After

```typescript
export async function verifyAuthToken(auth: AuthPayload, method?: string, path?: string): Promise<boolean> {
  if (!validateToken(auth)) return false
  if (!method || !path) return false // method+path are required
  try {
    const boundMessage = `${AUTH_PREFIX}${auth.pubkey}:${auth.timestamp}:${method}:${path}`
    const boundHash = sha256(utf8ToBytes(boundMessage))
    return schnorr.verify(hexToBytes(auth.token), boundHash, hexToBytes(auth.pubkey))
  } catch {
    return false
  }
}
```

### Unit test update

The test at `apps/worker/__tests__/unit/auth-utils.test.ts:188-194` explicitly tests the fallback:
```typescript
it('falls back to unbound verification when method/path provided but token is unbound', ...)
```

This test should be updated to assert that unbound tokens are now **rejected**.

## Testing

- Update existing auth unit test to verify unbound tokens are rejected
- Run full E2E suite to verify no client is accidentally sending unbound tokens
- `bun run test` — all Playwright tests must pass (they use the desktop client which sends bound tokens)
