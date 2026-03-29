# Decrypt-on-Fetch Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move E2EE field decryption from React render-time (sync, leaks nsec to main thread) to the API client layer (async, worker-based), so the secret key never leaves the crypto Web Worker.

**Architecture:** A new `decryptFields` utility in the API client intercepts responses that contain encrypted envelope fields (encryptedName, encryptedPhone, etc.) and decrypts them via the crypto worker before returning to React. Components receive pre-decrypted data and never touch cryptographic keys. A `useDecryptedData` hook handles the async boundary for components that need to re-decrypt when the key unlocks.

**Tech Stack:** TypeScript, React hooks, Web Worker (`crypto-worker.ts`), ECIES envelope crypto (`@shared/crypto-primitives`), `bun:test`

---

## Context

### Problem
The field-level encryption PR (main) added `tryDecryptField()` — a sync function called in React render paths across 17 files. It requires the secret key on the main thread. Our IdP branch moved the nsec into a Web Worker for isolation, creating a conflict: the merge agent cached the raw nsec on the main thread, defeating the security model.

### Design Principles
1. **nsec never on main thread** — all private-key operations go through `crypto-worker.ts`
2. **Decrypt once, render many** — cache decrypted values keyed by ciphertext
3. **Graceful degradation** — show server-provided fallback (`[encrypted]`) until decryption completes
4. **No render-phase async** — decryption triggers re-render via state, not inline await

### Encrypted Field Inventory

| Field | API function | Types affected |
|-------|-------------|----------------|
| Volunteer name | `listVolunteers()`, `getMe()`, `getVolunteer()` | `Volunteer` |
| Ban phone + reason | `listBans()` | `BanEntry` |
| Caller last 4 | `getCallHistory()` | `CallRecord` |
| Contact last 4 | `listConversations()` | `Conversation` |
| Invite name | `listInvites()` | `InviteCode` |
| WebAuthn label | `listCredentials()` (facade) | `WebAuthnCredentialInfo` |

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/client/lib/crypto-worker.ts` | Modify | Add `decryptEnvelopeField` message handler |
| `src/client/lib/crypto-worker-client.ts` | Modify | Add `decryptEnvelopeField()` async method |
| `src/client/lib/decrypt-fields.ts` | Create | Field decryption cache + `decryptApiFields()` utility |
| `src/client/lib/use-decrypted.ts` | Create | `useDecryptedData<T>` React hook |
| `src/client/lib/envelope-field-crypto.ts` | Modify | Remove `tryDecryptField`, keep `decryptEnvelopeField` for tests |
| `src/client/lib/key-manager.ts` | Modify | Remove `_cachedSecretKey`, `getSecretKey()`, sync cache |
| `src/client/lib/api.ts` | Modify | Add decrypt-on-fetch to API functions |
| 15 component files | Modify | Replace `tryDecryptField()` with pre-decrypted fields |
| `src/client/lib/decrypt-fields.test.ts` | Create | Unit tests for decrypt cache |
| `src/client/lib/use-decrypted.test.ts` | Create | Hook tests |

---

### Task 1: Add envelope field decryption to crypto worker

The crypto worker already has ECIES unwrap (`decrypt` message type). Add a higher-level `decryptEnvelopeField` that does ECIES unwrap + symmetric decrypt in one round trip.

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`
- Modify: `src/client/lib/crypto-worker-client.ts`

- [ ] **Step 1: Add worker message type and handler**

In `src/client/lib/crypto-worker.ts`, add to the `WorkerRequest` union:

```typescript
| {
    type: 'decryptEnvelopeField'
    id: string
    encryptedHex: string
    ephemeralPubkeyHex: string
    wrappedKeyHex: string
    label: string
  }
```

Add handler before the `default` case in the switch:

```typescript
case 'decryptEnvelopeField': {
  if (!secretKey) throw new Error('Worker is locked')
  if (!checkRateLimit('decrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  // ECIES unwrap the message key
  const messageKey = eciesUnwrap(
    req.ephemeralPubkeyHex,
    req.wrappedKeyHex,
    secretKey,
    req.label
  )
  // Symmetric decrypt the field value
  const data = hexToBytes(req.encryptedHex)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(messageKey, nonce)
  const plaintext = cipher.decrypt(ciphertext)
  result = new TextDecoder().decode(plaintext)
  break
}
```

- [ ] **Step 2: Add client method**

In `src/client/lib/crypto-worker-client.ts`, add:

```typescript
/**
 * Decrypt an envelope-encrypted field entirely inside the worker.
 * Combines ECIES unwrap + XChaCha20-Poly1305 decrypt in one round trip.
 * Returns the decrypted plaintext string.
 */
async decryptEnvelopeField(
  encryptedHex: string,
  ephemeralPubkeyHex: string,
  wrappedKeyHex: string,
  label: string
): Promise<string> {
  return (await this.call({
    type: 'decryptEnvelopeField',
    encryptedHex,
    ephemeralPubkeyHex,
    wrappedKeyHex,
    label,
  })) as string
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts
git commit -m "feat: add decryptEnvelopeField to crypto worker for field-level decryption"
```

---

### Task 2: Create decrypt-fields cache and utility

A decryption cache that maps `(ciphertext, label)` → plaintext. The `decryptApiFields` function walks an API response object, finds encrypted fields by convention (`encrypted*` + `*Envelopes`), decrypts them via the worker, and populates the plaintext fields.

**Files:**
- Create: `src/client/lib/decrypt-fields.ts`
- Create: `src/client/lib/decrypt-fields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/lib/decrypt-fields.test.ts`:

```typescript
import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { DecryptCache, resolveEncryptedFields } from './decrypt-fields'

describe('DecryptCache', () => {
  test('returns null for unknown keys', () => {
    const cache = new DecryptCache()
    expect(cache.get('abc', 'label')).toBeNull()
  })

  test('stores and retrieves decrypted values', () => {
    const cache = new DecryptCache()
    cache.set('abc', 'label', 'hello')
    expect(cache.get('abc', 'label')).toBe('hello')
  })

  test('clear removes all entries', () => {
    const cache = new DecryptCache()
    cache.set('abc', 'label', 'hello')
    cache.clear()
    expect(cache.get('abc', 'label')).toBeNull()
  })
})

describe('resolveEncryptedFields', () => {
  test('identifies encrypted field pairs from object', () => {
    const obj = {
      name: '[encrypted]',
      encryptedName: 'deadbeef',
      nameEnvelopes: [{ pubkey: 'pk1', wrappedKey: 'wk1', ephemeralPubkey: 'ep1' }],
      id: 'vol-1',
    }
    const fields = resolveEncryptedFields(obj)
    expect(fields).toHaveLength(1)
    expect(fields[0]).toEqual({
      plaintextKey: 'name',
      ciphertext: 'deadbeef',
      envelope: { pubkey: 'pk1', wrappedKey: 'wk1', ephemeralPubkey: 'ep1' },
    })
  })

  test('skips fields without envelopes', () => {
    const obj = {
      encryptedName: 'deadbeef',
      // no nameEnvelopes
    }
    expect(resolveEncryptedFields(obj)).toHaveLength(0)
  })

  test('finds multiple encrypted field pairs', () => {
    const obj = {
      encryptedPhone: 'aabb',
      phoneEnvelopes: [{ pubkey: 'pk1', wrappedKey: 'w1', ephemeralPubkey: 'e1' }],
      encryptedReason: 'ccdd',
      reasonEnvelopes: [{ pubkey: 'pk1', wrappedKey: 'w2', ephemeralPubkey: 'e2' }],
    }
    expect(resolveEncryptedFields(obj)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test ./src/client/lib/decrypt-fields.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement decrypt-fields.ts**

Create `src/client/lib/decrypt-fields.ts`:

```typescript
/**
 * Decrypt-on-fetch field decryption cache and utilities.
 *
 * Intercepts API response objects with encrypted envelope fields
 * (encryptedName + nameEnvelopes, encryptedPhone + phoneEnvelopes, etc.)
 * and decrypts them via the crypto worker. Caches results to avoid
 * redundant decryption across re-renders.
 *
 * The secret key never leaves the Web Worker.
 */

import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import { getCryptoWorker } from './crypto-worker-client'

// ---------------------------------------------------------------------------
// Decrypt cache — keyed by (ciphertext, label) → plaintext
// ---------------------------------------------------------------------------

export class DecryptCache {
  private cache = new Map<string, string>()

  private key(ciphertext: string, label: string): string {
    return `${label}:${ciphertext}`
  }

  get(ciphertext: string, label: string): string | null {
    return this.cache.get(this.key(ciphertext, label)) ?? null
  }

  set(ciphertext: string, label: string, plaintext: string): void {
    this.cache.set(this.key(ciphertext, label), plaintext)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

/** Global decrypt cache — cleared on key lock. */
export const decryptCache = new DecryptCache()

// ---------------------------------------------------------------------------
// Field resolution — find encrypted + envelope pairs in an object
// ---------------------------------------------------------------------------

export interface EncryptedFieldRef {
  plaintextKey: string
  ciphertext: string
  envelope: RecipientEnvelope
}

/**
 * Scan an object for encrypted field pairs.
 * Convention: `encryptedFoo` + `fooEnvelopes` → plaintext goes into `foo`.
 * Returns only fields that have a matching envelope for the current user's pubkey.
 */
export function resolveEncryptedFields(
  obj: Record<string, unknown>,
  readerPubkey?: string
): EncryptedFieldRef[] {
  const results: EncryptedFieldRef[] = []

  for (const key of Object.keys(obj)) {
    if (!key.startsWith('encrypted')) continue
    const value = obj[key]
    if (typeof value !== 'string' || !value) continue

    // encryptedFoo → foo
    const baseName = key.slice('encrypted'.length)
    const plaintextKey = baseName.charAt(0).toLowerCase() + baseName.slice(1)

    // Look for fooEnvelopes
    const envelopesKey = `${plaintextKey}Envelopes`
    const envelopes = obj[envelopesKey] as RecipientEnvelope[] | undefined
    if (!Array.isArray(envelopes) || envelopes.length === 0) continue

    // Find envelope for reader (or take first if no pubkey filter)
    const envelope = readerPubkey
      ? envelopes.find((e) => e.pubkey === readerPubkey)
      : envelopes[0]
    if (!envelope) continue

    results.push({ plaintextKey, ciphertext: value, envelope })
  }

  return results
}

// ---------------------------------------------------------------------------
// Async field decryption via crypto worker
// ---------------------------------------------------------------------------

/**
 * Decrypt all encrypted envelope fields on an object, mutating in place.
 * Uses the decrypt cache to avoid redundant worker round trips.
 * Returns the same object reference (mutated) for chaining.
 *
 * Fields that fail to decrypt are left as-is (server fallback preserved).
 */
export async function decryptObjectFields<T extends Record<string, unknown>>(
  obj: T,
  readerPubkey: string,
  label: string = LABEL_VOLUNTEER_PII
): Promise<T> {
  const fields = resolveEncryptedFields(obj, readerPubkey)
  if (fields.length === 0) return obj

  const worker = getCryptoWorker()

  await Promise.all(
    fields.map(async ({ plaintextKey, ciphertext, envelope }) => {
      // Check cache first
      const cached = decryptCache.get(ciphertext, label)
      if (cached !== null) {
        ;(obj as Record<string, unknown>)[plaintextKey] = cached
        return
      }

      try {
        const plaintext = await worker.decryptEnvelopeField(
          ciphertext,
          envelope.ephemeralPubkey,
          envelope.wrappedKey,
          label
        )
        decryptCache.set(ciphertext, label, plaintext)
        ;(obj as Record<string, unknown>)[plaintextKey] = plaintext
      } catch {
        // Decryption failed — leave server fallback in place
      }
    })
  )

  return obj
}

/**
 * Decrypt encrypted fields on every item in an array.
 */
export async function decryptArrayFields<T extends Record<string, unknown>>(
  items: T[],
  readerPubkey: string,
  label: string = LABEL_VOLUNTEER_PII
): Promise<T[]> {
  await Promise.all(items.map((item) => decryptObjectFields(item, readerPubkey, label)))
  return items
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test ./src/client/lib/decrypt-fields.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/decrypt-fields.ts src/client/lib/decrypt-fields.test.ts
git commit -m "feat: add decrypt-on-fetch field decryption cache and utilities"
```

---

### Task 3: Create useDecryptedData hook

A React hook that takes raw API data (with encrypted fields) and returns decrypted data. Shows fallback values immediately, triggers async worker decryption, then re-renders with decrypted values.

**Files:**
- Create: `src/client/lib/use-decrypted.ts`

- [ ] **Step 1: Implement the hook**

Create `src/client/lib/use-decrypted.ts`:

```typescript
/**
 * React hook for decrypt-on-fetch pattern.
 *
 * Takes API response data with encrypted envelope fields and returns
 * a decrypted copy. On first render, returns the original data (with
 * server fallbacks like "[encrypted]"). Triggers async worker decryption
 * and re-renders with decrypted values when complete.
 *
 * Re-decrypts when:
 * - Input data changes (new API response)
 * - Key unlocks (user enters PIN)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { decryptArrayFields, decryptCache, decryptObjectFields } from './decrypt-fields'
import * as keyManager from './key-manager'

/**
 * Decrypt encrypted fields on a single object.
 * Returns the input immediately, then re-renders with decrypted values.
 */
export function useDecryptedObject<T extends Record<string, unknown>>(
  data: T | null,
  label: string = LABEL_VOLUNTEER_PII
): T | null {
  const [decrypted, setDecrypted] = useState<T | null>(data)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!data) {
      setDecrypted(null)
      return
    }

    // Start with raw data (server fallbacks visible)
    setDecrypted(data)

    // Attempt async decryption
    void (async () => {
      const isUnlocked = await keyManager.isUnlocked()
      if (!isUnlocked || !mountedRef.current) return

      const pubkey = await keyManager.getPublicKeyHex()
      if (!pubkey || !mountedRef.current) return

      const copy = { ...data }
      await decryptObjectFields(copy, pubkey, label)
      if (mountedRef.current) setDecrypted(copy)
    })()
  }, [data, label])

  // Re-decrypt on key unlock
  useEffect(() => {
    const unsubscribe = keyManager.onUnlock(() => {
      if (!data) return
      void (async () => {
        const pubkey = await keyManager.getPublicKeyHex()
        if (!pubkey || !mountedRef.current) return

        const copy = { ...data }
        await decryptObjectFields(copy, pubkey, label)
        if (mountedRef.current) setDecrypted(copy)
      })()
    })
    return unsubscribe
  }, [data, label])

  // Clear cache on lock
  useEffect(() => {
    return keyManager.onLock(() => {
      decryptCache.clear()
      if (data && mountedRef.current) setDecrypted(data)
    })
  }, [data])

  return decrypted
}

/**
 * Decrypt encrypted fields on an array of objects.
 * Same pattern: immediate render with raw data, re-render with decrypted.
 */
export function useDecryptedArray<T extends Record<string, unknown>>(
  data: T[],
  label: string = LABEL_VOLUNTEER_PII
): T[] {
  const [decrypted, setDecrypted] = useState<T[]>(data)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    setDecrypted(data)

    void (async () => {
      const isUnlocked = await keyManager.isUnlocked()
      if (!isUnlocked || !mountedRef.current) return

      const pubkey = await keyManager.getPublicKeyHex()
      if (!pubkey || !mountedRef.current) return

      const copy = data.map((item) => ({ ...item }))
      await decryptArrayFields(copy, pubkey, label)
      if (mountedRef.current) setDecrypted(copy)
    })()
  }, [data, label])

  useEffect(() => {
    const unsubscribe = keyManager.onUnlock(() => {
      void (async () => {
        const pubkey = await keyManager.getPublicKeyHex()
        if (!pubkey || !mountedRef.current) return

        const copy = data.map((item) => ({ ...item }))
        await decryptArrayFields(copy, pubkey, label)
        if (mountedRef.current) setDecrypted(copy)
      })()
    })
    return unsubscribe
  }, [data, label])

  useEffect(() => {
    return keyManager.onLock(() => {
      decryptCache.clear()
      if (mountedRef.current) setDecrypted(data)
    })
  }, [data])

  return decrypted
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/use-decrypted.ts
git commit -m "feat: add useDecryptedObject and useDecryptedArray hooks"
```

---

### Task 4: Remove nsec from main thread

Remove the sync cached secret key from key-manager.ts. The `getSecretKey`, `isUnlockedSync`, `getPublicKeyHexSync` exports and `_cachedSecretKey` state are no longer needed — all decryption goes through the worker.

**Files:**
- Modify: `src/client/lib/key-manager.ts`
- Modify: `src/client/lib/envelope-field-crypto.ts`

- [ ] **Step 1: Remove sync cache from key-manager.ts**

Delete the following from `src/client/lib/key-manager.ts`:
- `let _cachedSecretKey: Uint8Array | null = null` and all `_cachedSecretKey` assignments
- `let _cachedUnlocked = false` and all `_cachedUnlocked` assignments
- `let _cachedPubkey: string | null = null` and all `_cachedPubkey` assignments
- `export function isUnlockedSync()`
- `export function getPublicKeyHexSync()`
- `export function getSecretKey()`
- Remove the `getSecretKey` worker request from `crypto-worker.ts` and `crypto-worker-client.ts` (added by merge agent)

- [ ] **Step 2: Update envelope-field-crypto.ts**

Replace `tryDecryptField` with a deprecation notice pointing to `useDecryptedObject`/`useDecryptedArray`. Keep `decryptEnvelopeField` for test-only usage (it takes explicit key bytes):

```typescript
/**
 * @deprecated Use useDecryptedObject/useDecryptedArray hooks instead.
 * This sync function required the nsec on the main thread.
 * Kept only for backward compatibility during migration.
 */
export function tryDecryptField(
  encrypted: string | null | undefined,
  envelopes: RecipientEnvelope[] | null | undefined,
  fallback: string,
  _label: string = LABEL_VOLUNTEER_PII
): string {
  // During migration: return fallback (encrypted placeholder).
  // Components using hooks will get decrypted values.
  return fallback
}
```

- [ ] **Step 3: Verify typecheck and build pass**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/key-manager.ts src/client/lib/envelope-field-crypto.ts \
  src/client/lib/crypto-worker.ts src/client/lib/crypto-worker-client.ts
git commit -m "refactor: remove nsec from main thread, deprecate tryDecryptField"
```

---

### Task 5: Migrate components — volunteer name pattern (8 files)

The most common pattern: `tryDecryptField(vol.encryptedName, vol.nameEnvelopes, vol.name)`. Replace with `useDecryptedArray` on the volunteer list.

**Files to modify (all use the same nameMap pattern):**
- `src/client/routes/calls.tsx` (nameMap + callerLast4)
- `src/client/routes/calls.$callId.tsx` (nameMap + callerLast4)
- `src/client/routes/notes.tsx` (nameMap + callerLast4)
- `src/client/routes/audit.tsx` (nameMap)
- `src/client/routes/index.tsx` (volunteer lookup)
- `src/client/routes/volunteers.tsx` (volunteer list + invites)
- `src/client/routes/volunteers_.$pubkey.tsx` (single volunteer)
- `src/client/components/volunteer-multi-select.tsx` (dropdown)
- `src/client/components/ReassignDialog.tsx` (modal)
- `src/client/components/setup/StepInvite.tsx` (invite name)

- [ ] **Step 1: Update each file**

For files that have a `volunteers` state array and build a `nameMap`:

**Before:**
```typescript
const nameMap = useMemo(() => {
  const map = new Map<string, string>()
  for (const v of volunteers)
    map.set(v.pubkey, tryDecryptField(v.encryptedName, v.nameEnvelopes, v.name))
  return map
}, [volunteers])
```

**After:**
```typescript
import { useDecryptedArray } from '@/lib/use-decrypted'

// At top of component, after useState:
const decryptedVolunteers = useDecryptedArray(volunteers)

const nameMap = useMemo(() => {
  const map = new Map<string, string>()
  for (const v of decryptedVolunteers) map.set(v.pubkey, v.name)
  return map
}, [decryptedVolunteers])
```

For inline usages like `tryDecryptField(vol.encryptedName, vol.nameEnvelopes, vol.name)`:

**Before:**
```typescript
<span>{tryDecryptField(vol.encryptedName, vol.nameEnvelopes, vol.name)}</span>
```

**After:**
```typescript
<span>{vol.name}</span>
```

(The `vol` is already from `decryptedVolunteers` which has decrypted `name`.)

Apply this pattern to each file. Remove the `tryDecryptField` import from each file.

For `callerLast4` fields in calls.tsx, calls.$callId.tsx, notes.tsx — use `useDecryptedArray` on the calls array too:
```typescript
const decryptedCalls = useDecryptedArray(calls)
```

- [ ] **Step 2: Verify typecheck + build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add src/client/routes/ src/client/components/
git commit -m "refactor: migrate 10 components from tryDecryptField to useDecryptedArray"
```

---

### Task 6: Migrate remaining components (bans, conversations, settings, auth)

**Files:**
- `src/client/routes/bans.tsx` (phone + reason)
- `src/client/routes/conversations.tsx` (contactLast4)
- `src/client/routes/settings.tsx` (WebAuthn labels)
- `src/client/components/ConversationList.tsx` (contactLast4)
- `src/client/lib/auth.tsx` (user display name)

- [ ] **Step 1: Update bans.tsx**

```typescript
import { useDecryptedArray } from '@/lib/use-decrypted'

// In component:
const decryptedBans = useDecryptedArray(bans)

// In BanRow — use decrypted props directly:
const displayPhone = ban.phone
const displayReason = ban.reason
```

- [ ] **Step 2: Update conversations and ConversationList**

Same pattern: `useDecryptedArray(conversations)`, then use `conv.contactLast4` directly.

- [ ] **Step 3: Update settings.tsx (WebAuthn labels)**

```typescript
const decryptedCreds = useDecryptedArray(webauthnCreds)
// In JSX: use cred.label directly
```

- [ ] **Step 4: Update auth.tsx (user display name)**

The auth provider's `unlockWithPin` and `refreshProfile` callbacks call `tryDecryptField` after `getMe()`. Replace with async decryption:

```typescript
const me = await getMe()
const pubkey = await keyManager.getPublicKeyHex()
if (pubkey) {
  await decryptObjectFields(me, pubkey)
}
setState(stateFromMe(me, { isKeyUnlocked: true, publicKey: pubkey }))
```

Import `decryptObjectFields` from `./decrypt-fields`.

- [ ] **Step 5: Verify typecheck + build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 6: Commit**

```bash
git add src/client/
git commit -m "refactor: migrate bans, conversations, settings, auth to decrypt-on-fetch"
```

---

### Task 7: Clean up — remove tryDecryptField entirely

Now that no component calls `tryDecryptField`, remove the deprecated function and any remaining sync key accessors.

**Files:**
- Modify: `src/client/lib/envelope-field-crypto.ts`
- Verify: no remaining imports of `tryDecryptField` anywhere

- [ ] **Step 1: Remove tryDecryptField from envelope-field-crypto.ts**

Keep only `decryptEnvelopeField` (used by `decryptBlastContentWithKey` and test helpers that take explicit key bytes).

- [ ] **Step 2: Verify no remaining imports**

```bash
grep -rn "tryDecryptField" src/client/ --include="*.ts" --include="*.tsx"
```

Expected: zero matches (or only the test helper).

- [ ] **Step 3: Verify all tests pass**

```bash
bun run typecheck && bun run build && bun run test:unit
```

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/envelope-field-crypto.ts
git commit -m "refactor: remove tryDecryptField — all decryption now worker-based"
```

---

### Task 8: Run full test suites

- [ ] **Step 1: Unit tests**

```bash
bun run test:unit
```

Expected: 240+ pass, 0 fail

- [ ] **Step 2: Integration tests**

```bash
bun run test:integration
```

Expected: 41 pass, 0 fail

- [ ] **Step 3: API tests**

```bash
JWT_SECRET=0000...03 PLAYWRIGHT_BASE_URL=http://localhost:3002 bun run test:api
```

Expected: 285 pass, 0 fail

- [ ] **Step 4: UI E2E tests (focused)**

Run a subset that exercises decrypted fields:

```bash
JWT_SECRET=0000...03 PLAYWRIGHT_BASE_URL=http://localhost:3002 \
  bunx playwright test --project=setup --project=ui \
  tests/ui/admin-flow.spec.ts tests/ui/volunteer-flow.spec.ts \
  tests/ui/roles.spec.ts tests/ui/theme.spec.ts
```

- [ ] **Step 5: Full E2E suite**

```bash
JWT_SECRET=0000...03 PLAYWRIGHT_BASE_URL=http://localhost:3002 \
  bunx playwright test --project=setup --project=ui
```

- [ ] **Step 6: Final commit + push**

```bash
git push
```
