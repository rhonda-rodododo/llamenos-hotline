# Credential Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace fake hex-encoding with real XChaCha20-Poly1305 symmetric encryption for all provider credentials at rest.

**Architecture:** Derive a symmetric key from `SERVER_NOSTR_SECRET` via HKDF (following the established `hub-event-crypto.ts` pattern). Encrypt all credential stores (telephony config, messaging config, provider config, geocoding API key) with XChaCha20-Poly1305. Auto-migrate existing plaintext data on first read.

**Tech Stack:** `@noble/ciphers/chacha.js` (xchacha20poly1305), `@noble/hashes/hkdf.js` (hkdf), `@noble/hashes/sha256.js`, Drizzle ORM for schema migration.

**Spec:** `docs/superpowers/specs/2026-03-23-credential-encryption-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server/lib/crypto.ts` | MODIFY | Add `encryptProviderCredentials()`, `decryptProviderCredentials()`, `deriveProviderKey()` |
| `src/server/provider-setup/index.ts` | MODIFY | Replace fake `encryptCredentials()`/`decryptCredentials()` with real ones |
| `src/server/services/settings.ts` | MODIFY | Encrypt on write, decrypt on read for telephony/messaging/geocoding configs |
| `src/server/db/schema/settings.ts` | MODIFY | Change `telephonyConfig.config` and `messagingConfig.config` from jsonb to text |
| `src/server/db/migrations/` | CREATE | New migration for schema changes |
| `tests/credential-encryption.spec.ts` | CREATE | E2E tests for encrypt/decrypt roundtrip and auto-migration |

---

### Task 1: Encryption Functions

**Files:**
- Modify: `src/server/lib/crypto.ts`
- Test: `tests/credential-encryption.spec.ts`

- [x] **Step 1: Write the encryption roundtrip test**

```typescript
// tests/credential-encryption.spec.ts
import { test, expect } from '@playwright/test'

test.describe('provider credential encryption', () => {
  // Use a fixed test secret (64 hex chars like SERVER_NOSTR_SECRET)
  const TEST_SECRET = 'a'.repeat(64)

  test('encrypt then decrypt roundtrip', async () => {
    const { encryptProviderCredentials, decryptProviderCredentials } = await import('../src/server/lib/crypto')
    const plaintext = JSON.stringify({ accountSid: 'AC123', authToken: 'secret-token-here' })
    const encrypted = encryptProviderCredentials(plaintext, TEST_SECRET)

    // Encrypted should be hex string, different from plaintext
    expect(encrypted).not.toBe(plaintext)
    expect(encrypted).toMatch(/^[0-9a-f]+$/)

    // Decrypt should return original
    const decrypted = decryptProviderCredentials(encrypted, TEST_SECRET)
    expect(decrypted).toBe(plaintext)
  })

  test('decrypt with wrong key throws', async () => {
    const { encryptProviderCredentials, decryptProviderCredentials } = await import('../src/server/lib/crypto')
    const encrypted = encryptProviderCredentials('secret data', TEST_SECRET)
    const wrongKey = 'b'.repeat(64)

    expect(() => decryptProviderCredentials(encrypted, wrongKey)).toThrow()
  })

  test('each encryption produces different ciphertext (random nonce)', async () => {
    const { encryptProviderCredentials } = await import('../src/server/lib/crypto')
    const plaintext = 'same input'
    const a = encryptProviderCredentials(plaintext, TEST_SECRET)
    const b = encryptProviderCredentials(plaintext, TEST_SECRET)
    expect(a).not.toBe(b) // Different nonces → different ciphertext
  })

  test('encrypted output is nonce (48 hex = 24 bytes) + ciphertext', async () => {
    const { encryptProviderCredentials } = await import('../src/server/lib/crypto')
    const encrypted = encryptProviderCredentials('test', TEST_SECRET)
    // Minimum length: 48 hex (nonce) + 32 hex (16 byte AEAD tag) + plaintext hex
    expect(encrypted.length).toBeGreaterThan(48 + 32)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `bunx playwright test tests/credential-encryption.spec.ts --project server-unit`
Expected: FAIL — `encryptProviderCredentials` not exported

> **Note:** The `bridge` project only matches `asterisk-*.spec.ts`. Before running, add a `server-unit` project to `playwright.config.ts`:
> ```typescript
> {
>   // Server-side unit tests — no browser, no webserver needed
>   name: "server-unit",
>   testMatch: /^(?!.*responsive|.*bootstrap).*\.spec\.ts$/,
>   testIgnore: [/asterisk-.*\.spec\.ts/],  // bridge handles these
> }
> ```
> Or alternatively, run without a project filter: `bunx playwright test tests/credential-encryption.spec.ts`

- [x] **Step 3: Implement encryption functions**

Add to `src/server/lib/crypto.ts`:

```typescript
// New imports (add to existing imports at top of file)
import { hkdf } from '@noble/hashes/hkdf.js'
import { LABEL_PROVIDER_CREDENTIAL_WRAP } from '@shared/crypto-labels'

// ... existing code ...

// ── Provider Credential Encryption ──

/**
 * Derive a symmetric key for provider credential encryption.
 * Follows established pattern from hub-event-crypto.ts:
 * empty salt, domain label as HKDF info.
 */
function deriveProviderKey(serverSecret: string): Uint8Array {
  return hkdf(
    sha256,
    hexToBytes(serverSecret),
    new Uint8Array(0),
    utf8ToBytes(LABEL_PROVIDER_CREDENTIAL_WRAP),
    32,
  )
}
// Note: utf8ToBytes is already imported from @noble/ciphers/utils.js in crypto.ts
```

Also update `encryptProviderCredentials` to use `utf8ToBytes` instead of `new TextEncoder().encode`:
```typescript
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))

/**
 * Encrypt provider credentials for storage.
 * Uses XChaCha20-Poly1305 with HKDF-derived key from SERVER_NOSTR_SECRET.
 * Returns hex(nonce || ciphertext) — nonce is 24 bytes.
 */
export function encryptProviderCredentials(plaintext: string, serverSecret: string): string {
  const key = deriveProviderKey(serverSecret)
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(new TextEncoder().encode(plaintext))
  const packed = new Uint8Array(24 + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, 24)
  return bytesToHex(packed)
}

/**
 * Decrypt provider credentials from storage.
 * Throws if the key is wrong or data is tampered (AEAD verification failure).
 */
export function decryptProviderCredentials(encrypted: string, serverSecret: string): string {
  const bytes = hexToBytes(encrypted)
  const nonce = bytes.slice(0, 24)
  const ciphertext = bytes.slice(24)
  const key = deriveProviderKey(serverSecret)
  const cipher = xchacha20poly1305(key, nonce)
  return new TextDecoder().decode(cipher.decrypt(ciphertext))
}
```

Note: `sha256`, `hexToBytes`, `bytesToHex`, and `xchacha20poly1305` should already be imported in crypto.ts. Verify and add any missing imports.

- [x] **Step 4: Run tests to verify they pass**

Run: `bunx playwright test tests/credential-encryption.spec.ts`
Expected: All 4 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/server/lib/crypto.ts tests/credential-encryption.spec.ts
git commit -m "feat: real XChaCha20-Poly1305 provider credential encryption"
```

---

### Task 2: Replace Fake Encryption in ProviderSetup

**Files:**
- Modify: `src/server/provider-setup/index.ts` (lines 364-374)

- [x] **Step 1: Replace the fake encrypt/decrypt functions**

Find the current fake functions (around lines 364-374):

```typescript
// REMOVE these:
function encryptCredentials(plaintext: string): string {
  const _label = LABEL_PROVIDER_CREDENTIAL_WRAP
  const encoded = new TextEncoder().encode(plaintext)
  return bytesToHex(encoded)
}

function decryptCredentials(ciphertext: string): string {
  const _label = LABEL_PROVIDER_CREDENTIAL_WRAP
  const decoded = hexToBytes(ciphertext)
  return new TextDecoder().decode(decoded)
}
```

Replace with imports from crypto.ts:

```typescript
import { encryptProviderCredentials, decryptProviderCredentials } from '../lib/crypto'
```

Then update all call sites in the file:
- `encryptCredentials(JSON.stringify(credentials))` → `encryptProviderCredentials(JSON.stringify(credentials), this.serverSecret)`
- `decryptCredentials(encrypted)` → `decryptProviderCredentials(encrypted, this.serverSecret)`

The `ProviderSetup` class needs access to `SERVER_NOSTR_SECRET`. It's already passed through the Hono env. Add it as a constructor parameter or pass it from the route handler:

```typescript
// In the ProviderSetup class, add:
private serverSecret: string

constructor(settings: SettingsService, serverSecret: string) {
  this.settings = settings
  this.serverSecret = serverSecret
}
```

Update the route handler that creates ProviderSetup to pass `c.env.SERVER_NOSTR_SECRET`.

- [x] **Step 2: Remove the unused LABEL_PROVIDER_CREDENTIAL_WRAP import** (it's now imported in crypto.ts)

Check if provider-setup/index.ts still needs the import for other reasons. If not, remove it.

- [x] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add src/server/provider-setup/index.ts
git commit -m "fix: replace fake hex-encoding with real encryption in ProviderSetup"
```

---

### Task 3: Schema Migration — JSONB to Text

**Files:**
- Modify: `src/server/db/schema/settings.ts`
- Create: New Drizzle migration

- [x] **Step 1: Update schema definitions**

In `src/server/db/schema/settings.ts`, find the `telephonyConfig` table definition and change `config` from `jsonb` to `text`:

```typescript
// Before:
config: jsonb<Record<string, unknown>>()('config').notNull().default({}),

// After:
config: text('config').notNull().default(''),
```

Do the same for `messagingConfig.config`:

```typescript
// Before:
config: jsonb<Record<string, unknown>>()('config').notNull().default({}),

// After:
config: text('config').notNull().default(''),
```

- [x] **Step 2: Generate migration**

Run: `bun run migrate:generate`
Expected: New SQL migration file in `src/server/db/migrations/`

- [x] **Step 3: Review the generated migration SQL**

It should contain `ALTER TABLE ... ALTER COLUMN ... TYPE text`. If the migration looks correct, proceed.

- [x] **Step 4: Apply migration**

Run: `bun run migrate`
Expected: Migration applied successfully

- [x] **Step 5: Commit**

```bash
git add src/server/db/schema/settings.ts src/server/db/migrations/
git commit -m "chore: migrate telephony/messaging config from jsonb to encrypted text"
```

---

### Task 4: Encrypt/Decrypt in SettingsService

**Files:**
- Modify: `src/server/services/settings.ts`

- [x] **Step 1: Add auto-migration test**

Append to `tests/credential-encryption.spec.ts`:

```typescript
test.describe('auto-migration of plaintext data', () => {
  test('tryDecryptOrMigrate handles plaintext JSON', async () => {
    const { encryptProviderCredentials, decryptProviderCredentials } = await import('../src/server/lib/crypto')
    const TEST_SECRET = 'a'.repeat(64)
    const config = { type: 'twilio', accountSid: 'AC123', authToken: 'tok' }
    const plainJson = JSON.stringify(config)

    // Simulating what SettingsService does: try decrypt, if fails, it's plaintext
    let decrypted: string
    try {
      decrypted = decryptProviderCredentials(plainJson, TEST_SECRET)
    } catch {
      // AEAD failed — this is plaintext, re-encrypt it
      const encrypted = encryptProviderCredentials(plainJson, TEST_SECRET)
      decrypted = decryptProviderCredentials(encrypted, TEST_SECRET)
    }
    expect(JSON.parse(decrypted)).toEqual(config)
  })
})
```

- [x] **Step 2: Run test**

Run: `bunx playwright test tests/credential-encryption.spec.ts --project bridge`
Expected: All tests PASS (including the new migration test)

- [x] **Step 3: Update SettingsService to encrypt/decrypt**

In `src/server/services/settings.ts` (line 74), the current constructor is `constructor(protected readonly db: Database)`. Add `serverSecret`:

```typescript
private serverSecret: string

constructor(protected readonly db: Database, serverSecret: string) {
  this.serverSecret = serverSecret
}
```

Also update the `createServices()` factory in `src/server/services/index.ts` (line 43):

```typescript
export function createServices(db: Database, blob: BlobStorage | null = null, serverSecret: string): Services {
  return {
    // ...existing services...
    settings: new SettingsService(db, serverSecret),
    // ...
  }
}
```

Update the caller of `createServices()` in `src/server/app.ts` or `src/server/server.ts` to pass `env.SERVER_NOSTR_SECRET`.

**Also update `getHubByPhone()`** (settings.ts ~line 291) — this method reads `config.phoneNumber` from the now-encrypted text column. After the schema change, it must decrypt first:

```typescript
async getHubByPhone(phoneNumber: string): Promise<string | null> {
  const rows = await this.db.select().from(telephonyConfig)
  for (const row of rows) {
    if (!row.config) continue
    let config: TelephonyProviderConfig
    try {
      config = JSON.parse(decryptProviderCredentials(row.config, this.serverSecret))
    } catch {
      try { config = JSON.parse(row.config) } catch { continue } // legacy plaintext
    }
    if (config.phoneNumber === phoneNumber) return row.hubId
  }
  return null
}
```

Then update these methods:

**`getTelephonyProvider(hubId?)`:**
```typescript
async getTelephonyProvider(hubId?: string): Promise<TelephonyProviderConfig | null> {
  const row = await this.db.select().from(telephonyConfig).where(eq(telephonyConfig.hubId, hubId ?? 'global')).limit(1)
  if (!row[0]?.config) return null
  const configStr = row[0].config as string
  if (!configStr) return null

  // Try decrypt; if AEAD fails, it's plaintext (auto-migrate)
  let json: string
  try {
    json = decryptProviderCredentials(configStr, this.serverSecret)
  } catch {
    // Legacy plaintext — re-encrypt and update
    json = configStr
    const encrypted = encryptProviderCredentials(json, this.serverSecret)
    await this.db.update(telephonyConfig).set({ config: encrypted }).where(eq(telephonyConfig.hubId, hubId ?? 'global'))
  }
  return JSON.parse(json) as TelephonyProviderConfig
}
```

**`updateTelephonyProvider(config, hubId?)`:**
```typescript
async updateTelephonyProvider(config: TelephonyProviderConfig, hubId?: string): Promise<void> {
  const encrypted = encryptProviderCredentials(JSON.stringify(config), this.serverSecret)
  await this.db.insert(telephonyConfig).values({ hubId: hubId ?? 'global', config: encrypted })
    .onConflictDoUpdate({ target: telephonyConfig.hubId, set: { config: encrypted, updatedAt: new Date() } })
}
```

Apply the same pattern to `getMessagingConfig()` / `updateMessagingConfig()`.

For `geocodingConfig.apiKey`, encrypt/decrypt inline in the get/update methods.

- [x] **Step 4: Update SettingsService construction in app.ts/server.ts**

Where SettingsService is created, pass `env.SERVER_NOSTR_SECRET`:

```typescript
const settings = new SettingsService(db, env.SERVER_NOSTR_SECRET)
```

- [x] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [x] **Step 6: Run build**

Run: `bun run build`
Expected: PASS

- [x] **Step 7: Run all tests**

Run: `bunx playwright test tests/credential-encryption.spec.ts --project bridge`
Expected: All PASS

- [x] **Step 8: Commit**

```bash
git add src/server/services/settings.ts src/server/app.ts tests/credential-encryption.spec.ts
git commit -m "feat: encrypt provider credentials at rest in SettingsService"
```

---

### Task 5: Final Verification

- [x] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [x] **Step 2: Run full build**

Run: `bun run build`
Expected: PASS

- [x] **Step 3: Run full E2E suite**

Run: `bunx playwright test --project bridge`
Expected: All bridge tests pass (credential encryption + asterisk + provider oauth)

- [x] **Step 4: Verify no plaintext credentials in new writes**

Start dev server, save a telephony provider config through the UI or API, then check the DB:

```bash
docker exec llamenos-postgres-1 psql -U llamenos -d llamenos -c "SELECT config FROM telephony_config LIMIT 1;"
```

Expected: The `config` column should contain a hex string (not readable JSON).
