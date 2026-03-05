# Epic 256: Fix BlastDO HMAC Key Usage

**Priority**: P1 — Security
**Severity**: MEDIUM
**Category**: Cryptography / Authentication
**Status**: Pending

## Problem

Two HMAC operations in `BlastDO` use public domain-separation constants as the HMAC key instead of the server's `HMAC_SECRET`:

1. **`generatePreferenceToken` (line 65-69)**: Uses `HMAC_PREFERENCE_TOKEN` ("llamenos:preference-token") as the HMAC key. Anyone with the source code can compute any subscriber's preference token.

2. **`importSubscribers` (line 229-231)**: Uses `HMAC_SUBSCRIBER` ("llamenos:subscriber") as the HMAC key for computing `identifierHash`. Anyone with the source code can compute hashes from raw phone numbers.

Combined, an attacker can:
1. Compute the `identifierHash` from a known phone number (using the public HMAC key)
2. Compute the `preferenceToken` from the `identifierHash` (using another public HMAC key)
3. Use the forged token to unsubscribe victims, change their language, or manipulate their tags

This only affects the **import** code path. The webhook inbound path (via messaging adapters) correctly uses `hashPhone(from, this.hmacSecret)` which is keyed with the real `HMAC_SECRET`.

## Affected Files

- `apps/worker/durable-objects/blast-do.ts:65-69` — `generatePreferenceToken()`
- `apps/worker/durable-objects/blast-do.ts:229-231` — `importSubscribers()` identifierHash computation

## Solution

### 1. Fix `generatePreferenceToken` to use `HMAC_SECRET`

```typescript
// Before (broken — public constant as HMAC key)
private generatePreferenceToken(identifierHash: string): string {
  const key = utf8ToBytes(HMAC_PREFERENCE_TOKEN)
  const input = utf8ToBytes(identifierHash)
  return bytesToHex(hmac(sha256, key, input))
}

// After (fixed — server secret as HMAC key, domain label as prefix)
private generatePreferenceToken(identifierHash: string): string {
  const key = hexToBytes(this.env.HMAC_SECRET)
  const input = utf8ToBytes(`${HMAC_PREFERENCE_TOKEN}${identifierHash}`)
  return bytesToHex(hmac(sha256, key, input))
}
```

### 2. Fix `importSubscribers` to use `HMAC_SECRET`

```typescript
// Before (broken — public constant as HMAC key)
const identifierHash = bytesToHex(
  hmac(sha256, utf8ToBytes(HMAC_SUBSCRIBER), utf8ToBytes(entry.identifier))
)

// After (fixed — mirrors hashPhone pattern using server secret)
const identifierHash = bytesToHex(
  hmac(sha256, hexToBytes(this.env.HMAC_SECRET), utf8ToBytes(`${HMAC_SUBSCRIBER}${entry.identifier}`))
)
```

This now matches the pattern used by `hashPhone()` in `apps/worker/lib/crypto.ts:14-18`, where `HMAC_SECRET` is the key and the domain label is part of the input.

### 3. Migration

Existing subscribers created via the import path have identifierHashes computed with the public key. After fixing:
- New imports will produce different hashes → duplicates could be created
- Existing preference tokens become invalid

**Migration approach**: Add a migration that re-computes all subscriber identifierHashes and preference tokens:
1. List all `subscribers:*` entries
2. For each subscriber, the `identifierHash` is the storage key suffix
3. We can't reverse the old hash to get the original identifier (that's the point)
4. However, since the old hash used a public constant as key, we CAN'T recover the original phone number from it either

**Problem**: We can't migrate without the original identifiers. This means:
- Existing import-path subscribers will have stale hashes/tokens
- The webhook-path subscribers already use `HMAC_SECRET` and are unaffected
- **Decision**: Accept that existing import-path subscribers need to be re-imported after the fix. Document this in release notes.

Alternatively: keep the old hash format as a secondary lookup key for a transition period, then remove it.

### 4. No client-side changes needed

Preference tokens are server-generated and delivered in unsubscribe links. The fix is entirely server-side.

## Testing

- Unit test: `generatePreferenceToken` with known inputs → deterministic output using HMAC_SECRET
- Unit test: import subscriber → identifierHash matches `hashPhone` pattern
- Unit test: forged token with public constant → rejected
- Integration test: preference update with valid token → 200
- Integration test: preference update with old-format token → 404
