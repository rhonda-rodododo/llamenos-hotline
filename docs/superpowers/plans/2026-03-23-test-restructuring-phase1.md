# Test Suite Restructuring — Phase 1: Infrastructure + Convention

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the three-suite test architecture (unit/API/UI), create the `authedRequest` helper, migrate existing unit tests to colocated positions, and update project conventions.

**Architecture:** Split Playwright config into `api` (no browser) and `ui` (Chromium) projects. Create a headless Schnorr auth helper that imports `createAuthToken` from `src/client/lib/crypto.ts` directly. Move 9 existing unit tests from `src/server/__tests__/` and `tests/` to colocated `.test.ts` files next to the modules they test.

**Tech Stack:** Playwright (projects config), `bun:test` (unit runner), `@noble/curves` + `nostr-tools` (headless auth)

**Spec:** `docs/superpowers/specs/2026-03-23-test-suite-restructuring-design.md`

---

### Task 1: Create directory structure and authedRequest helper

**Files:**
- Create: `tests/api/.gitkeep`
- Create: `tests/ui/.gitkeep`
- Create: `tests/helpers/authed-request.ts`

- [ ] **Step 1: Create the `tests/api/` and `tests/ui/` directories**

```bash
mkdir -p tests/api tests/ui
touch tests/api/.gitkeep tests/ui/.gitkeep
```

- [ ] **Step 2: Write `tests/helpers/authed-request.ts`**

This helper enables headless API testing with Schnorr auth. It imports `createAuthToken` directly from the client crypto module (which is pure `@noble/*` + `nostr-tools`, no browser APIs).

```typescript
/**
 * Headless authenticated request helper for API integration tests.
 *
 * Replaces the page.evaluate(apiCall) pattern by generating Schnorr auth
 * tokens directly in Node/Bun, without needing a browser context.
 */
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { getPublicKey, nip19 } from 'nostr-tools'
import { createAuthToken } from '../../src/client/lib/crypto'

interface RequestOpts {
  headers?: Record<string, string>
}

export interface AuthedRequest {
  get(path: string, opts?: RequestOpts): Promise<APIResponse>
  post(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  put(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  patch(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  delete(path: string, opts?: RequestOpts): Promise<APIResponse>
  /** The hex public key derived from the secret key */
  pubkey: string
}

/**
 * Create an authenticated request wrapper around Playwright's APIRequestContext.
 *
 * @param request - Playwright's request fixture
 * @param secretKey - Nostr secret key as Uint8Array (32 bytes)
 * @returns AuthedRequest with methods that auto-sign each request
 */
export function createAuthedRequest(
  request: APIRequestContext,
  secretKey: Uint8Array,
): AuthedRequest {
  const pubkey = getPublicKey(secretKey)

  function authHeaders(method: string, path: string, extra?: Record<string, string>): Record<string, string> {
    const token = createAuthToken(secretKey, Date.now(), method, path)
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  return {
    pubkey,
    get(path, opts?) {
      return request.get(path, { headers: authHeaders('GET', path, opts?.headers) })
    },
    post(path, data?, opts?) {
      return request.post(path, {
        headers: authHeaders('POST', path, opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    put(path, data?, opts?) {
      return request.put(path, {
        headers: authHeaders('PUT', path, opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    patch(path, data?, opts?) {
      return request.patch(path, {
        headers: authHeaders('PATCH', path, opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    delete(path, opts?) {
      return request.delete(path, { headers: authHeaders('DELETE', path, opts?.headers) })
    },
  }
}

/**
 * Create an AuthedRequest from an nsec string.
 * Convenience wrapper for tests that have an nsec rather than raw bytes.
 */
export function createAuthedRequestFromNsec(
  request: APIRequestContext,
  nsec: string,
): AuthedRequest {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error(`Expected nsec, got ${decoded.type}`)
  return createAuthedRequest(request, decoded.data)
}
```

- [ ] **Step 3: Verify the helper compiles**

```bash
bunx tsc --noEmit tests/helpers/authed-request.ts
```

Note: This may fail because `tests/` is not in tsconfig `include`. If so, verify by importing from a test file later. The key check is that `src/client/lib/crypto.ts` can be imported from Node/Bun context — run:

```bash
bun -e "const { createAuthToken } = await import('./src/client/lib/crypto'); console.log(typeof createAuthToken)"
```

Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add tests/api/ tests/ui/ tests/helpers/authed-request.ts
git commit -m "feat: add authedRequest helper and api/ui test directories"
```

---

### Task 2: Restructure playwright.config.ts

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Update playwright.config.ts with new project structure**

Replace the existing `projects` array and `testDir`/`testIgnore` with:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/live/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 3 : parseInt(process.env.PLAYWRIGHT_WORKERS || '1'),
  reporter: "html",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
    },
    {
      name: "api",
      testDir: "./tests/api",
      use: { /* no device — request fixture only */ },
      dependencies: ["setup"],
    },
    {
      name: "ui",
      testDir: "./tests/ui",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /bootstrap\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      // Bootstrap tests run after main UI tests to avoid admin-deletion race conditions
      name: "bootstrap",
      testDir: "./tests/ui",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /bootstrap\.spec\.ts/,
      dependencies: ["ui"],
    },
    {
      name: "mobile",
      testDir: "./tests/ui",
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      // Bridge integration tests — no browser, no webserver, no global setup needed
      name: "bridge",
      testMatch: /asterisk-auto-config\.spec\.ts/,
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "bun run build && bun run start",
        url: "http://localhost:3000/api/health/ready",
        reuseExistingServer: !process.env.CI,
      },
});
```

Key changes from original:
- Removed `**/unit/**` from `testIgnore` (no longer needed — unit tests use bun:test, not Playwright)
- `api` project: `testDir: "./tests/api"`, no device
- `ui` project: `testDir: "./tests/ui"`, Desktop Chrome
- `bootstrap`, `mobile`: also use `testDir: "./tests/ui"`
- `bridge`: narrowed regex from `/asterisk-.*\.spec\.ts|provider-capabilities\.spec\.ts|provider-health\.spec\.ts/` to just `/asterisk-auto-config\.spec\.ts/` (provider tests are migrated to bun:test in Tasks 6-7 before this matters; during the brief window between config change and migration, they'll run under `chromium` instead of `bridge` — still works, just slightly more overhead)

**IMPORTANT:** During Phase 1, the `ui` testDir points to `./tests/ui` which is currently empty. The existing tests in `./tests/*.spec.ts` won't run until Phase 2 moves them. To avoid breaking existing tests during Phase 1, we need a temporary `chromium` project that still reads from `./tests/`:

Add this project temporarily (remove in Phase 2):

```typescript
    {
      // TEMPORARY: runs existing tests from tests/ root until Phase 2 moves them to tests/ui/
      // Excludes api/ and ui/ subdirs to avoid duplicate execution with dedicated projects
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/bootstrap\.spec\.ts/, /asterisk-auto-config\.spec\.ts/, /api\//, /ui\//],
      dependencies: ["setup"],
    },
```

And update bootstrap to depend on `chromium` instead of `ui`:

```typescript
    {
      name: "bootstrap",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /bootstrap\.spec\.ts/,
      dependencies: ["chromium"],
    },
```

- [ ] **Step 2: Verify config is valid**

```bash
bunx playwright test --list
```

Expected: lists all existing tests under the `chromium` project, `api` and `ui` projects show 0 tests (empty directories).

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "feat: restructure playwright config with api/ui/bridge projects"
```

---

### Task 3: Add a smoke test to tests/api/ to verify the API project works

**Files:**
- Create: `tests/api/health.spec.ts`

- [ ] **Step 1: Write a simple API smoke test**

Move the core of `health-config.spec.ts` to `tests/api/health.spec.ts` as a proof that the `api` project works:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Health endpoints (API suite)', () => {
  test('GET /api/health returns status and checks', async ({ request }) => {
    const res = await request.get('/api/health')
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body).toHaveProperty('status')
    expect(['ok', 'degraded']).toContain(body.status)
    expect(body).toHaveProperty('checks')
  })

  test('GET /api/health/live always returns 200', async ({ request }) => {
    const res = await request.get('/api/health/live')
    expect(res.status()).toBe(200)
  })
})
```

- [ ] **Step 2: Run just the API project to verify it works without a browser**

```bash
bunx playwright test --project=api
```

Expected: 2 tests pass, no browser launched.

- [ ] **Step 3: Commit**

```bash
git add tests/api/health.spec.ts
git commit -m "test: add API suite smoke test for health endpoints"
```

---

### Task 4: Migrate 6 existing unit tests to colocated positions

**Files:**
- Move: `src/server/__tests__/crypto-labels.test.ts` → `src/shared/crypto-labels.test.ts`
- Move: `src/server/__tests__/custom-fields.test.ts` → `src/shared/custom-fields.test.ts`
- Move: `src/server/__tests__/audit-chain.test.ts` → `src/server/services/records.test.ts`
- Move: `src/server/__tests__/webauthn-counter.test.ts` → `src/server/services/identity.test.ts`
- Move: `src/server/__tests__/rate-limiter.test.ts` → `src/server/services/settings-rate-limiter.test.ts`
- Move: `src/server/__tests__/hub-key-envelopes.test.ts` → `src/server/services/settings-hub-keys.test.ts`
- Delete: `src/server/__tests__/` directory

- [ ] **Step 1: Move shared tests**

```bash
mv src/server/__tests__/crypto-labels.test.ts src/shared/crypto-labels.test.ts
mv src/server/__tests__/custom-fields.test.ts src/shared/custom-fields.test.ts
```

No import path changes needed — these already use `@shared/` aliases.

- [ ] **Step 2: Move service tests**

```bash
mv src/server/__tests__/audit-chain.test.ts src/server/services/records.test.ts
mv src/server/__tests__/webauthn-counter.test.ts src/server/services/identity.test.ts
mv src/server/__tests__/rate-limiter.test.ts src/server/services/settings-rate-limiter.test.ts
mv src/server/__tests__/hub-key-envelopes.test.ts src/server/services/settings-hub-keys.test.ts
```

**Update migration paths** in the 4 service tests. Each test has:
```typescript
await migrate(db, { migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations') })
```

Since files moved from `src/server/__tests__/` (3 levels deep) to `src/server/services/` (also 3 levels deep from root), the relative path `../../../drizzle/migrations` remains correct. **No changes needed.**

- [ ] **Step 3: Remove the empty `__tests__` directory**

```bash
rmdir src/server/__tests__/
```

- [ ] **Step 4: Run unit tests from new locations**

```bash
bun test src/
```

Expected: All 6 test files discovered and pass. The shared tests (crypto-labels, custom-fields) should pass without Postgres. The service tests need Postgres running (`bun run dev:docker` first).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move unit tests to colocated positions next to source"
```

---

### Task 5: Migrate credential-encryption from Playwright to bun:test

**Files:**
- Create: `src/server/lib/crypto.test.ts`
- Delete: `tests/credential-encryption.spec.ts`

- [ ] **Step 1: Create `src/server/lib/crypto.test.ts`**

Rewrite from Playwright's `test`/`expect` to `bun:test`:

```typescript
import { describe, expect, test } from 'bun:test'
import { encryptProviderCredentials, decryptProviderCredentials } from './crypto'

describe('provider credential encryption', () => {
  const TEST_SECRET = 'a'.repeat(64)

  test('encrypt then decrypt roundtrip', () => {
    const plaintext = JSON.stringify({ accountSid: 'AC123', authToken: 'secret-token-here' })
    const encrypted = encryptProviderCredentials(plaintext, TEST_SECRET)
    expect(encrypted).not.toBe(plaintext)
    expect(encrypted).toMatch(/^[0-9a-f]+$/)
    const decrypted = decryptProviderCredentials(encrypted, TEST_SECRET)
    expect(decrypted).toBe(plaintext)
  })

  test('decrypt with wrong key throws', () => {
    const encrypted = encryptProviderCredentials('secret data', TEST_SECRET)
    const wrongKey = 'b'.repeat(64)
    expect(() => decryptProviderCredentials(encrypted, wrongKey)).toThrow()
  })

  test('each encryption produces different ciphertext (random nonce)', () => {
    const plaintext = 'same input'
    const a = encryptProviderCredentials(plaintext, TEST_SECRET)
    const b = encryptProviderCredentials(plaintext, TEST_SECRET)
    expect(a).not.toBe(b)
  })

  test('encrypted output is nonce (48 hex = 24 bytes) + ciphertext', () => {
    const encrypted = encryptProviderCredentials('test', TEST_SECRET)
    expect(encrypted.length).toBeGreaterThan(48 + 32)
  })
})
```

- [ ] **Step 2: Delete the old Playwright version**

```bash
rm tests/credential-encryption.spec.ts
```

- [ ] **Step 3: Run the new test**

```bash
bun test src/server/lib/crypto.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/lib/crypto.test.ts
git add tests/credential-encryption.spec.ts
git commit -m "refactor: migrate credential-encryption tests to colocated bun:test"
```

---

### Task 6: Migrate provider-health from Playwright to bun:test

**Files:**
- Create: `src/server/services/provider-health.test.ts`
- Delete: `tests/provider-health.spec.ts`

- [ ] **Step 1: Create `src/server/services/provider-health.test.ts`**

```typescript
import { describe, expect, test } from 'bun:test'
import { ProviderHealthService } from './provider-health'

describe('ProviderHealthService', () => {
  test('healthy status when testConnection succeeds', async () => {
    const service = new ProviderHealthService()
    const mockAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 42 }
      },
    }

    const result = await service.checkProvider('telephony', 'active', mockAdapter)
    expect(result.status).toBe('healthy')
    expect(result.latencyMs).toBe(42)
    expect(result.consecutiveFailures).toBe(0)
    expect(result.error).toBeUndefined()
    expect(result.provider).toBe('active')

    const status = service.getHealthStatus()
    expect(status.telephony).not.toBeNull()
    expect(status.telephony!.status).toBe('healthy')
  })

  test('degraded after first failure, down after 3 consecutive failures', async () => {
    const service = new ProviderHealthService()

    const healthyAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 10 }
      },
    }
    await service.checkProvider('telephony', 'active', healthyAdapter)

    const failingAdapter = {
      async testConnection() {
        return { connected: false, latencyMs: 0, error: 'timeout' }
      },
    }

    const r1 = await service.checkProvider('telephony', 'active', failingAdapter)
    expect(r1.status).toBe('degraded')
    expect(r1.consecutiveFailures).toBe(1)

    const r2 = await service.checkProvider('telephony', 'active', failingAdapter)
    expect(r2.status).toBe('degraded')
    expect(r2.consecutiveFailures).toBe(2)

    const r3 = await service.checkProvider('telephony', 'active', failingAdapter)
    expect(r3.status).toBe('down')
    expect(r3.consecutiveFailures).toBe(3)
    expect(r3.error).toBe('timeout')

    const status = service.getHealthStatus()
    expect(status.telephony!.status).toBe('down')
  })

  test('recovery from down to healthy resets failure count', async () => {
    const service = new ProviderHealthService()

    const failingAdapter = {
      async testConnection() {
        return { connected: false, latencyMs: 0, error: 'timeout' }
      },
    }
    for (let i = 0; i < 3; i++) {
      await service.checkProvider('telephony', 'active', failingAdapter)
    }
    expect(service.getHealthStatus().telephony!.status).toBe('down')

    const healthyAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 15 }
      },
    }
    const recovered = await service.checkProvider('telephony', 'active', healthyAdapter)
    expect(recovered.status).toBe('healthy')
    expect(recovered.consecutiveFailures).toBe(0)
    expect(recovered.latencyMs).toBe(15)
  })

  test('messaging channels tracked separately', async () => {
    const service = new ProviderHealthService()

    const smsAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 20 }
      },
    }
    const whatsappAdapter = {
      async testConnection() {
        return { connected: false, latencyMs: 0, error: 'not configured' }
      },
    }

    await service.checkProvider('messaging', 'sms', smsAdapter)
    await service.checkProvider('messaging', 'whatsapp', whatsappAdapter)

    const status = service.getHealthStatus()
    expect(status.messaging.sms.status).toBe('healthy')
    expect(status.messaging.whatsapp.status).toBe('degraded')
    expect(status.telephony).toBeNull()
  })

  test('start and stop control periodic checks', async () => {
    const service = new ProviderHealthService()

    let checkCount = 0
    const checkFn = async () => {
      checkCount++
    }

    service.start(checkFn, 50)
    await new Promise((r) => setTimeout(r, 120))
    expect(checkCount).toBeGreaterThanOrEqual(2)

    const countBefore = checkCount
    service.stop()

    await new Promise((r) => setTimeout(r, 100))
    expect(checkCount).toBeLessThanOrEqual(countBefore + 1)
  })
})
```

- [ ] **Step 2: Delete old Playwright version**

```bash
rm tests/provider-health.spec.ts
```

- [ ] **Step 3: Run the new test**

```bash
bun test src/server/services/provider-health.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/provider-health.test.ts
git add tests/provider-health.spec.ts
git commit -m "refactor: migrate provider-health tests to colocated bun:test"
```

---

### Task 7: Migrate provider-capabilities from Playwright to bun:test

**Files:**
- Create: `src/server/telephony/provider-capabilities.test.ts`
- Delete: `tests/provider-capabilities.spec.ts`

- [ ] **Step 1: Read the full `tests/provider-capabilities.spec.ts`**

Read the entire file to understand all test cases. It uses `startMockApi()` with Node.js `http.createServer` (works in bun:test) and tests Zod schemas + `testConnection()` methods.

- [ ] **Step 2: Create `src/server/telephony/provider-capabilities.test.ts`**

```typescript
import { describe, expect, test } from 'bun:test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { TwilioConfigSchema, TelephonyProviderConfigSchema, TelnyxConfigSchema } from '@shared/schemas/providers'
import { twilioCapabilities } from './twilio-capabilities'
import { signalwireCapabilities } from './signalwire-capabilities'
import { vonageCapabilities } from './vonage-capabilities'
import { plivoCapabilities } from './plivo-capabilities'
import { telnyxCapabilities } from './telnyx-capabilities'
import { asteriskCapabilities } from './asterisk-capabilities'
import { TELEPHONY_CAPABILITIES } from './capabilities'
import { MESSAGING_CAPABILITIES } from '../messaging/capabilities'

async function startMockApi(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    stop: () => new Promise((r, e) => server.close((err) => (err ? e(err) : r()))),
  }
}

describe('provider Zod schemas', () => {
  test('TwilioConfigSchema validates correct config', () => {
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(true)
  })

  test('TwilioConfigSchema rejects invalid accountSid', () => {
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'INVALID',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })

  test('TelephonyProviderConfigSchema discriminates by type', () => {
    const twilio = TelephonyProviderConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(twilio.success).toBe(true)

    const asterisk = TelephonyProviderConfigSchema.safeParse({
      type: 'asterisk',
      phoneNumber: '+15551234567',
      ariUrl: 'http://localhost:8088/ari',
      ariUsername: 'admin',
      ariPassword: 'secret',
    })
    expect(asterisk.success).toBe(true)

    const invalid = TelephonyProviderConfigSchema.safeParse({
      type: 'unknown_provider',
      phoneNumber: '+15551234567',
    })
    expect(invalid.success).toBe(false)
  })

  test('rejects phone numbers not in E.164 format', () => {
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '5551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })

  test('TelnyxConfigSchema validates', () => {
    const result = TelnyxConfigSchema.safeParse({
      type: 'telnyx',
      phoneNumber: '+15551234567',
      apiKey: 'KEY01234567890ABCDEF',
    })
    expect(result.success).toBe(true)
  })
})

describe('Twilio capabilities', () => {
  test('testConnection succeeds with valid credentials', async () => {
    const mock = await startMockApi((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sid: 'AC123', friendly_name: 'Test Account', status: 'active' }))
    })
    try {
      const result = await twilioCapabilities.testConnection({
        type: 'twilio',
        phoneNumber: '+15551234567',
        accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
        authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        _testBaseUrl: `http://127.0.0.1:${mock.port}`,
      } as Parameters<typeof twilioCapabilities.testConnection>[0])
      expect(result.connected).toBe(true)
      expect(result.accountName).toBe('Test Account')
      expect(result.latencyMs).toBeGreaterThan(0)
    } finally {
      await mock.stop()
    }
  })

  test('testConnection fails with 401', async () => {
    const mock = await startMockApi((req, res) => {
      res.writeHead(401)
      res.end('Unauthorized')
    })
    try {
      const result = await twilioCapabilities.testConnection({
        type: 'twilio',
        phoneNumber: '+15551234567',
        accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
        authToken: 'wrong',
        _testBaseUrl: `http://127.0.0.1:${mock.port}`,
      } as Parameters<typeof twilioCapabilities.testConnection>[0])
      expect(result.connected).toBe(false)
      expect(result.errorType).toBe('invalid_credentials')
    } finally {
      await mock.stop()
    }
  })

  test('getWebhookUrls returns correct paths', () => {
    const urls = twilioCapabilities.getWebhookUrls('https://hotline.example.com', 'hub-123')
    expect(urls.voiceIncoming).toBe('https://hotline.example.com/api/telephony/incoming?hub=hub-123')
    expect(urls.smsIncoming).toBe('https://hotline.example.com/api/messaging/sms/webhook?hub=hub-123')
  })
})

// Parameterized tests for other providers
const providerTests = [
  {
    name: 'signalwire',
    capabilities: signalwireCapabilities,
    config: (port: number) => ({
      type: 'signalwire' as const, phoneNumber: '+15551234567',
      accountSid: 'test', authToken: 'test', signalwireSpace: 'testspace',
      _testBaseUrl: `http://127.0.0.1:${port}/api/laml`,
    }),
    successResponse: { sid: 'test', friendly_name: 'SW Account', status: 'active' },
  },
  {
    name: 'vonage',
    capabilities: vonageCapabilities,
    config: (port: number) => ({
      type: 'vonage' as const, phoneNumber: '+15551234567',
      apiKey: 'key', apiSecret: 'secret',
      applicationId: '550e8400-e29b-41d4-a716-446655440000',
      _testBaseUrl: `http://127.0.0.1:${port}`,
    }),
    successResponse: { value: 12.5 },
  },
  {
    name: 'plivo',
    capabilities: plivoCapabilities,
    config: (port: number) => ({
      type: 'plivo' as const, phoneNumber: '+15551234567',
      authId: 'test', authToken: 'test',
      _testBaseUrl: `http://127.0.0.1:${port}`,
    }),
    successResponse: { account_type: 'standard', cash_credits: '10.00' },
  },
  {
    name: 'telnyx',
    capabilities: telnyxCapabilities,
    config: (port: number) => ({
      type: 'telnyx' as const, phoneNumber: '+15551234567',
      apiKey: 'KEY_TEST',
      _testBaseUrl: `http://127.0.0.1:${port}`,
    }),
    successResponse: { data: [] },
  },
] as const

for (const p of providerTests) {
  describe(`${p.name} capabilities`, () => {
    test('testConnection succeeds', async () => {
      const mock = await startMockApi((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(p.successResponse))
      })
      try {
        const result = await p.capabilities.testConnection(p.config(mock.port) as any)
        expect(result.connected).toBe(true)
      } finally {
        await mock.stop()
      }
    })

    test('testConnection fails with 401', async () => {
      const mock = await startMockApi((req, res) => {
        res.writeHead(401)
        res.end('Unauthorized')
      })
      try {
        const result = await p.capabilities.testConnection(p.config(mock.port) as any)
        expect(result.connected).toBe(false)
        expect(result.errorType).toBe('invalid_credentials')
      } finally {
        await mock.stop()
      }
    })
  })
}

describe('asterisk capabilities', () => {
  test('testConnection rejects loopback addresses', async () => {
    const result = await asteriskCapabilities.testConnection({
      type: 'asterisk', phoneNumber: '+15551234567',
      ariUrl: 'http://127.0.0.1:8089/ari', ariUsername: 'llamenos', ariPassword: 'changeme',
    } as Parameters<typeof asteriskCapabilities.testConnection>[0])
    expect(result.connected).toBe(false)
    expect(result.errorType).toBe('invalid_credentials')
    expect(result.error).toContain('Loopback')
  })

  test('testConnection rejects localhost', async () => {
    const result = await asteriskCapabilities.testConnection({
      type: 'asterisk', phoneNumber: '+15551234567',
      ariUrl: 'http://localhost:8089/ari', ariUsername: 'llamenos', ariPassword: 'changeme',
    } as Parameters<typeof asteriskCapabilities.testConnection>[0])
    expect(result.connected).toBe(false)
    expect(result.errorType).toBe('invalid_credentials')
  })
})

test('TELEPHONY_CAPABILITIES has all provider types', () => {
  expect(Object.keys(TELEPHONY_CAPABILITIES)).toEqual(
    expect.arrayContaining(['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk', 'telnyx']),
  )
  for (const caps of Object.values(TELEPHONY_CAPABILITIES)) {
    expect(caps.displayName).toBeTruthy()
    expect(caps.credentialSchema).toBeTruthy()
    expect(typeof caps.testConnection).toBe('function')
    expect(typeof caps.getWebhookUrls).toBe('function')
  }
})

test('MESSAGING_CAPABILITIES has all channel types', () => {
  expect(Object.keys(MESSAGING_CAPABILITIES)).toEqual(
    expect.arrayContaining(['sms', 'whatsapp', 'signal', 'rcs']),
  )
})
```

Key changes from Playwright version:
- `@playwright/test` → `bun:test`
- Dynamic `await import(p.importPath)` → direct imports with `p.capabilities` reference
- `test.describe` → `describe`
- Relative paths from `../src/server/telephony/` → `./` (colocated)
- Removed unnecessary `async` from synchronous Zod tests

- [ ] **Step 3: Delete old Playwright version**

```bash
rm tests/provider-capabilities.spec.ts
```

- [ ] **Step 4: Run the new test**

```bash
bun test src/server/telephony/provider-capabilities.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/telephony/provider-capabilities.test.ts
git add tests/provider-capabilities.spec.ts
git commit -m "refactor: migrate provider-capabilities tests to colocated bun:test"
```

---

### Task 8: Update package.json scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update scripts section**

Change:
```json
"test": "bunx playwright test",
"test:unit": "bun test src/server/__tests__/",
"test:live": "bunx playwright test --config playwright.live.config.ts",
"test:ui": "bunx playwright test --ui",
```

To:
```json
"test": "bunx playwright test",
"test:unit": "bun test src/",
"test:api": "bunx playwright test --project=api",
"test:e2e": "bunx playwright test --project=ui",
"test:interactive": "bunx playwright test --ui",
"test:live": "bunx playwright test --config playwright.live.config.ts",
"test:all": "bun test src/ && bunx playwright test",
```

- [ ] **Step 2: Verify scripts work**

```bash
bun run test:unit
```

Expected: discovers all `.test.ts` files under `src/` and runs them.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: update test scripts for three-suite architecture"
```

---

### Task 9: Update CLAUDE.md testing guidance

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the testing section in CLAUDE.md**

Find the existing testing-related content and replace with updated guidance. The key sections to update:

1. Replace `"test:ui": "bunx playwright test --ui"` references with new script names
2. Add the three-suite testing section after the Development Commands:

```markdown
## Testing

Three test suites with distinct purposes:

- **Unit tests** (`bun test`): Colocated `*.test.ts` files next to source.
  Pure logic, use `bun:test` imports. Some tests require Postgres
  (start backing services with `bun run dev:docker` first).
- **API integration tests** (`bunx playwright test --project=api`):
  Tests in `tests/api/`. HTTP requests against running server, no browser.
  Use `authedRequest` helper for authenticated endpoints.
- **UI E2E tests** (`bunx playwright test --project=ui`):
  Tests in `tests/ui/`. Full browser interaction via Playwright.

Decision guide:
- Testing a pure function or class? → colocated `.test.ts` with `bun:test`
- Testing an API endpoint's behavior? → `tests/api/`
- Testing what a user sees and clicks? → `tests/ui/`

Run the appropriate suite during development:
- `bun test` for unit changes
- `bunx playwright test --project=api` for backend changes
- Full suite before committing
```

2. Update the Development Commands section to reflect new script names:

```bash
bun run test:unit                        # Run colocated unit tests (bun:test)
bun run test:api                         # Run API integration tests (no browser)
bun run test:e2e                         # Run UI E2E tests (Chromium)
bun run test:interactive                 # Playwright interactive UI mode
bun run test:all                         # Run all tests (unit + playwright)
bunx playwright test                     # Run all Playwright suites
bunx playwright test tests/ui/smoke.spec.ts  # Run a single test file
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with three-suite testing guidance"
```

---

### Task 10: Full verification

- [ ] **Step 1: Run all unit tests**

```bash
bun test src/
```

Expected: All colocated `.test.ts` files pass (shared tests always, service tests need Postgres).

- [ ] **Step 2: Run API project**

```bash
bunx playwright test --project=api
```

Expected: Health smoke test passes, no browser launched.

- [ ] **Step 3: Run existing tests still work via chromium project**

```bash
bunx playwright test --project=chromium --grep "app loads"
```

Expected: smoke test passes — existing tests still discoverable via temporary `chromium` project.

- [ ] **Step 4: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

Expected: Both pass.

- [ ] **Step 5: Commit any final fixes**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address Phase 1 verification issues"
```
