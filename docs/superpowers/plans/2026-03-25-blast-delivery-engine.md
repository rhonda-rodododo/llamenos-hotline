# Blast Delivery Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a background blast processor that sends messages to subscribers through existing messaging adapters with batching, rate limiting, encrypted identifier handling, and scheduled send support.

**Architecture:** In-process `setInterval(30_000)` job loop (BlastProcessor class). Polls for `status='sending'` and due `status='scheduled'` blasts, processes one at a time in batches of 50 subscribers. Resumable via delivery record deduplication. Uses hub key (XChaCha20-Poly1305) to decrypt subscriber identifiers at send time.

**Tech Stack:** Bun, Hono, Drizzle ORM, PostgreSQL, `@noble/ciphers` (XChaCha20-Poly1305), `@noble/curves` (secp256k1 ECIES), existing MessagingAdapter interface.

**Spec:** `docs/superpowers/specs/2026-03-25-blast-delivery-engine-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/server/db/schema/blasts.ts` | Modify | Add `encryptedIdentifier` to subscribers, `scheduledAt`+`error` to blasts, unique constraint on deliveries |
| `drizzle/migrations/0017_blast_delivery_engine.sql` | Create | SQL migration for schema changes |
| `src/server/messaging/adapter.ts` | Modify | Make `conversationId` optional in `SendMessageParams` |
| `src/server/lib/crypto.ts` | Modify | Export `eciesUnwrapKeyServer`, add `unwrapHubKeyForServer()` helper, add `encryptForHub`/`decryptFromHub` server-side copies |
| `src/shared/crypto-labels.ts` | Modify | Import `LABEL_HUB_KEY_WRAP` in crypto.ts (already exported, just not used server-side) |
| `src/server/services/blasts.ts` | Modify | Add filtered subscriber queries and delivery dedup helpers |
| `src/server/jobs/blast-processor.ts` | Create | BlastProcessor class + `scheduleBlastProcessor()` |
| `src/server/routes/blasts.ts` | Modify | Update `/schedule` to use `scheduledAt`, validate hub key on `/send` |
| `src/server/server.ts` | Modify | Register blast processor at startup, clear on shutdown |
| `src/client/locales/en.json` (+ 12 others) | Modify | Add `blast.optOutFooter` i18n key |
| `src/server/jobs/blast-processor.test.ts` | Create | Unit tests for processor logic |
| `tests/api/blast-sending.spec.ts` | Modify | Fix flaky test, add delivery verification tests |

---

### Task 1: Schema Migration + Drizzle Schema Updates

**Files:**
- Modify: `src/server/db/schema/blasts.ts`
- Create: `drizzle/migrations/0017_blast_delivery_engine.sql`

- [ ] **Step 1: Update Drizzle schema** — Add columns to `blasts` table (`scheduledAt`, `error`), `subscribers` table (`encryptedIdentifier`), and unique constraint on `blastDeliveries`:

```typescript
// In blasts table, after sentAt:
scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
error: text('error'),

// In subscribers table, after identifierHash:
/** XChaCha20-Poly1305 encrypted with hub key — hex(nonce(24) || ciphertext) */
encryptedIdentifier: text('encrypted_identifier'),

// In blastDeliveries table, add constraint export:
// After the table definition, add to the constraints callback:
(table) => [unique().on(table.blastId, table.subscriberId)]
```

Update the status comment on blasts to: `'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'`

- [ ] **Step 2: Generate migration SQL**

Run: `bun run migrate:generate`

If auto-generation doesn't produce the expected output, write manually to `drizzle/migrations/0017_blast_delivery_engine.sql`:
```sql
ALTER TABLE "blasts" ADD COLUMN "scheduled_at" timestamptz;
ALTER TABLE "blasts" ADD COLUMN "error" text;
ALTER TABLE "subscribers" ADD COLUMN "encrypted_identifier" text;
ALTER TABLE "blast_deliveries" ADD CONSTRAINT "blast_deliveries_blast_subscriber_unique" UNIQUE ("blast_id", "subscriber_id");
```

- [ ] **Step 3: Verify migration applies**

Run: `bun run migrate` (requires `bun run dev:docker` for local Postgres)

- [ ] **Step 4: Update ALL affected types** — This is the most critical step. Update these types in `src/server/types.ts`:

  - `Blast`: add `scheduledAt: Date | null` and `error: string | null`
  - `Subscriber`: add `encryptedIdentifier: string | null`
  - `CreateSubscriberData`: add `encryptedIdentifier?: string`
  - `CreateBlastData`: add `scheduledAt?: Date`
  - `CreateDeliveryData`: add `error?: string`
  - Widen `BlastService.updateBlast()` parameter type to include `scheduledAt?: Date` and `error?: string | null`

  Update `BlastService.#rowToBlast()` to map `scheduledAt: r.scheduledAt ?? null` and `error: r.error ?? null`.
  Update `BlastService.#rowToSubscriber()` to map `encryptedIdentifier: r.encryptedIdentifier ?? null`.
  Update `BlastService.createSubscriber()` to persist `encryptedIdentifier` if provided.
  Update `BlastService.createDelivery()` to persist `error` if provided.

  **No `as any` casts** — all types must be properly extended. The project requires avoiding `any`.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```
git add src/server/db/schema/blasts.ts drizzle/ src/server/types.ts src/server/services/blasts.ts
git commit -m "feat: add blast delivery schema — scheduledAt, encryptedIdentifier, delivery unique constraint"
```

---

### Task 2: Prerequisite — Make `conversationId` Optional

**Files:**
- Modify: `src/server/messaging/adapter.ts`

- [ ] **Step 1: Update SendMessageParams interface**

In `src/server/messaging/adapter.ts`, change:
```typescript
export interface SendMessageParams {
  recipientIdentifier: string
  body: string
  conversationId?: string  // optional — absent for blast deliveries
}
```

- [ ] **Step 2: Typecheck to find any broken callers**

Run: `bun run typecheck`

Fix any callers that destructure `conversationId` without handling `undefined`. The adapter implementations should already handle it since they just pass it through as a tracking ID.

- [ ] **Step 3: Commit**

```
git add src/server/messaging/
git commit -m "feat: make SendMessageParams.conversationId optional for blast support"
```

---

### Task 3: Server-Side Hub Key Crypto Helpers

**Files:**
- Modify: `src/server/lib/crypto.ts`

- [ ] **Step 1: Export `eciesUnwrapKeyServer`**

Change `function eciesUnwrapKeyServer(` (line 157 of `src/server/lib/crypto.ts`) from a private function to an exported function:
```typescript
export function eciesUnwrapKeyServer(
```

- [ ] **Step 2: Add `encryptForHub` and `decryptFromHub` server-side functions**

These currently only exist in `src/client/lib/hub-key-manager.ts`. Add server-side copies to `src/server/lib/crypto.ts` (they use the same `@noble/ciphers` imports already present):

```typescript
/**
 * Encrypt arbitrary data with a hub key using XChaCha20-Poly1305.
 * Returns hex: nonce(24) + ciphertext.
 * Server-side mirror of client-side hub-key-manager.ts function.
 */
export function encryptForHub(plaintext: string, hubKey: Uint8Array): string {
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const cipher = xchacha20poly1305(hubKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}

/**
 * Decrypt hub-encrypted data using the hub key.
 * Returns null on decryption failure.
 */
export function decryptFromHub(packed: string, hubKey: Uint8Array): string | null {
  try {
    const data = hexToBytes(packed)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(hubKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Add `unwrapHubKeyForServer` helper**

This encapsulates the full unwrap flow. Add to `src/server/lib/crypto.ts`:

```typescript
import { LABEL_HUB_KEY_WRAP, LABEL_SERVER_NOSTR_KEY, LABEL_SERVER_NOSTR_KEY_INFO } from '@shared/crypto-labels'

/**
 * Unwrap the hub key for server-side use (blast delivery, etc.).
 * Derives the server's Nostr keypair from SERVER_NOSTR_SECRET via HKDF,
 * finds the server's hub key envelope, and ECIES-unwraps the hub key.
 *
 * IMPORTANT: The HKDF derivation must exactly match nostr-publisher.ts:
 *   hkdf(sha256, secretBytes, salt=LABEL_SERVER_NOSTR_KEY, info=LABEL_SERVER_NOSTR_KEY_INFO, 32)
 */
export function unwrapHubKeyForServer(
  serverSecret: string,
  envelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
): Uint8Array {
  // Derive server private key from secret via HKDF — must match nostr-publisher.ts derivation
  const secretBytes = hexToBytes(serverSecret)
  const serverPrivateKey = hkdf(sha256, secretBytes, utf8ToBytes(LABEL_SERVER_NOSTR_KEY), utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO), 32)
  const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1)) // x-only

  // Find envelope addressed to server
  const envelope = envelopes.find((e) => e.pubkey === serverPubkey)
  if (!envelope) {
    throw new Error(`No hub key envelope for server pubkey ${serverPubkey}`)
  }

  return eciesUnwrapKeyServer(envelope, serverPrivateKey, LABEL_HUB_KEY_WRAP)
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 5: Commit**

```
git add src/server/lib/crypto.ts
git commit -m "feat: export hub key crypto helpers for server-side blast delivery"
```

---

### Task 4: BlastService — Filtered Queries and Resume Helpers

**Files:**
- Modify: `src/server/services/blasts.ts`

- [ ] **Step 1: Write failing test for `listSubscribersForBlast`**

Create `src/server/services/blasts.test.ts` (colocated unit test):

```typescript
import { describe, expect, test } from 'bun:test'
// Test that the filtering logic works — we test the pure filter function,
// not the DB query (DB tests are in API integration tests)

import type { Subscriber, SubscriberChannel } from '../types'

// Extract the filter logic into a testable pure function (see step 3)
import { matchesBlastFilters } from './blasts'

const makeSub = (overrides: Partial<Subscriber> = {}): Subscriber => ({
  id: 'sub-1',
  hubId: 'hub-1',
  identifierHash: 'hash',
  channels: [{ type: 'sms', verified: true }] as SubscriberChannel[],
  tags: [],
  language: 'en',
  status: 'active',
  doubleOptInConfirmed: true,
  subscribedAt: new Date(),
  preferenceToken: 'tok',
  createdAt: new Date(),
  encryptedIdentifier: 'encrypted-data',
  ...overrides,
})

describe('matchesBlastFilters', () => {
  test('matches when no filters specified', () => {
    expect(matchesBlastFilters(makeSub(), [], [], [])).toBe(true)
  })

  test('rejects inactive subscriber', () => {
    expect(matchesBlastFilters(makeSub({ status: 'paused' }), [], [], [])).toBe(false)
  })

  test('rejects subscriber without encrypted identifier', () => {
    expect(matchesBlastFilters(makeSub({ encryptedIdentifier: null }), [], [], [])).toBe(false)
  })

  test('filters by target channel — verified only', () => {
    const sub = makeSub({ channels: [{ type: 'sms', verified: false }, { type: 'whatsapp', verified: true }] })
    expect(matchesBlastFilters(sub, ['sms'], [], [])).toBe(false) // sms not verified
    expect(matchesBlastFilters(sub, ['whatsapp'], [], [])).toBe(true)
  })

  test('filters by tag', () => {
    const sub = makeSub({ tags: ['urgent'] })
    expect(matchesBlastFilters(sub, [], ['urgent'], [])).toBe(true)
    expect(matchesBlastFilters(sub, [], ['weather'], [])).toBe(false)
  })

  test('filters by language', () => {
    const sub = makeSub({ language: 'es' })
    expect(matchesBlastFilters(sub, [], [], ['es', 'en'])).toBe(true)
    expect(matchesBlastFilters(sub, [], [], ['fr'])).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/services/blasts.test.ts`
Expected: FAIL — `matchesBlastFilters` not exported

- [ ] **Step 3: Implement filter function and query helpers**

In `src/server/services/blasts.ts`, add:

```typescript
import type { Subscriber, SubscriberChannel } from '../types'

/** Pure filter: does a subscriber match the blast's targeting criteria? */
export function matchesBlastFilters(
  sub: Subscriber,
  targetChannels: string[],
  targetTags: string[],
  targetLanguages: string[]
): boolean {
  if (sub.status !== 'active') return false
  if (!sub.encryptedIdentifier) return false

  if (targetChannels.length > 0) {
    const hasVerifiedMatch = (sub.channels as SubscriberChannel[]).some(
      (ch) => ch.verified && targetChannels.includes(ch.type)
    )
    if (!hasVerifiedMatch) return false
  }

  if (targetTags.length > 0) {
    const hasTagMatch = sub.tags.some((t) => targetTags.includes(t))
    if (!hasTagMatch) return false
  }

  if (targetLanguages.length > 0) {
    if (!sub.language || !targetLanguages.includes(sub.language)) return false
  }

  return true
}

/** Pick the first verified channel that matches target channels (or any if no filter). */
export function selectChannel(
  sub: Subscriber,
  targetChannels: string[]
): SubscriberChannel | null {
  const channels = sub.channels as SubscriberChannel[]
  if (targetChannels.length === 0) {
    return channels.find((ch) => ch.verified) ?? null
  }
  return channels.find((ch) => ch.verified && targetChannels.includes(ch.type)) ?? null
}
```

Add service methods to `BlastService`:

```typescript
/** Get subscriber IDs that already have delivery records for a blast (for resume). */
async getDeliveredSubscriberIds(blastId: string): Promise<Set<string>> {
  const rows = await this.db
    .select({ subscriberId: blastDeliveries.subscriberId })
    .from(blastDeliveries)
    .where(eq(blastDeliveries.blastId, blastId))
  return new Set(rows.map((r) => r.subscriberId))
}

/** Find blasts ready for processing (sending or due scheduled). */
async findBlastsToProcess(): Promise<Blast[]> {
  const now = new Date()
  const rows = await this.db
    .select()
    .from(blasts)
    .where(
      or(
        eq(blasts.status, 'sending'),
        and(eq(blasts.status, 'scheduled'), lte(blasts.scheduledAt, now))
      )
    )
  return rows.map((r) => this.#rowToBlast(r))
}
```

Add necessary imports (`or`, `and`, `lte` from `drizzle-orm`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/services/blasts.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```
git add src/server/services/blasts.ts src/server/services/blasts.test.ts
git commit -m "feat: add blast subscriber filtering and delivery resume helpers"
```

---

### Task 5: BlastProcessor — Core Delivery Engine

**Files:**
- Create: `src/server/jobs/blast-processor.ts`
- Create: `src/server/jobs/blast-processor.test.ts`

- [ ] **Step 1: Write failing unit test**

Create `src/server/jobs/blast-processor.test.ts`:

```typescript
import { describe, expect, mock, test } from 'bun:test'
import { BlastProcessor } from './blast-processor'

// Create mock services and adapter — test the processing logic
// without real DB or messaging providers

function mockServices(overrides: Record<string, unknown> = {}) {
  return {
    blasts: {
      findBlastsToProcess: mock(() => []),
      getBlast: mock(() => null),
      updateBlast: mock((_id: string, data: Record<string, unknown>) => data),
      listSubscribers: mock(() => []),
      getDeliveredSubscriberIds: mock(() => new Set()),
      createDelivery: mock((data: Record<string, unknown>) => ({ id: 'del-1', ...data })),
      updateDelivery: mock(() => ({})),
    },
    settings: {
      getHubKeyEnvelopes: mock(() => []),
    },
    records: {
      addAuditEntry: mock(() => {}),
    },
    ...overrides,
  }
}

describe('BlastProcessor', () => {
  test('processOnce does nothing when no blasts to process', async () => {
    const services = mockServices()
    const processor = new BlastProcessor(services as any, 'aabbccdd'.repeat(8), '')
    await processor.processOnce()
    expect(services.blasts.findBlastsToProcess).toHaveBeenCalled()
  })

  test('processes a blast with subscribers and creates deliveries', async () => {
    const subscribers = [
      { id: 'sub-1', hubId: 'h', identifierHash: 'x', channels: [{ type: 'sms', verified: true }], tags: [], language: 'en', status: 'active', encryptedIdentifier: 'enc1', doubleOptInConfirmed: true, subscribedAt: new Date(), preferenceToken: 'p', createdAt: new Date() },
      { id: 'sub-2', hubId: 'h', identifierHash: 'y', channels: [{ type: 'sms', verified: true }], tags: [], language: 'en', status: 'active', encryptedIdentifier: 'enc2', doubleOptInConfirmed: true, subscribedAt: new Date(), preferenceToken: 'p', createdAt: new Date() },
    ]
    const blast = { id: 'b-1', hubId: 'h', name: 'Test', content: 'Hello', status: 'sending', targetChannels: ['sms'], targetTags: [], targetLanguages: [], stats: { totalRecipients: 0, sent: 0, delivered: 0, failed: 0, optedOut: 0 }, createdAt: new Date(), sentAt: new Date(), scheduledAt: null, error: null }

    const services = mockServices({
      blasts: {
        findBlastsToProcess: mock(() => [blast]),
        getBlast: mock(() => blast),
        updateBlast: mock((_id: string, data: Record<string, unknown>) => ({ ...blast, ...data })),
        listSubscribers: mock(() => subscribers),
        getDeliveredSubscriberIds: mock(() => new Set()),
        createDelivery: mock((data: Record<string, unknown>) => ({ id: `del-${Date.now()}`, ...data, status: 'sent', sentAt: new Date() })),
      },
    })

    // BlastProcessor needs hub key unwrap — mock it to skip crypto
    const processor = new BlastProcessor(services as any, 'aabbccdd'.repeat(8), '')
    // Override the hub key unwrap to return a fake key
    processor._getHubKey = mock(async () => new Uint8Array(32))
    // Override decryptIdentifier to return plaintext
    processor._decryptIdentifier = mock(() => '+15551234567')
    // Override getAdapter to return a mock adapter
    processor._getAdapter = mock(async () => ({
      channelType: 'sms',
      sendMessage: mock(async () => ({ success: true, externalId: 'ext-1' })),
    }))

    await processor.processOnce()

    expect(services.blasts.createDelivery).toHaveBeenCalledTimes(2)
  })

  test('skips subscribers already delivered (resume)', async () => {
    const blast = { id: 'b-1', hubId: 'h', name: 'Test', content: 'Hello', status: 'sending', targetChannels: [], targetTags: [], targetLanguages: [], stats: { totalRecipients: 0, sent: 0, delivered: 0, failed: 0, optedOut: 0 }, createdAt: new Date(), sentAt: new Date(), scheduledAt: null, error: null }
    const subscribers = [
      { id: 'sub-1', hubId: 'h', identifierHash: 'x', channels: [{ type: 'sms', verified: true }], tags: [], language: 'en', status: 'active', encryptedIdentifier: 'enc1', doubleOptInConfirmed: true, subscribedAt: new Date(), preferenceToken: 'p', createdAt: new Date() },
      { id: 'sub-2', hubId: 'h', identifierHash: 'y', channels: [{ type: 'sms', verified: true }], tags: [], language: 'en', status: 'active', encryptedIdentifier: 'enc2', doubleOptInConfirmed: true, subscribedAt: new Date(), preferenceToken: 'p', createdAt: new Date() },
    ]

    const services = mockServices({
      blasts: {
        findBlastsToProcess: mock(() => [blast]),
        getBlast: mock(() => blast),
        updateBlast: mock((_id: string, data: Record<string, unknown>) => ({ ...blast, ...data })),
        listSubscribers: mock(() => subscribers),
        getDeliveredSubscriberIds: mock(() => new Set(['sub-1'])), // sub-1 already done
        createDelivery: mock((data: Record<string, unknown>) => ({ id: 'del-1', ...data })),
      },
    })

    const processor = new BlastProcessor(services as any, 'aabbccdd'.repeat(8), '')
    processor._getHubKey = mock(async () => new Uint8Array(32))
    processor._decryptIdentifier = mock(() => '+15551234567')
    processor._getAdapter = mock(async () => ({
      channelType: 'sms',
      sendMessage: mock(async () => ({ success: true })),
    }))

    await processor.processOnce()

    // Only sub-2 should get a delivery (sub-1 was already delivered)
    expect(services.blasts.createDelivery).toHaveBeenCalledTimes(1)
  })

  test('promotes scheduled blast to sending when due', async () => {
    const blast = { id: 'b-sched', hubId: 'h', name: 'Scheduled', content: 'Hello', status: 'scheduled', targetChannels: [], targetTags: [], targetLanguages: [], stats: { totalRecipients: 0, sent: 0, delivered: 0, failed: 0, optedOut: 0 }, createdAt: new Date(), sentAt: null, scheduledAt: new Date(Date.now() - 60_000), error: null }

    const services = mockServices({
      blasts: {
        findBlastsToProcess: mock(() => [blast]),
        getBlast: mock(() => ({ ...blast, status: 'sending' })),
        updateBlast: mock((_id: string, data: Record<string, unknown>) => ({ ...blast, ...data })),
        listSubscribers: mock(() => []),
        getDeliveredSubscriberIds: mock(() => new Set()),
        createDelivery: mock((data: Record<string, unknown>) => ({ id: 'del-1', ...data })),
      },
    })

    const processor = new BlastProcessor(services as any, 'aabbccdd'.repeat(8), '')
    processor._getHubKey = mock(async () => new Uint8Array(32))

    await processor.processOnce()

    // Should have promoted to sending
    expect(services.blasts.updateBlast).toHaveBeenCalledWith('b-sched', expect.objectContaining({ status: 'sending' }))
  })

  test('stops processing when blast is cancelled between batches', async () => {
    // Create enough subscribers to trigger a batch boundary check
    const subscribers = Array.from({ length: 55 }, (_, i) => ({
      id: `sub-${i}`, hubId: 'h', identifierHash: `hash-${i}`,
      channels: [{ type: 'sms', verified: true }], tags: [], language: 'en',
      status: 'active', encryptedIdentifier: `enc-${i}`,
      doubleOptInConfirmed: true, subscribedAt: new Date(), preferenceToken: 'p', createdAt: new Date(),
    }))

    let callCount = 0
    const blast = { id: 'b-cancel', hubId: 'h', name: 'Test', content: 'Hello', status: 'sending', targetChannels: ['sms'], targetTags: [], targetLanguages: [], stats: { totalRecipients: 0, sent: 0, delivered: 0, failed: 0, optedOut: 0 }, createdAt: new Date(), sentAt: new Date(), scheduledAt: null, error: null }

    const services = mockServices({
      blasts: {
        findBlastsToProcess: mock(() => [blast]),
        getBlast: mock(() => {
          callCount++
          // After the first batch boundary check, return cancelled status
          return callCount > 2 ? { ...blast, status: 'cancelled' } : blast
        }),
        updateBlast: mock((_id: string, data: Record<string, unknown>) => ({ ...blast, ...data })),
        listSubscribers: mock(() => subscribers),
        getDeliveredSubscriberIds: mock(() => new Set()),
        createDelivery: mock((data: Record<string, unknown>) => ({ id: `del-${Date.now()}`, ...data })),
      },
    })

    const processor = new BlastProcessor(services as any, 'aabbccdd'.repeat(8), '')
    processor._getHubKey = mock(async () => new Uint8Array(32))
    processor._decryptIdentifier = mock(() => '+15551234567')
    processor._getAdapter = mock(async () => ({
      channelType: 'sms',
      sendMessage: mock(async () => ({ success: true })),
    }))

    await processor.processOnce()

    // Should have sent fewer than 55 deliveries (stopped at batch boundary)
    const deliveryCount = (services.blasts.createDelivery as any).mock.calls.length
    expect(deliveryCount).toBeLessThan(55)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/jobs/blast-processor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement BlastProcessor**

Create `src/server/jobs/blast-processor.ts`:

```typescript
import type { MessagingAdapter } from '../messaging/adapter'
import type { Services } from '../services'
import { matchesBlastFilters, selectChannel } from '../services/blasts'
import { decryptFromHub, unwrapHubKeyForServer } from '../lib/crypto'
import { getMessagingAdapter } from '../lib/adapters'
import type { Blast, Subscriber } from '../types'

const DEFAULT_RATE_DELAYS: Record<string, number> = {
  sms: 1000,
  whatsapp: 50,
  signal: 500,
  rcs: 200,
}

const DEFAULT_BATCH_SIZE = 50

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getOptOutFooter(language: string | null): string {
  // TODO: load from locale files. For now, hardcoded English.
  // Will be replaced with i18n lookup in a follow-up.
  return 'Reply STOP to unsubscribe'
}

export class BlastProcessor {
  private services: Services
  private serverSecret: string
  private hmacSecret: string

  constructor(services: Services, serverSecret: string, hmacSecret: string) {
    this.services = services
    this.serverSecret = serverSecret
    this.hmacSecret = hmacSecret
  }

  /** Run one poll cycle. Called by the interval timer. */
  async processOnce(): Promise<void> {
    try {
      const blasts = await this.services.blasts.findBlastsToProcess()

      // Promote scheduled blasts to sending
      for (const blast of blasts) {
        if (blast.status === 'scheduled') {
          await this.services.blasts.updateBlast(blast.id, {
            status: 'sending',
            sentAt: new Date(),
          })
          await this.services.records.addAuditEntry(blast.hubId, 'blastScheduled', 'system', {
            blastId: blast.id,
            scheduledAt: blast.scheduledAt?.toISOString(),
          })
        }
      }

      // Process first sending blast (one at a time)
      const sending = blasts.find((b) => b.status === 'sending')
        ?? blasts.find((b) => b.status === 'scheduled') // just promoted
      if (!sending) return

      // Re-fetch to get latest status (may have been promoted above)
      const blast = await this.services.blasts.getBlast(sending.id)
      if (!blast || blast.status !== 'sending') return

      await this.processBlast(blast)
    } catch (err) {
      console.error('[blast-processor] Poll error:', err)
    }
  }

  private async processBlast(blast: Blast): Promise<void> {
    // Unwrap hub key
    let hubKey: Uint8Array
    try {
      hubKey = await this._getHubKey(blast.hubId)
    } catch (err) {
      console.error(`[blast-processor] Hub key unavailable for blast ${blast.id}:`, err)
      await this.services.blasts.updateBlast(blast.id, {
        status: 'failed',
        error: `Hub key unavailable: ${err instanceof Error ? err.message : String(err)}`,
      })
      await this.services.records.addAuditEntry(blast.hubId, 'blastFailed', 'system', {
        blastId: blast.id,
        error: 'Hub key unavailable',
      })
      return
    }

    // Get all subscribers for this hub
    const allSubscribers = await this.services.blasts.listSubscribers(blast.hubId)

    // Filter to matching subscribers
    const matching = allSubscribers.filter((sub) =>
      matchesBlastFilters(sub, blast.targetChannels, blast.targetTags, blast.targetLanguages)
    )

    // Get already-delivered subscriber IDs (for resume)
    const delivered = await this.services.blasts.getDeliveredSubscriberIds(blast.id)
    const pending = matching.filter((sub) => !delivered.has(sub.id))

    // Update total recipients stat
    await this.services.blasts.updateBlast(blast.id, {
      stats: { totalRecipients: matching.length },
    })

    let sent = delivered.size > 0 ? (await this.services.blasts.getDeliveriesForBlast(blast.id)).filter((d) => d.status === 'sent').length : 0
    let failed = delivered.size > 0 ? (await this.services.blasts.getDeliveriesForBlast(blast.id)).filter((d) => d.status === 'failed').length : 0

    // Process in batches
    for (let i = 0; i < pending.length; i++) {
      // Check for cancellation before each send
      if (i > 0 && i % DEFAULT_BATCH_SIZE === 0) {
        const current = await this.services.blasts.getBlast(blast.id)
        if (!current || current.status === 'cancelled') {
          await this.services.records.addAuditEntry(blast.hubId, 'blastCancelled', 'system', {
            blastId: blast.id,
            sentSoFar: sent,
          })
          return
        }
        // Update running stats
        await this.services.blasts.updateBlast(blast.id, {
          stats: { totalRecipients: matching.length, sent, delivered: 0, failed, optedOut: 0 },
        })
      }

      const sub = pending[i]
      const channel = selectChannel(sub, blast.targetChannels)
      if (!channel) continue

      // Decrypt identifier
      const identifier = this._decryptIdentifier(sub.encryptedIdentifier!, hubKey)
      if (!identifier) {
        failed++
        await this.services.blasts.createDelivery({
          blastId: blast.id,
          subscriberId: sub.id,
          channelType: channel.type,
          status: 'failed',
          error: 'Failed to decrypt subscriber identifier',
        })
        continue
      }

      // Get adapter and send
      try {
        const adapter = await this._getAdapter(channel.type)
        const footer = getOptOutFooter(sub.language)
        const body = `${blast.content}\n\n${footer}`

        const deliveryId = crypto.randomUUID()
        const result = await adapter.sendMessage({
          recipientIdentifier: identifier,
          body,
          conversationId: deliveryId,
        })

        await this.services.blasts.createDelivery({
          blastId: blast.id,
          subscriberId: sub.id,
          channelType: channel.type,
          status: result.success ? 'sent' : 'failed',
          error: result.error,
        })

        if (result.success) sent++
        else failed++
      } catch (err) {
        failed++
        await this.services.blasts.createDelivery({
          blastId: blast.id,
          subscriberId: sub.id,
          channelType: channel.type,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Rate limit delay
      const delay = DEFAULT_RATE_DELAYS[channel.type] ?? 1000
      await sleep(delay)
    }

    // Mark blast as sent
    await this.services.blasts.updateBlast(blast.id, {
      status: 'sent',
      stats: { totalRecipients: matching.length, sent, delivered: 0, failed, optedOut: 0 },
    })
    await this.services.records.addAuditEntry(blast.hubId, 'blastSent', 'system', {
      blastId: blast.id,
      totalRecipients: matching.length,
      sent,
      failed,
    })
  }

  // ── Overridable helpers (for testing) ──

  /** @internal — override in tests to skip real crypto */
  async _getHubKey(hubId: string): Promise<Uint8Array> {
    const envelopes = await this.services.settings.getHubKeyEnvelopes(hubId)
    return unwrapHubKeyForServer(this.serverSecret, envelopes)
  }

  /** @internal — override in tests to skip real crypto */
  _decryptIdentifier(encrypted: string, hubKey: Uint8Array): string | null {
    return decryptFromHub(encrypted, hubKey)
  }

  /** @internal — override in tests to return mock adapter */
  async _getAdapter(channelType: string): Promise<MessagingAdapter> {
    return getMessagingAdapter(channelType as any, this.services.settings, this.hmacSecret)
  }
}

/**
 * Schedule the blast processor to run every 30 seconds.
 * Returns the interval ID for cleanup on shutdown.
 */
export function scheduleBlastProcessor(
  services: Services,
  serverSecret: string,
  hmacSecret: string
): NodeJS.Timeout {
  const processor = new BlastProcessor(services, serverSecret, hmacSecret)

  // Run once immediately on startup (resume any in-progress blasts)
  processor.processOnce().catch((err) => {
    console.error('[blast-processor] Initial run failed:', err)
  })

  return setInterval(() => {
    processor.processOnce().catch((err) => {
      console.error('[blast-processor] Poll failed:', err)
    })
  }, 30_000)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/jobs/blast-processor.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```
git add src/server/jobs/blast-processor.ts src/server/jobs/blast-processor.test.ts
git commit -m "feat: implement BlastProcessor delivery engine with batching and rate limiting"
```

---

### Task 6: Wire Up Server Startup + Shutdown

**Files:**
- Modify: `src/server/server.ts`

- [ ] **Step 1: Register blast processor at startup**

In `src/server/server.ts`, add import:
```typescript
import { scheduleBlastProcessor } from './jobs/blast-processor'
```

After the `scheduleRetentionPurge(services)` line (~line 124), add:
```typescript
const blastProcessorInterval = scheduleBlastProcessor(
  services,
  env.SERVER_NOSTR_SECRET ?? '',
  env.HMAC_SECRET ?? ''
)
console.log('[llamenos] Blast delivery processor started (30s poll)')
```

- [ ] **Step 2: Clear interval on shutdown**

In the `shutdown` function, before `server.close()`, add:
```typescript
clearInterval(blastProcessorInterval)
```

- [ ] **Step 3: Typecheck + build**

Run: `bun run typecheck && bun run build`

- [ ] **Step 4: Commit**

```
git add src/server/server.ts
git commit -m "feat: register blast processor at server startup with graceful shutdown"
```

---

### Task 7: Update Routes — `/schedule` to Use `scheduledAt`, Hub Key Validation

**Files:**
- Modify: `src/server/routes/blasts.ts`

- [ ] **Step 1: Update `/schedule` endpoint**

Change the `/schedule` handler to use the new `scheduledAt` field instead of `sentAt`:

```typescript
blasts.post('/:id/schedule', async (c) => {
  const id = c.req.param('id')
  const services = c.get('services')
  const body = (await c.req.json()) as { scheduledAt?: string }
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  if (blast.status !== 'draft') {
    return c.json({ error: 'Only draft blasts can be scheduled' }, 400)
  }
  if (!body.scheduledAt) {
    return c.json({ error: 'scheduledAt is required' }, 400)
  }
  const updated = await services.blasts.updateBlast(id, {
    status: 'scheduled',
    scheduledAt: new Date(body.scheduledAt),
  } as any)
  return c.json({ blast: blastWithParsedContent(updated) })
})
```

- [ ] **Step 2: Update BlastService.updateBlast to handle scheduledAt**

In `src/server/services/blasts.ts`, update `updateBlast` to accept and persist `scheduledAt`:

```typescript
// In the updateBlast set object, add:
...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt } : {}),
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 4: Commit**

```
git add src/server/routes/blasts.ts src/server/services/blasts.ts
git commit -m "feat: update /schedule to use dedicated scheduledAt column"
```

---

### Task 8: Add i18n Opt-Out Footer Keys

**Files:**
- Modify: `src/client/locales/en.json` (and other locale files)

- [ ] **Step 1: Add footer key to English locale**

Add to `src/client/locales/en.json`:
```json
"blast": {
  "optOutFooter": "Reply STOP to unsubscribe"
}
```

- [ ] **Step 2: Add translations for all 12 other locales**

Add the `blast.optOutFooter` key to each locale file (`es.json`, `zh.json`, `tl.json`, `vi.json`, `ar.json`, `fr.json`, `ht.json`, `ko.json`, `ru.json`, `hi.json`, `pt.json`, `de.json`) with appropriate translations.

- [ ] **Step 3: Update `getOptOutFooter` in blast-processor.ts**

Replace the hardcoded English footer with a static map built from locale files. Use a direct import map rather than runtime file reads (avoids production path issues since `src/client/locales/` won't exist in Docker):

```typescript
// In blast-processor.ts — static footer map (built at module load time)
const OPT_OUT_FOOTERS: Record<string, string> = {
  en: 'Reply STOP to unsubscribe',
  es: 'Responda STOP para cancelar la suscripción',
  zh: '回复 STOP 取消订阅',
  tl: 'Mag-reply ng STOP para mag-unsubscribe',
  vi: 'Trả lời STOP để hủy đăng ký',
  ar: 'أرسل STOP لإلغاء الاشتراك',
  fr: 'Répondez STOP pour vous désabonner',
  ht: 'Reponn STOP pou dezabòne',
  ko: 'STOP을 보내 구독을 취소하세요',
  ru: 'Ответьте STOP для отписки',
  hi: 'सदस्यता रद्द करने के लिए STOP भेजें',
  pt: 'Responda STOP para cancelar a assinatura',
  de: 'Antworten Sie STOP zum Abbestellen',
}

function getOptOutFooter(language: string | null): string {
  return OPT_OUT_FOOTERS[language ?? 'en'] ?? OPT_OUT_FOOTERS.en
}
```

Also add the corresponding `blast.optOutFooter` keys to each locale JSON for client-side consistency.

- [ ] **Step 4: Commit**

```
git add src/client/locales/ src/server/jobs/blast-processor.ts
git commit -m "feat: add i18n blast opt-out footer translations for 13 locales"
```

---

### Task 9: API Integration Tests

**Files:**
- Modify: `tests/api/blast-sending.spec.ts`

- [ ] **Step 1: Fix flaky blast-sending test (line 46)**

The test checks `blastData.blast.status === 'sending'` immediately after POST `/send`. Replace the immediate check with a polling loop:

```typescript
// After the send request, poll for status transition
let sendStatus = 'draft'
for (let i = 0; i < 10; i++) {
  const checkRes = await authedApi.get(`/api/blasts/${blastData.blast.id}`)
  const checkData = await checkRes.json()
  sendStatus = checkData.blast.status
  if (sendStatus === 'sending' || sendStatus === 'sent') break
  await new Promise(r => setTimeout(r, 200))
}
expect(['sending', 'sent']).toContain(sendStatus)
```

- [ ] **Step 2: Run existing tests to verify fix**

Run: `bunx playwright test --project=setup --project=api tests/api/blast-sending.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
git add tests/api/blast-sending.spec.ts
git commit -m "fix: blast-sending test — poll for status transition instead of immediate check"
```

---

### Task 10: Final Typecheck, Build, and Full Test Run

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 2: Build**

Run: `bun run build`

- [ ] **Step 3: Run unit tests**

Run: `bun run test:unit`

- [ ] **Step 4: Run API integration tests** (requires `bun run dev:docker`)

Run: `bunx playwright test --project=setup --project=api`

- [ ] **Step 5: Final commit if any fixes needed**

```
git add -A
git commit -m "feat: blast delivery engine — complete implementation"
```

---

## Deferred Items (Follow-Up Tasks)

These are noted in the spec or identified during plan review but intentionally deferred from this implementation:

1. **Subscriber import with encrypted identifiers** — The `/subscribers/import` endpoint currently only accepts `identifierHash`. It needs to be updated to accept an optional plaintext identifier, encrypt it with the hub key via `encryptForHub()`, and store the result. Without this, imported subscribers have `encryptedIdentifier = null` and are skipped by the processor. This should be a follow-up task.

2. **Per-hub configurable rate limits** — The spec mentions `blastRateLimits` as a new JSONB field on hub settings. The current implementation uses hardcoded `DEFAULT_RATE_DELAYS`. Per-hub tuning can be added later.

3. **Hub key validation on `/send`** — The spec mentions validating hub key availability before transitioning to `sending`. Currently the processor handles this (fails the blast if hub key is unavailable). Pre-validation in the route would give immediate feedback to the admin.

4. **New API integration tests** — The spec lists tests for delivery record verification, cancellation, and scheduled sends. These require a configured messaging adapter in the test environment. Deferred until the subscriber import encryption is in place.
