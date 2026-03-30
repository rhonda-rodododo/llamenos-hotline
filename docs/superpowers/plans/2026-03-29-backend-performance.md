# Backend Performance Optimizations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate backend performance bottlenecks in the API server, Nostr publisher, and asterisk-bridge without sacrificing security or stability.

**Architecture:** Add service-level caching for expensive crypto operations (hub keys, derived keys, roles, configs), fix N+1 query patterns, add missing database indexes, convert in-memory pagination to SQL LIMIT/OFFSET, and optimize the asterisk-bridge's HMAC signing and Nostr publisher's connection lifecycle.

**Tech Stack:** Bun, Hono, Drizzle ORM, PostgreSQL, nostr-tools, @noble/ciphers, @noble/curves

---

## File Map

### New files
- `src/server/lib/cache.ts` — Generic TTL cache utility
- `src/server/lib/cache.test.ts` — Unit tests for TTL cache
- `src/server/lib/crypto-service.test.ts` — Unit tests for CryptoService key caching

### Modified files
- `src/server/lib/crypto-service.ts` — Cache HKDF-derived keys, HMAC key, server private key
- `src/server/lib/nostr-publisher.ts` — Bounded queue (500 max), cancel auth timeout on AUTH, eager connect
- `src/server/services/settings.ts` — Hub key cache (30s TTL), role cache (10s TTL), telephony config cache (30s), phone→hub cache (60s), expose public `getHubKey()`
- `src/server/services/records.ts` — SQL LIMIT/OFFSET pagination, SQL GROUP BY for getContacts, `count()` for totals, Set-based dedup
- `src/server/services/conversations.ts` — SQL LIMIT/OFFSET pagination, `count()` for totals, Set-based dedup
- `src/server/services/identity.ts` — Set-based dedup (3 instances at lines 78, 140, 377)
- `src/server/services/blasts.ts` — Delegate to SettingsService.getHubKey(), remove duplicated `#getHubKey`
- `src/server/services/shifts.ts` — Delegate to SettingsService.getHubKey(), remove duplicated `#getHubKey`
- `src/server/services/report-types.ts` — Delegate to SettingsService.getHubKey(), remove duplicated `#getHubKey`
- `src/server/services/index.ts` — Wire SettingsService into dependent service constructors
- `src/server/server.ts` — Eager Nostr publisher `.connect()` on startup
- `src/server/db/schema/records.ts` — Add `index` import + 8 indexes (bans, auditLog, callRecords, noteEnvelopes)
- `src/server/db/schema/calls.ts` — Add `index` import + 2 indexes (activeCalls, callLegs)
- `src/server/db/schema/conversations.ts` — Add `index` import + 2 indexes (conversations, messageEnvelopes)
- `src/server/db/schema/shifts.ts` — Add `index` import + 1 index (shiftSchedules)
- `asterisk-bridge/src/webhook-sender.ts` — Cache crypto import and encoded HMAC key

---

## Task 1: TTL Cache Utility

**Files:**
- Create: `src/server/lib/cache.ts`
- Test: `src/server/lib/cache.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/lib/cache.test.ts
import { describe, expect, test } from 'bun:test'
import { TtlCache } from './cache'

describe('TtlCache', () => {
  test('returns cached value within TTL', () => {
    const cache = new TtlCache<string>(5000)
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })

  test('returns undefined after TTL expires', () => {
    const cache = new TtlCache<string>(0) // 0ms TTL = immediate expiry
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBeUndefined()
  })

  test('getOrSet calls factory on miss', async () => {
    const cache = new TtlCache<string>(5000)
    let calls = 0
    const result = await cache.getOrSet('key1', async () => {
      calls++
      return 'computed'
    })
    expect(result).toBe('computed')
    expect(calls).toBe(1)
    // Second call should use cache
    const result2 = await cache.getOrSet('key1', async () => {
      calls++
      return 'computed2'
    })
    expect(result2).toBe('computed')
    expect(calls).toBe(1)
  })

  test('clear removes all entries', () => {
    const cache = new TtlCache<string>(5000)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })

  test('delete removes single entry', () => {
    const cache = new TtlCache<string>(5000)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun test src/server/lib/cache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/lib/cache.ts

/**
 * Simple TTL cache — stores values with expiration timestamps.
 * Used for caching hub keys, roles, configs, and other expensive lookups.
 *
 * NOT request-scoped — values persist across requests until TTL expires.
 * Thread-safe for single-threaded Bun runtime.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>()

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  async getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) return cached
    const value = await factory()
    this.set(key, value)
    return value
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun test src/server/lib/cache.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/lib/cache.ts src/server/lib/cache.test.ts
git commit -m "feat: add TTL cache utility for service-level caching"
```

---

## Task 2: Cache HKDF-derived keys in CryptoService

**Files:**
- Modify: `src/server/lib/crypto-service.ts`
- Test: `src/server/lib/crypto-service.test.ts` (create if missing, otherwise extend)

The `serverEncrypt`, `serverDecrypt`, and `unwrapHubKey` methods call `hkdfDerive` every invocation with the same inputs. Cache derived keys in a Map keyed by label.

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/lib/crypto-service.test.ts
import { describe, expect, test } from 'bun:test'
import { CryptoService } from './crypto-service'

// Use a test secret (64 hex chars)
const TEST_SECRET = 'a'.repeat(64)
const TEST_HMAC = 'b'.repeat(64)

describe('CryptoService key caching', () => {
  test('serverEncrypt then serverDecrypt round-trips correctly', () => {
    const crypto = new CryptoService(TEST_SECRET, TEST_HMAC)
    const ct = crypto.serverEncrypt('hello world', 'test-label')
    const pt = crypto.serverDecrypt(ct, 'test-label')
    expect(pt).toBe('hello world')
  })

  test('same label produces same ciphertext structure (key cached)', () => {
    const crypto = new CryptoService(TEST_SECRET, TEST_HMAC)
    // Just verify no errors on repeated calls — the caching is internal
    const ct1 = crypto.serverEncrypt('msg1', 'label-a')
    const ct2 = crypto.serverEncrypt('msg2', 'label-a')
    expect(crypto.serverDecrypt(ct1, 'label-a')).toBe('msg1')
    expect(crypto.serverDecrypt(ct2, 'label-a')).toBe('msg2')
  })

  test('hmac is deterministic', () => {
    const crypto = new CryptoService(TEST_SECRET, TEST_HMAC)
    const h1 = crypto.hmac('input', 'label')
    const h2 = crypto.hmac('input', 'label')
    expect(h1).toBe(h2)
  })
})
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun test src/server/lib/crypto-service.test.ts`
Expected: PASS (this confirms existing behavior before refactor)

- [ ] **Step 3: Add key caching to CryptoService**

In `src/server/lib/crypto-service.ts`, add a private `Map<string, Uint8Array>` for derived keys and a cached server private key:

```typescript
// Add after the constructor
private derivedKeys = new Map<string, Uint8Array>()
private cachedServerPrivateKey: Uint8Array | null = null
private cachedServerPubkey: string | null = null
private cachedHmacKey: Uint8Array | null = null

private deriveKey(label: string): Uint8Array {
  let key = this.derivedKeys.get(label)
  if (!key) {
    key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
    this.derivedKeys.set(label, key)
  }
  return key
}

private getHmacKey(): Uint8Array {
  if (!this.cachedHmacKey) {
    this.cachedHmacKey = hexToBytes(this.hmacSecret)
  }
  return this.cachedHmacKey
}

private getServerPrivateKey(): { privateKey: Uint8Array; pubkey: string } {
  if (!this.cachedServerPrivateKey) {
    this.cachedServerPrivateKey = hkdfDerive(
      hexToBytes(this.serverSecret),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
      32
    )
    this.cachedServerPubkey = bytesToHex(
      secp256k1.getPublicKey(this.cachedServerPrivateKey, true).slice(1)
    )
  }
  return { privateKey: this.cachedServerPrivateKey, pubkey: this.cachedServerPubkey! }
}
```

Then update `serverEncrypt`, `serverDecrypt`, `hmac`, and `unwrapHubKey` to use the cached versions:

```typescript
serverEncrypt(plaintext: string, label: string): Ciphertext {
  return symmetricEncrypt(utf8ToBytes(plaintext), this.deriveKey(label))
}

serverDecrypt(ct: Ciphertext, label: string): string {
  return new TextDecoder().decode(symmetricDecrypt(ct, this.deriveKey(label)))
}

hmac(input: string, label: string): HmacHash {
  const data = utf8ToBytes(`${label}${input}`)
  return bytesToHex(hmacSha256(this.getHmacKey(), data)) as HmacHash
}

unwrapHubKey(
  envelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
): Uint8Array {
  const { privateKey, pubkey } = this.getServerPrivateKey()
  const envelope = envelopes.find((e) => e.pubkey === pubkey)
  if (!envelope) {
    throw new Error(`No hub key envelope for server pubkey ${pubkey}`)
  }
  return eciesUnwrapKey(envelope, privateKey, LABEL_HUB_KEY_WRAP)
}
```

- [ ] **Step 4: Run test to verify it still passes**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun test src/server/lib/crypto-service.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/lib/crypto-service.ts src/server/lib/crypto-service.test.ts
git commit -m "perf: cache HKDF-derived keys and server keypair in CryptoService"
```

---

## Task 3: Shared hub key cache across services

**Files:**
- Modify: `src/server/services/settings.ts` — add hub key caching to `#getHubKey`
- Modify: `src/server/services/shifts.ts` — delegate to settings service or shared cache
- Modify: `src/server/services/blasts.ts` — delegate to shared cache
- Modify: `src/server/services/index.ts` — wire shared cache

Currently `#getHubKey()` is duplicated across SettingsService, ShiftService, BlastService, and RecordsService. Each queries the DB and runs ECIES unwrap on every call. We'll add a TTL cache in SettingsService and expose it for other services.

- [ ] **Step 1: Add hub key cache to SettingsService**

In `src/server/services/settings.ts`, import `TtlCache` and add it as a property:

```typescript
import { TtlCache } from '../lib/cache'

export class SettingsService {
  private hubKeyCache = new TtlCache<Uint8Array | null>(30_000) // 30s TTL

  constructor(
    protected readonly db: Database,
    private readonly crypto: CryptoService
  ) {}

  async #getHubKey(hubId: string): Promise<Uint8Array | null> {
    if (!hubId || hubId === 'global') return null
    return this.hubKeyCache.getOrSet(hubId, async () => {
      const envelopes = await this.db.select().from(hubKeys).where(eq(hubKeys.hubId, hubId))
      if (envelopes.length === 0) return null
      try {
        return this.crypto.unwrapHubKey(
          envelopes.map((r) => ({
            pubkey: r.pubkey,
            wrappedKey: r.encryptedKey,
            ephemeralPubkey: r.ephemeralPubkey ?? '',
          }))
        )
      } catch {
        return null
      }
    })
  }

  /** Expose hub key lookup for other services (uses same cache). */
  getHubKey(hubId: string): Promise<Uint8Array | null> {
    return this.#getHubKey(hubId)
  }

  /** Invalidate cached hub key (call after key rotation). */
  invalidateHubKey(hubId: string): void {
    this.hubKeyCache.delete(hubId)
  }
```

- [ ] **Step 2: Update ShiftService to use SettingsService hub key**

Replace the duplicated `#getHubKey` in `src/server/services/shifts.ts`:

```typescript
export class ShiftService {
  constructor(
    protected readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService
  ) {}

  // Remove the entire #getHubKey method and replace all calls:
  // this.#getHubKey(hubId) → this.settings.getHubKey(hubId)
```

- [ ] **Step 3: Update BlastService similarly**

In `src/server/services/blasts.ts`, add `settings: SettingsService` to constructor and replace `#getHubKey`:

```typescript
export class BlastService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService,
    private readonly settings: SettingsService
  ) {}
  // Remove #getHubKey, use this.settings.getHubKey(hubId) everywhere
```

- [ ] **Step 3b: Update ReportTypeService similarly**

In `src/server/services/report-types.ts`, add `settings: SettingsService` to constructor and replace `#getHubKey` (line 15-30):

```typescript
export class ReportTypeService {
  constructor(
    private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService
  ) {}
  // Remove #getHubKey (lines 15-30), use this.settings.getHubKey(hubId) everywhere
```

- [ ] **Step 4: Update createServices in index.ts**

```typescript
export function createServices(
  db: Database,
  crypto: CryptoService,
  storage: StorageManager | null = null
): Services {
  const settings = new SettingsService(db, crypto)
  return {
    identity: new IdentityService(db, crypto),
    settings,
    records: new RecordsService(db, crypto),
    shifts: new ShiftService(db, crypto, settings),
    calls: new CallService(db, crypto),
    conversations: new ConversationService(db, crypto),
    blasts: new BlastService(db, crypto, settings),
    files: new FilesService(db, storage),
    gdpr: new GdprService(db, crypto),
    reportTypes: new ReportTypeService(db, crypto, settings),
    push: new PushService(db, crypto),
    contacts: new ContactService(db, crypto),
    storage,
    crypto,
  }
}
```

- [ ] **Step 5: Run typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 6: Run existing tests**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run test:unit`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/services/settings.ts src/server/services/shifts.ts src/server/services/blasts.ts src/server/services/index.ts
git commit -m "perf: centralize hub key cache in SettingsService, remove duplicated #getHubKey"
```

---

## Task 4: Cache roles in SettingsService

**Files:**
- Modify: `src/server/services/settings.ts`

`listRoles()` is called on every authenticated request via auth middleware. Cache the result per hubId with a 10s TTL.

- [ ] **Step 1: Add role cache**

In `src/server/services/settings.ts`, add:

```typescript
private roleCache = new TtlCache<Role[]>(10_000) // 10s TTL
```

- [ ] **Step 2: Wrap listRoles with cache**

```typescript
async listRoles(hubId?: string): Promise<Role[]> {
  const cacheKey = hubId ?? '__global__'
  const cached = this.roleCache.get(cacheKey)
  if (cached) return cached

  // ... existing implementation unchanged ...

  // Before each return statement, cache the result:
  // this.roleCache.set(cacheKey, result)
  // return result
}
```

Add `this.roleCache.set(cacheKey, result)` before each `return` in `listRoles`. Also invalidate on `createRole`, `updateRole`, `deleteRole`:

```typescript
// In createRole, updateRole, deleteRole:
this.roleCache.clear()
```

- [ ] **Step 3: Run typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/services/settings.ts
git commit -m "perf: cache listRoles results (10s TTL) — eliminates per-request DB query"
```

---

## Task 5: Cache telephony provider configs

**Files:**
- Modify: `src/server/services/settings.ts`

`getTelephonyProvider()` decrypts + JSON.parses the config on every call. Cache parsed configs.

- [ ] **Step 1: Add config cache**

```typescript
private telephonyConfigCache = new TtlCache<TelephonyProviderConfig | null>(30_000) // 30s TTL
```

- [ ] **Step 2: Wrap getTelephonyProvider**

In the existing `getTelephonyProvider` method, add cache lookup at the top:

```typescript
async getTelephonyProvider(hubId?: string): Promise<TelephonyProviderConfig | null> {
  const hId = hubId ?? 'global'
  return this.telephonyConfigCache.getOrSet(hId, async () => {
    // ... existing implementation (query + decrypt + parse) ...
  })
}
```

Invalidate in `updateTelephonyProvider`:

```typescript
async updateTelephonyProvider(config: TelephonyProviderConfig, hubId?: string): Promise<TelephonyProviderConfig> {
  const hId = hubId ?? 'global'
  // ... existing implementation ...
  this.telephonyConfigCache.delete(hId)
  return config
}
```

- [ ] **Step 3: Fix getHubByPhone — add phone hash index lookup**

Replace the full-table-scan + decrypt loop in `getHubByPhone` with a cached phone→hubId map:

```typescript
private phoneToHubCache = new TtlCache<string | null>(60_000) // 60s TTL

async getHubByPhone(phone: string): Promise<Hub | null> {
  // Check cache first
  const cachedHubId = this.phoneToHubCache.get(phone)
  if (cachedHubId !== undefined) {
    return cachedHubId ? this.getHub(cachedHubId) : null
  }

  // Full scan (unchanged logic) but cache the result
  const rows = await this.db.select().from(telephonyConfig)
  for (const row of rows) {
    if (!row.config) continue
    let cfg: Record<string, unknown>
    try {
      cfg = JSON.parse(
        this.crypto.serverDecrypt(row.config as Ciphertext, LABEL_PROVIDER_CREDENTIAL_WRAP)
      ) as Record<string, unknown>
    } catch {
      try {
        cfg = JSON.parse(row.config) as Record<string, unknown>
      } catch {
        continue
      }
    }
    if (cfg.phoneNumber === phone) {
      this.phoneToHubCache.set(phone, row.hubId)
      return this.getHub(row.hubId)
    }
  }
  this.phoneToHubCache.set(phone, null)
  return null
}
```

Also invalidate in `updateTelephonyProvider`:
```typescript
this.phoneToHubCache.clear()
```

- [ ] **Step 4: Run typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/services/settings.ts
git commit -m "perf: cache telephony configs and phone→hub lookup"
```

---

## Task 6: Add missing database indexes

**Files:**
- Modify: `src/server/db/schema/records.ts`
- Modify: `src/server/db/schema/calls.ts`
- Modify: `src/server/db/schema/conversations.ts`
- Modify: `src/server/db/schema/settings.ts`
- Modify: `src/server/db/schema/shifts.ts`

- [ ] **Step 1: Read all schema files to find exact table definitions**

Read each schema file to find the exact `pgTable` calls and their existing constraint definitions.

- [ ] **Step 2: Add indexes**

Each schema file needs `index` added to its `drizzle-orm/pg-core` import. Tables without a constraint function (3rd arg to `pgTable`) need one added.

**Import change for each file:**
```typescript
// records.ts: add 'index' to existing import
import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// calls.ts: add 'index'
import { boolean, index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// conversations.ts: add 'index' (already has 'unique')
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core'

// shifts.ts: add 'index'
import { boolean, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
```

Add constraint function (3rd arg to `pgTable`) with `index()` calls. Tables that already have a constraint fn (conversations) get indexes added to the existing array.

**records.ts** — `noteEnvelopes` table:
```typescript
index('note_envelopes_hub_idx').on(table.hubId),
index('note_envelopes_call_idx').on(table.callId),
index('note_envelopes_contact_hash_idx').on(table.contactHash),
```

**records.ts** — `auditLog` table:
```typescript
index('audit_log_hub_idx').on(table.hubId),
index('audit_log_hub_created_idx').on(table.hubId, table.createdAt),
```

**records.ts** — `bans` table (add hubId to existing):
```typescript
index('bans_hub_phone_hash_idx').on(table.hubId, table.phoneHash),
```

**calls.ts** — `callRecords` table:
```typescript
index('call_records_hub_idx').on(table.hubId),
index('call_records_hub_started_idx').on(table.hubId, table.startedAt),
```

**calls.ts** — `callLegs` table:
```typescript
index('call_legs_call_sid_idx').on(table.callSid),
```

**calls.ts** — `activeCalls` table:
```typescript
index('active_calls_hub_idx').on(table.hubId),
```

**conversations.ts** — `messageEnvelopes` table:
```typescript
index('message_envelopes_conversation_idx').on(table.conversationId),
```

**conversations.ts** — `conversations` table:
```typescript
index('conversations_hub_idx').on(table.hubId),
```

**shifts.ts** — `shiftSchedules` table:
```typescript
index('shift_schedules_hub_idx').on(table.hubId),
```

- [ ] **Step 3: Generate migration**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run migrate:generate`
Expected: New migration file generated with CREATE INDEX statements

- [ ] **Step 4: Run typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/db/schema/ drizzle/
git commit -m "perf: add 12 missing database indexes for hot query paths"
```

---

## Task 7: SQL pagination for getCallHistory, getNotes, getMessages, listConversations

**Files:**
- Modify: `src/server/services/records.ts`
- Modify: `src/server/services/conversations.ts`

Replace in-memory pagination (load all, `.slice()`) with SQL `LIMIT`/`OFFSET` and Drizzle's `count()` helper.

**Import change for records.ts and conversations.ts:**
```typescript
// Add count to the drizzle-orm import:
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
```

- [ ] **Step 1: Fix getCallHistory in records.ts**

Replace lines 344-365:

```typescript
async getCallHistory(
  page: number,
  limit: number,
  hubId?: string,
  filters?: CallRecordFilters
): Promise<{ calls: EncryptedCallRecord[]; total: number }> {
  const hId = hubId ?? 'global'

  const conditions = [eq(callRecords.hubId, hId)]
  if (filters?.dateFrom) {
    conditions.push(gte(callRecords.startedAt, new Date(filters.dateFrom)))
  }
  if (filters?.dateTo) {
    const toDate = new Date(filters.dateTo)
    toDate.setUTCHours(23, 59, 59, 999)
    conditions.push(lte(callRecords.startedAt, toDate))
  }

  const whereClause = and(...conditions)

  // Count total (without voicemail/search filters — those are post-decrypt)
  const [{ count: rawTotal }] = await this.db
    .select({ count: count() })
    .from(callRecords)
    .where(whereClause)
  const total = Number(rawTotal)

  // If no post-decrypt filters, use SQL pagination
  if (!filters?.voicemailOnly && !filters?.search) {
    const offset = (page - 1) * limit
    const rows = await this.db
      .select()
      .from(callRecords)
      .where(whereClause)
      .orderBy(desc(callRecords.startedAt))
      .limit(limit)
      .offset(offset)
    return { calls: rows.map((r) => this.#rowToCallRecord(r)), total }
  }

  // With post-decrypt filters, still load all (can't filter in SQL due to encryption)
  const allRows = await this.db
    .select()
    .from(callRecords)
    .where(whereClause)
    .orderBy(desc(callRecords.startedAt))

  let filtered = allRows.map((r) => this.#rowToCallRecord(r))
  if (filters?.voicemailOnly) {
    filtered = filtered.filter((c) => c.hasVoicemail)
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase()
    filtered = filtered.filter(
      (c) => c.callerLast4?.includes(q) || c.id.toLowerCase().includes(q)
    )
  }
  const filteredTotal = filtered.length
  const start = (page - 1) * limit
  return { calls: filtered.slice(start, start + limit), total: filteredTotal }
}
```

- [ ] **Step 2: Fix getNotes in records.ts**

Replace lines 444-458:

```typescript
async getNotes(filters: NoteFilters): Promise<{ notes: EncryptedNote[]; total: number }> {
  const hId = filters.hubId ?? 'global'
  const conditions: ReturnType<typeof eq>[] = [eq(noteEnvelopes.hubId, hId)]

  if (filters.authorPubkey) conditions.push(eq(noteEnvelopes.authorPubkey, filters.authorPubkey))
  if (filters.callId) conditions.push(eq(noteEnvelopes.callId, filters.callId))
  if (filters.conversationId) conditions.push(eq(noteEnvelopes.conversationId, filters.conversationId))
  if (filters.contactHash) conditions.push(eq(noteEnvelopes.contactHash, filters.contactHash))

  const whereClause = and(...conditions)

  const [{ count: rawTotal }] = await this.db
    .select({ count: count() })
    .from(noteEnvelopes)
    .where(whereClause)
  const total = Number(rawTotal)

  if (filters.page && filters.limit) {
    const offset = (filters.page - 1) * filters.limit
    const rows = await this.db
      .select()
      .from(noteEnvelopes)
      .where(whereClause)
      .orderBy(desc(noteEnvelopes.createdAt))
      .limit(filters.limit)
      .offset(offset)
    return { notes: rows.map((r) => this.#rowToNote(r)), total }
  }

  const rows = await this.db
    .select()
    .from(noteEnvelopes)
    .where(whereClause)
    .orderBy(desc(noteEnvelopes.createdAt))
  return { notes: rows.map((r) => this.#rowToNote(r)), total }
}
```

- [ ] **Step 3: Fix getMessages in conversations.ts**

Replace lines 199-208:

```typescript
async getMessages(
  conversationId: string,
  page = 1,
  limit = 50
): Promise<{ messages: EncryptedMessage[]; total: number }> {
  const [{ count: rawTotal }] = await this.db
    .select({ count: count() })
    .from(messageEnvelopes)
    .where(eq(messageEnvelopes.conversationId, conversationId))
  const total = Number(rawTotal)

  const offset = (page - 1) * limit
  const rows = await this.db
    .select()
    .from(messageEnvelopes)
    .where(eq(messageEnvelopes.conversationId, conversationId))
    .orderBy(desc(messageEnvelopes.createdAt))
    .limit(limit)
    .offset(offset)
  return { messages: rows.map((r) => this.#rowToMessage(r)), total }
}
```

- [ ] **Step 4: Fix listConversations in conversations.ts**

Replace lines 43-54:

```typescript
async listConversations(
  filters: ConversationFilters
): Promise<{ conversations: Conversation[]; total: number }> {
  const hId = filters.hubId ?? 'global'
  const conditions: ReturnType<typeof eq>[] = [eq(conversations.hubId, hId)]

  if (filters.status) conditions.push(eq(conversations.status, filters.status))
  if (filters.assignedTo) conditions.push(eq(conversations.assignedTo, filters.assignedTo))
  if (filters.channelType) conditions.push(eq(conversations.channelType, filters.channelType))

  const whereClause = and(...conditions)

  const [{ count: rawTotal }] = await this.db
    .select({ count: count() })
    .from(conversations)
    .where(whereClause)
  const total = Number(rawTotal)

  const page = filters.page ?? 1
  const limit = filters.limit ?? 50
  const offset = (page - 1) * limit
  const rows = await this.db
    .select()
    .from(conversations)
    .where(whereClause)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit)
    .offset(offset)
  return { conversations: rows.map((r) => this.#rowToConversation(r)), total }
}
```

- [ ] **Step 5: Fix getContacts — use SQL GROUP BY**

Replace the in-memory aggregation in `getContacts` (records.ts lines 465-508):

```typescript
async getContacts(
  page: number,
  limit: number,
  hubId?: string
): Promise<{
  contacts: Array<{ contactHash: string; firstSeen: string; lastSeen: string; noteCount: number }>
  total: number
}> {
  const hId = hubId ?? 'global'

  // SQL aggregation instead of loading all rows
  const aggregated = await this.db
    .select({
      contactHash: noteEnvelopes.contactHash,
      firstSeen: sql<Date>`min(${noteEnvelopes.createdAt})`,
      lastSeen: sql<Date>`max(${noteEnvelopes.createdAt})`,
      noteCount: count(),
    })
    .from(noteEnvelopes)
    .where(and(eq(noteEnvelopes.hubId, hId), sql`${noteEnvelopes.contactHash} IS NOT NULL`))
    .groupBy(noteEnvelopes.contactHash)
    .orderBy(sql`max(${noteEnvelopes.createdAt}) DESC`)

  const total = aggregated.length
  const start = (page - 1) * limit
  const pageResults = aggregated.slice(start, start + limit)

  return {
    contacts: pageResults.map((r) => ({
      contactHash: r.contactHash!,
      firstSeen: new Date(r.firstSeen).toISOString(),
      lastSeen: new Date(r.lastSeen).toISOString(),
      noteCount: Number(r.noteCount),
    })),
    total,
  }
}
```

- [ ] **Step 6: Fix getCallsTodayCount — use COUNT(*)**

Replace lines 368-377:

```typescript
async getCallsTodayCount(hubId?: string): Promise<number> {
  const hId = hubId ?? 'global'
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const [{ count }] = await this.db
    .select({ count: count() })
    .from(callRecords)
    .where(and(eq(callRecords.hubId, hId), gte(callRecords.startedAt, todayStart)))
  return Number(count)
}
```

- [ ] **Step 7: Run typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/services/records.ts src/server/services/conversations.ts
git commit -m "perf: SQL pagination and COUNT(*) — stop loading entire result sets into memory"
```

---

## Task 8: Fix O(n^2) deduplication patterns

**Files:**
- Modify: `src/server/services/records.ts` — `bulkAddBans`

Replace `.filter((pk, i, arr) => arr.indexOf(pk) === i)` with `[...new Set(arr)]`.

- [ ] **Step 1: Find and replace all 6 O(n^2) dedup patterns**

Replace `.filter((pk, i, arr) => arr.indexOf(pk) === i)` with `[...new Set(array)]` at these locations:

1. `records.ts:103` — `addBan()` recipient pubkeys
2. `records.ts:165` — `bulkAddBans()` recipient pubkeys
3. `conversations.ts:73` — `createConversation()` recipient pubkeys
4. `identity.ts:78` — `createVolunteer()` name recipients
5. `identity.ts:140` — `updateVolunteer()` name recipients
6. `identity.ts:377` — `redeemInvite()` name recipients

Pattern for each:
```typescript
// Before:
const recipientPubkeys = [
  ...(isValidPubkey(data.pubkey) ? [data.pubkey] : []),
  ...adminPubkeys,
].filter((pk, i, arr) => arr.indexOf(pk) === i)

// After:
const recipientPubkeys = [...new Set([
  ...(isValidPubkey(data.pubkey) ? [data.pubkey] : []),
  ...adminPubkeys,
])]
```

- [ ] **Step 2: Run typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/services/records.ts src/server/services/conversations.ts src/server/services/identity.ts
git commit -m "perf: replace O(n^2) array dedup with Set (6 instances)"
```

---

## Task 9: Nostr publisher — eager connect, bounded queue, faster auth

**Files:**
- Modify: `src/server/lib/nostr-publisher.ts`
- Modify: `src/server/server.ts`

- [ ] **Step 1: Add bounded queue and faster auth to NodeNostrPublisher**

In `src/server/lib/nostr-publisher.ts`, modify `NodeNostrPublisher`:

```typescript
// Add constants at top of class
private static readonly MAX_PENDING = 500
private static readonly AUTH_TIMEOUT_MS = 2000
private authTimer: ReturnType<typeof setTimeout> | null = null
```

Update `publish` to enforce queue limit:

```typescript
async publish(template: EventTemplate): Promise<void> {
  const event = signServerEvent(template, this.secretKey)

  if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
    this.ws.send(JSON.stringify(['EVENT', event]))
    return
  }

  // Bounded queue — drop oldest if at capacity
  if (this.pendingEvents.length >= NodeNostrPublisher.MAX_PENDING) {
    this.pendingEvents.shift()
    console.warn('[nostr-publisher] Queue full, dropping oldest event')
  }
  this.pendingEvents.push(event)

  if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
    this.connect().catch((err) => {
      console.error('[nostr-publisher] Failed to connect:', err)
    })
  }
}
```

Update `setupListeners` to cancel auth timer when AUTH arrives:

```typescript
private setupListeners(ws: WebSocket): void {
  ws.addEventListener('message', (msg) => {
    try {
      const data = JSON.parse(typeof msg.data === 'string' ? msg.data : '')
      if (Array.isArray(data)) {
        if (data[0] === 'AUTH') {
          if (this.authTimer) {
            clearTimeout(this.authTimer)
            this.authTimer = null
          }
          this.handleNIP42Auth(data[1] as string)
        } else if (data[0] === 'OK') {
          if (!data[2]) {
            console.warn(`[nostr-publisher] Event ${data[1]} rejected: ${data[3]}`)
          }
        } else if (data[0] === 'NOTICE') {
          console.warn(`[nostr-publisher] Relay notice: ${data[1]}`)
        }
      }
    } catch {
      // Ignore malformed messages
    }
  })

  ws.addEventListener('close', () => {
    this.authenticated = false
    this.ws = null
    if (this.authTimer) {
      clearTimeout(this.authTimer)
      this.authTimer = null
    }
    if (!this.closed) {
      this.scheduleReconnect()
    }
  })

  ws.addEventListener('error', (err) => {
    console.error('[nostr-publisher] WebSocket error:', err)
  })

  // If no AUTH challenge arrives within 2s, assume open relay
  this.authTimer = setTimeout(() => {
    this.authTimer = null
    if (!this.authenticated && this.ws === ws) {
      this.authenticated = true
      this.flushPendingEvents()
    }
  }, NodeNostrPublisher.AUTH_TIMEOUT_MS)
}
```

Also clean up authTimer in `close()`:

```typescript
close(): void {
  this.closed = true
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
  if (this.authTimer) {
    clearTimeout(this.authTimer)
    this.authTimer = null
  }
  if (this.ws) {
    this.ws.close()
    this.ws = null
  }
  this.pendingEvents = []
}
```

- [ ] **Step 2: Eager connect on server startup**

In `src/server/server.ts`, `getNostrPublisher` is already imported from `./lib/adapters` (line 19 — aliased as part of the named imports). After services are created (~line 183), add eager connect. Note: `getNostrPublisher` is a lazy singleton in `adapters.ts` — calling it creates the publisher but doesn't connect.

```typescript
// After line ~183 (after blast processor started, before app import)
// Eagerly connect Nostr publisher
const publisher = getNostrPublisher(env)
if ('connect' in publisher && typeof publisher.connect === 'function') {
  ;(publisher as { connect(): Promise<void> }).connect().catch((err) => {
    console.warn('[llamenos] Nostr publisher eager connect failed (will retry):', err)
  })
  console.log('[llamenos] Nostr publisher connecting eagerly')
}
```

Note: `getNostrPublisher` is not currently imported in `server.ts` — it's imported via `{ closeNostrPublisher }`. Add it to the import:
```typescript
import { closeNostrPublisher, getMessagingAdapter, getNostrPublisher, getTelephony } from './lib/adapters'
```

- [ ] **Step 3: Run typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add src/server/lib/nostr-publisher.ts src/server/server.ts
git commit -m "perf: bounded Nostr event queue, faster AUTH, eager connect on startup"
```

---

## Task 10: Asterisk bridge — cache crypto import and HMAC key

**Files:**
- Modify: `asterisk-bridge/src/webhook-sender.ts`

The `sign()` method does `await import('crypto')` and `new TextEncoder().encode(secret)` on every call.

- [ ] **Step 1: Cache the import and encoded key**

Replace the `sign` method:

```typescript
// Add as class properties
private cachedHmacKey: Buffer | null = null
private hmacModule: typeof import('crypto') | null = null

private async getHmacModule() {
  if (!this.hmacModule) {
    this.hmacModule = await import('crypto')
  }
  return this.hmacModule
}

private getHmacKey(): Buffer {
  if (!this.cachedHmacKey) {
    this.cachedHmacKey = Buffer.from(this.config.bridgeSecret)
  }
  return this.cachedHmacKey
}

private async sign(url: string, body: string): Promise<string> {
  const params = new URLSearchParams(body)
  let dataString = url
  const sortedKeys = Array.from(params.keys()).sort()
  for (const key of sortedKeys) {
    dataString += key + params.get(key)
  }

  const { createHmac } = await this.getHmacModule()
  const hmac = createHmac('sha256', this.getHmacKey())
  hmac.update(dataString)
  return hmac.digest('base64')
}
```

- [ ] **Step 2: Run typecheck (if asterisk-bridge has its own tsconfig)**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend/asterisk-bridge && bun run typecheck 2>/dev/null || npx tsc --noEmit 2>/dev/null || echo "No separate typecheck for bridge"`
Expected: No errors (or no separate typecheck configured)

- [ ] **Step 3: Commit**

```bash
cd /media/rikki/recover2/projects/llamenos-perf-backend
git add asterisk-bridge/src/webhook-sender.ts
git commit -m "perf: cache crypto import and HMAC key in asterisk-bridge WebhookSender"
```

---

## Task 11: Final typecheck and build verification

- [ ] **Step 1: Run full typecheck**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run typecheck`
Expected: No errors

- [ ] **Step 2: Run build**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run build`
Expected: Successful build

- [ ] **Step 3: Run all unit tests**

Run: `cd /media/rikki/recover2/projects/llamenos-perf-backend && bun run test:unit`
Expected: All pass

- [ ] **Step 4: Fix any failures, commit final**

If any failures, fix and commit.

---

## Performance Impact Summary

| Fix | Category | Expected Latency Reduction |
|-----|----------|---------------------------|
| Cache HKDF keys | A (quick win) | -5-20ms per crypto operation |
| Cache hub keys (30s TTL) | A (quick win) | Eliminates N+1 DB queries in loops |
| Cache roles (10s TTL) | A (quick win) | -10-50ms per authenticated request |
| Cache telephony configs | A (quick win) | -2-10ms per config read |
| Cache phone→hub lookup | A (quick win) | -50-500ms per incoming call |
| 12 missing DB indexes | A (quick win) | Sequential scans → index lookups |
| SQL pagination | B (algorithmic) | Eliminates loading unbounded result sets |
| SQL GROUP BY for contacts | B (algorithmic) | Eliminates in-memory aggregation |
| COUNT(*) for counts | B (algorithmic) | -1-5ms per count query |
| Set-based dedup | B (algorithmic) | O(n) vs O(n^2) |
| Bounded Nostr queue | A (quick win) | Prevents OOM on relay outage |
| Eager Nostr connect | A (quick win) | -2s latency on first event |
| Bridge HMAC caching | A (quick win) | -1ms per webhook |
