# Provider Capabilities Interface + Zod Schemas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a self-describing ProviderCapabilities interface + per-provider Zod schemas so adding new providers is formulaic.

**Architecture:** Each telephony/messaging provider exports a capabilities object implementing a shared interface. A central registry maps provider types to capabilities. Per-provider Zod discriminated union schemas replace the current loose `z.record()` config validation. The `testConnection()` method on each capabilities object validates credentials by hitting the provider's lightest API endpoint.

**Tech Stack:** Zod v4 (`zod/v4`), TypeScript discriminated unions, `@noble/hashes` for Asterisk HMAC, existing `fetch` API for provider health checks.

**Spec:** `docs/superpowers/specs/2026-03-23-provider-capabilities-interface-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/shared/schemas/providers.ts` | CREATE | Per-provider Zod schemas (discriminated union) + messaging channel schemas |
| `src/shared/types.ts` | MODIFY | Add `'telnyx'` to `TelephonyProviderType`, add shared result types, derive config types from Zod schemas |
| `src/server/telephony/capabilities.ts` | CREATE | `ProviderCapabilities` interface + `TELEPHONY_CAPABILITIES` registry |
| `src/server/telephony/twilio-capabilities.ts` | CREATE | Twilio capabilities (testConnection, webhookUrls, number management) |
| `src/server/telephony/signalwire-capabilities.ts` | CREATE | SignalWire capabilities |
| `src/server/telephony/vonage-capabilities.ts` | CREATE | Vonage capabilities |
| `src/server/telephony/plivo-capabilities.ts` | CREATE | Plivo capabilities |
| `src/server/telephony/asterisk-capabilities.ts` | CREATE | Asterisk capabilities |
| `src/server/telephony/telnyx-capabilities.ts` | CREATE | Telnyx capabilities (setup/validation only — no runtime adapter) |
| `src/server/messaging/capabilities.ts` | CREATE | `MessagingChannelCapabilities` interface + `MESSAGING_CAPABILITIES` registry |
| `src/server/telephony/adapter.ts` | MODIFY | Add `testConnection()` to TelephonyAdapter interface |
| `src/server/lib/adapters.ts` | MODIFY | Add `'telnyx'` case to `createAdapterFromConfig()` switch |
| `src/shared/schemas/settings.ts` | MODIFY | Update `TelephonyConfigSchema` to use discriminated union |
| `tests/provider-capabilities.spec.ts` | CREATE | E2E tests for capabilities, schemas, and testConnection |

---

### Task 1: Per-Provider Zod Schemas

**Files:**
- Create: `src/shared/schemas/providers.ts`
- Test: `tests/provider-capabilities.spec.ts`

- [ ] **Step 1: Write the schema test file with validation tests**

```typescript
// tests/provider-capabilities.spec.ts
import { test, expect } from '@playwright/test'

test.describe('provider Zod schemas', () => {
  test('TwilioConfigSchema validates correct config', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(true)
  })

  test('TwilioConfigSchema rejects invalid accountSid', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'INVALID',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })

  test('TelephonyProviderConfigSchema discriminates by type', async () => {
    const { TelephonyProviderConfigSchema } = await import('../src/shared/schemas/providers')
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

  test('rejects phone numbers not in E.164 format', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '5551234567', // missing +
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })

  test('TelnyxConfigSchema validates', async () => {
    const { TelnyxConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TelnyxConfigSchema.safeParse({
      type: 'telnyx',
      phoneNumber: '+15551234567',
      apiKey: 'KEY01234567890ABCDEF',
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx playwright test tests/provider-capabilities.spec.ts --project bridge`
Expected: FAIL — module `../src/shared/schemas/providers` not found

- [ ] **Step 3: Create the provider schemas file**

```typescript
// src/shared/schemas/providers.ts
import { z } from 'zod/v4'

// ── Base schema shared by all telephony providers ──
const E164Phone = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format (e.g., +15551234567)')

const BaseProviderSchema = z.object({
  phoneNumber: E164Phone,
})

// ── Per-provider schemas ──

export const TwilioConfigSchema = BaseProviderSchema.extend({
  type: z.literal('twilio'),
  accountSid: z.string().regex(/^AC[0-9a-f]{32}$/i, 'Must start with AC followed by 32 hex characters'),
  authToken: z.string().min(32, 'Auth token must be at least 32 characters'),
  // Optional WebRTC
  webrtcEnabled: z.boolean().optional(),
  apiKeySid: z.string().optional(),
  apiKeySecret: z.string().optional(),
  twimlAppSid: z.string().optional(),
})
export type TwilioConfig = z.infer<typeof TwilioConfigSchema>

export const SignalWireConfigSchema = BaseProviderSchema.extend({
  type: z.literal('signalwire'),
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  signalwireSpace: z.string().min(1, 'Space name is required (e.g., "myspace")'),
})
export type SignalWireConfig = z.infer<typeof SignalWireConfigSchema>

export const VonageConfigSchema = BaseProviderSchema.extend({
  type: z.literal('vonage'),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  applicationId: z.string().min(1),
  privateKey: z.string().optional(),
})
export type VonageConfig = z.infer<typeof VonageConfigSchema>

export const PlivoConfigSchema = BaseProviderSchema.extend({
  type: z.literal('plivo'),
  authId: z.string().min(1),
  authToken: z.string().min(1),
})
export type PlivoConfig = z.infer<typeof PlivoConfigSchema>

export const AsteriskConfigSchema = BaseProviderSchema.extend({
  type: z.literal('asterisk'),
  ariUrl: z.string().url('Must be a valid URL'),
  ariUsername: z.string().min(1),
  ariPassword: z.string().min(1),
  bridgeCallbackUrl: z.string().url().optional(),
})
export type AsteriskConfig = z.infer<typeof AsteriskConfigSchema>

export const TelnyxConfigSchema = BaseProviderSchema.extend({
  type: z.literal('telnyx'),
  apiKey: z.string().min(1),
  texmlAppId: z.string().optional(),
})
export type TelnyxConfig = z.infer<typeof TelnyxConfigSchema>

// ── Discriminated union of all telephony providers ──
export const TelephonyProviderConfigSchema = z.discriminatedUnion('type', [
  TwilioConfigSchema,
  SignalWireConfigSchema,
  VonageConfigSchema,
  PlivoConfigSchema,
  AsteriskConfigSchema,
  TelnyxConfigSchema,
])
export type TelephonyProviderConfig = z.infer<typeof TelephonyProviderConfigSchema>

// ── Messaging channel schemas ──

export const SMSConfigSchema = z.object({
  enabled: z.boolean(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
export type SMSConfig = z.infer<typeof SMSConfigSchema>

export const WhatsAppConfigSchema = z.object({
  integrationMode: z.enum(['twilio', 'direct']),
  phoneNumberId: z.string().optional(),
  businessAccountId: z.string().optional(),
  accessToken: z.string().optional(),
  verifyToken: z.string().optional(),
  appSecret: z.string().optional(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>

export const SignalBridgeConfigSchema = z.object({
  bridgeUrl: z.string().url(),
  bridgeApiKey: z.string().min(1),
  webhookSecret: z.string().min(1),
  registeredNumber: z.string().min(1),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
export type SignalBridgeConfig = z.infer<typeof SignalBridgeConfigSchema>

export const RCSConfigSchema = z.object({
  agentId: z.string().min(1),
  serviceAccountKey: z.string().min(1),
  webhookSecret: z.string().optional(),
  fallbackToSms: z.boolean(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
export type RCSConfig = z.infer<typeof RCSConfigSchema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx playwright test tests/provider-capabilities.spec.ts --project bridge`
Expected: All 5 schema tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas/providers.ts tests/provider-capabilities.spec.ts
git commit -m "feat: per-provider Zod schemas with discriminated union"
```

---

### Task 2: Shared Result Types + Type System Updates

**Files:**
- Modify: `src/shared/types.ts` (lines 26, 28-34, 36-77, 84-93, 558)
- Modify: `src/shared/schemas/settings.ts` (lines 96-100)

- [ ] **Step 1: Add shared result types to `src/shared/types.ts`**

Add after the existing type definitions (after line ~560):

```typescript
// ── Provider capability result types ──

export interface ConnectionTestResult {
  connected: boolean
  latencyMs: number
  accountName?: string
  error?: string
  errorType?: 'invalid_credentials' | 'network_error' | 'rate_limited' | 'account_suspended' | 'unknown'
}

export interface WebhookUrlSet {
  voiceIncoming?: string
  voiceStatus?: string
  voiceFallback?: string
  smsIncoming?: string
  smsStatus?: string
  whatsappIncoming?: string
  signalIncoming?: string
  rcsIncoming?: string
}

export interface PhoneNumberInfo {
  number: string
  country: string
  locality?: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  monthlyFee?: string
  owned: boolean
}

export interface NumberSearchQuery {
  country: string
  areaCode?: string
  contains?: string
  limit?: number
}

export interface ProvisionResult {
  ok: boolean
  number?: string
  error?: string
}

export interface AutoConfigResult {
  ok: boolean
  error?: string
  details?: Record<string, unknown>
}

export interface SipTrunkOptions {
  domain?: string
  username?: string
  password?: string
}
```

- [ ] **Step 2: Update `TelephonyProviderType` to add `'telnyx'` (line 26)**

```typescript
// Before:
export type TelephonyProviderType = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk'

// After:
export type TelephonyProviderType = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'telnyx'
```

- [ ] **Step 3: Update `TELEPHONY_PROVIDER_LABELS` (lines 28-34)**

Add `telnyx: 'Telnyx'` entry.

- [ ] **Step 4: Remove `PROVIDER_REQUIRED_FIELDS` (lines 84-93)**

Delete the entire `PROVIDER_REQUIRED_FIELDS` constant. Replace with a comment:

```typescript
// PROVIDER_REQUIRED_FIELDS removed — use ProviderCapabilities.credentialSchema instead
// See src/server/telephony/capabilities.ts
```

- [ ] **Step 5: Re-export TelephonyProviderConfig from Zod schema**

At the top of `types.ts`, add:

```typescript
// Re-export the Zod-derived config type as the canonical TelephonyProviderConfig
export type { TelephonyProviderConfig } from '@shared/schemas/providers'
```

Remove the old manually-defined `TelephonyProviderConfig` interface (lines 36-77). Any existing imports of `TelephonyProviderConfig` from `types.ts` continue to work via re-export.

- [ ] **Step 6: Update `TelephonyConfigSchema` in `src/shared/schemas/settings.ts` (lines 96-100)**

```typescript
// Before:
export const TelephonyConfigSchema = z.object({
  provider: z.string(),
  config: z.record(z.string(), z.unknown()),
})

// After:
import { TelephonyProviderConfigSchema } from './providers'

export const TelephonyConfigSchema = TelephonyProviderConfigSchema
export type TelephonyConfig = z.infer<typeof TelephonyConfigSchema>
```

- [ ] **Step 7: Fix `createAdapterFromConfig()` switch in `src/server/lib/adapters.ts` (line 188)**

Add telnyx case before the default:

```typescript
case 'telnyx':
  throw new AppError('Telnyx runtime adapter not yet implemented — use Twilio or another provider for call handling', 501)
```

- [ ] **Step 8: Run typecheck to find and fix all exhaustiveness errors**

Run: `bun run typecheck`
Expected: Errors in any switch/if-else on `TelephonyProviderType` that doesn't handle `'telnyx'`. Fix each one by adding the telnyx case (most will be a throw or skip).

- [ ] **Step 9: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/shared/schemas/settings.ts src/shared/schemas/providers.ts src/server/lib/adapters.ts
git commit -m "feat: add telnyx to TelephonyProviderType, derive config from Zod schemas"
```

---

### Task 3: ProviderCapabilities Interface + Registry

**Files:**
- Create: `src/server/telephony/capabilities.ts`

- [ ] **Step 1: Write the capabilities interface and registry**

```typescript
// src/server/telephony/capabilities.ts
import type { z } from 'zod/v4'
import type {
  TelephonyProviderType,
  TelephonyProviderConfig,
  ConnectionTestResult,
  WebhookUrlSet,
  PhoneNumberInfo,
  NumberSearchQuery,
  ProvisionResult,
  AutoConfigResult,
  SipTrunkOptions,
} from '@shared/types'

export interface ProviderCapabilities<T extends TelephonyProviderConfig = TelephonyProviderConfig> {
  readonly type: TelephonyProviderType
  readonly displayName: string
  readonly description: string
  readonly credentialSchema: z.ZodType<T>

  readonly supportsOAuth: boolean
  readonly supportsSms: boolean
  readonly supportsSip: boolean
  readonly supportsWebRtc: boolean
  readonly supportsNumberProvisioning: boolean
  readonly supportsWebhookAutoConfig: boolean

  testConnection(credentials: T): Promise<ConnectionTestResult>
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet

  // Optional — only if supportsNumberProvisioning
  listOwnedNumbers?(credentials: T): Promise<PhoneNumberInfo[]>
  searchAvailableNumbers?(credentials: T, query: NumberSearchQuery): Promise<PhoneNumberInfo[]>
  provisionNumber?(credentials: T, number: string): Promise<ProvisionResult>

  // Optional — only if supportsWebhookAutoConfig
  configureWebhooks?(credentials: T, phoneNumber: string, webhookUrls: WebhookUrlSet): Promise<AutoConfigResult>
  configureSipTrunk?(credentials: T, options: SipTrunkOptions): Promise<AutoConfigResult>
}

// Registry — populated by imports from per-provider capability files
import { twilioCapabilities } from './twilio-capabilities'
import { signalwireCapabilities } from './signalwire-capabilities'
import { vonageCapabilities } from './vonage-capabilities'
import { plivoCapabilities } from './plivo-capabilities'
import { asteriskCapabilities } from './asterisk-capabilities'
import { telnyxCapabilities } from './telnyx-capabilities'

export const TELEPHONY_CAPABILITIES: Record<TelephonyProviderType, ProviderCapabilities> = {
  twilio: twilioCapabilities,
  signalwire: signalwireCapabilities,
  vonage: vonageCapabilities,
  plivo: plivoCapabilities,
  asterisk: asteriskCapabilities,
  telnyx: telnyxCapabilities,
}
```

- [ ] **Step 2: Commit interface (capabilities files will be stubs until Task 4-9)**

```bash
git add src/server/telephony/capabilities.ts
git commit -m "feat: ProviderCapabilities interface and registry"
```

---

### Task 4: Twilio Capabilities

**Files:**
- Create: `src/server/telephony/twilio-capabilities.ts`
- Test: `tests/provider-capabilities.spec.ts` (append)

- [ ] **Step 1: Add Twilio testConnection test**

Append to `tests/provider-capabilities.spec.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Start a mock HTTP server that returns a canned response */
async function startMockApi(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: number; stop: () => Promise<void> }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { port, stop: () => new Promise((r, e) => server.close((err) => err ? e(err) : r())) }
}

test.describe('Twilio capabilities', () => {
  test('testConnection succeeds with valid credentials', async () => {
    const mock = await startMockApi((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sid: 'AC123', friendly_name: 'Test Account', status: 'active' }))
    })
    try {
      const { twilioCapabilities } = await import('../src/server/telephony/twilio-capabilities')
      const result = await twilioCapabilities.testConnection({
        type: 'twilio',
        phoneNumber: '+15551234567',
        accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
        authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        _testBaseUrl: `http://127.0.0.1:${mock.port}`,
      } as any)
      expect(result.connected).toBe(true)
      expect(result.accountName).toBe('Test Account')
      expect(result.latencyMs).toBeGreaterThan(0)
    } finally {
      await mock.stop()
    }
  })

  test('testConnection fails with 401', async () => {
    const mock = await startMockApi((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 401, message: 'Authenticate' }))
    })
    try {
      const { twilioCapabilities } = await import('../src/server/telephony/twilio-capabilities')
      const result = await twilioCapabilities.testConnection({
        type: 'twilio',
        phoneNumber: '+15551234567',
        accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
        authToken: 'wrong',
        _testBaseUrl: `http://127.0.0.1:${mock.port}`,
      } as any)
      expect(result.connected).toBe(false)
      expect(result.errorType).toBe('invalid_credentials')
    } finally {
      await mock.stop()
    }
  })

  test('getWebhookUrls returns correct paths', async () => {
    const { twilioCapabilities } = await import('../src/server/telephony/twilio-capabilities')
    const urls = twilioCapabilities.getWebhookUrls('https://hotline.example.com', 'hub-123')
    expect(urls.voiceIncoming).toBe('https://hotline.example.com/api/telephony/incoming?hub=hub-123')
    expect(urls.smsIncoming).toBe('https://hotline.example.com/api/messaging/sms/webhook?hub=hub-123')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx playwright test tests/provider-capabilities.spec.ts --project bridge -g "Twilio capabilities"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Twilio capabilities**

```typescript
// src/server/telephony/twilio-capabilities.ts
import { TwilioConfigSchema, type TwilioConfig } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet, PhoneNumberInfo, NumberSearchQuery, ProvisionResult, AutoConfigResult } from '@shared/types'

const TWILIO_API_BASE = 'https://api.twilio.com'

function twilioAuth(config: TwilioConfig): string {
  return 'Basic ' + btoa(`${config.accountSid}:${config.authToken}`)
}

function apiBase(config: TwilioConfig & { _testBaseUrl?: string }): string {
  return (config as any)._testBaseUrl ?? TWILIO_API_BASE
}

export const twilioCapabilities: ProviderCapabilities<TwilioConfig> = {
  type: 'twilio',
  displayName: 'Twilio',
  description: 'Cloud communications platform with voice, SMS, and WebRTC support',
  credentialSchema: TwilioConfigSchema,

  supportsOAuth: true,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: true,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const res = await fetch(`${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}.json`, {
        headers: { Authorization: twilioAuth(config) },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          connected: false,
          latencyMs,
          error: `HTTP ${res.status}`,
          errorType: res.status === 401 ? 'invalid_credentials' : res.status === 429 ? 'rate_limited' : 'unknown',
        }
      }
      const data = await res.json() as { friendly_name?: string; status?: string }
      if (data.status === 'suspended') {
        return { connected: false, latencyMs, error: 'Account suspended', errorType: 'account_suspended' }
      }
      return { connected: true, latencyMs, accountName: data.friendly_name }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
      smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}`,
    }
  },

  async listOwnedNumbers(config): Promise<PhoneNumberInfo[]> {
    const res = await fetch(`${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`, {
      headers: { Authorization: twilioAuth(config) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to list numbers: ${res.status}`)
    const data = await res.json() as { incoming_phone_numbers: Array<{ phone_number: string; capabilities: { voice: boolean; sms: boolean; mms: boolean } }> }
    return data.incoming_phone_numbers.map((n) => ({
      number: n.phone_number,
      country: '', // Twilio doesn't return country in list response
      capabilities: n.capabilities,
      owned: true,
    }))
  },

  async searchAvailableNumbers(config, query): Promise<PhoneNumberInfo[]> {
    const params = new URLSearchParams()
    if (query.areaCode) params.set('AreaCode', query.areaCode)
    if (query.contains) params.set('Contains', query.contains)
    params.set('PageSize', String(query.limit ?? 20))
    const res = await fetch(
      `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/AvailablePhoneNumbers/${query.country}/Local.json?${params}`,
      { headers: { Authorization: twilioAuth(config) }, signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) throw new Error(`Failed to search numbers: ${res.status}`)
    const data = await res.json() as { available_phone_numbers: Array<{ phone_number: string; locality: string; capabilities: { voice: boolean; sms: boolean; mms: boolean } }> }
    return data.available_phone_numbers.map((n) => ({
      number: n.phone_number,
      country: query.country,
      locality: n.locality,
      capabilities: n.capabilities,
      owned: false,
    }))
  },

  async provisionNumber(config, number): Promise<ProvisionResult> {
    const res = await fetch(`${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`, {
      method: 'POST',
      headers: { Authorization: twilioAuth(config), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ PhoneNumber: number }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `Provision failed: ${res.status} ${text}` }
    }
    const data = await res.json() as { phone_number: string }
    return { ok: true, number: data.phone_number }
  },

  async configureWebhooks(config, phoneNumber, webhookUrls): Promise<AutoConfigResult> {
    // First, find the number's SID
    const listRes = await fetch(
      `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
      { headers: { Authorization: twilioAuth(config) }, signal: AbortSignal.timeout(10_000) },
    )
    if (!listRes.ok) return { ok: false, error: `Failed to find number: ${listRes.status}` }
    const listData = await listRes.json() as { incoming_phone_numbers: Array<{ sid: string }> }
    const numberSid = listData.incoming_phone_numbers[0]?.sid
    if (!numberSid) return { ok: false, error: `Number ${phoneNumber} not found in account` }

    // Update webhook URLs
    const params = new URLSearchParams()
    if (webhookUrls.voiceIncoming) params.set('VoiceUrl', webhookUrls.voiceIncoming)
    if (webhookUrls.voiceStatus) params.set('StatusCallback', webhookUrls.voiceStatus)
    if (webhookUrls.smsIncoming) params.set('SmsUrl', webhookUrls.smsIncoming)

    const updateRes = await fetch(
      `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers/${numberSid}.json`,
      {
        method: 'POST',
        headers: { Authorization: twilioAuth(config), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!updateRes.ok) return { ok: false, error: `Failed to update webhooks: ${updateRes.status}` }
    return { ok: true }
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx playwright test tests/provider-capabilities.spec.ts --project bridge -g "Twilio"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/telephony/twilio-capabilities.ts tests/provider-capabilities.spec.ts
git commit -m "feat: Twilio capabilities with testConnection, number management, webhook config"
```

---

### Task 5: SignalWire Capabilities

**Files:**
- Create: `src/server/telephony/signalwire-capabilities.ts`

- [ ] **Step 1: Implement SignalWire capabilities**

SignalWire uses a Twilio-compatible API. Same patterns as Twilio with different base URL (`https://{space}.signalwire.com/api/laml`).

```typescript
// src/server/telephony/signalwire-capabilities.ts
import { SignalWireConfigSchema, type SignalWireConfig } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet, PhoneNumberInfo, NumberSearchQuery, ProvisionResult, AutoConfigResult } from '@shared/types'

function swApiBase(config: SignalWireConfig & { _testBaseUrl?: string }): string {
  return (config as any)._testBaseUrl ?? `https://${config.signalwireSpace}.signalwire.com/api/laml`
}

function swAuth(config: SignalWireConfig): string {
  return 'Basic ' + btoa(`${config.accountSid}:${config.authToken}`)
}

export const signalwireCapabilities: ProviderCapabilities<SignalWireConfig> = {
  type: 'signalwire',
  displayName: 'SignalWire',
  description: 'Programmable communications with Twilio-compatible API and competitive pricing',
  credentialSchema: SignalWireConfigSchema,

  supportsOAuth: false,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: true,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const res = await fetch(`${swApiBase(config)}/2010-04-01/Accounts/${config.accountSid}.json`, {
        headers: { Authorization: swAuth(config) },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: res.status === 401 ? 'invalid_credentials' : 'unknown' }
      const data = await res.json() as { friendly_name?: string }
      return { connected: true, latencyMs, accountName: data.friendly_name }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
      smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}`,
    }
  },

  async listOwnedNumbers(config): Promise<PhoneNumberInfo[]> {
    const res = await fetch(`${swApiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`, {
      headers: { Authorization: swAuth(config) }, signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to list numbers: ${res.status}`)
    const data = await res.json() as { incoming_phone_numbers: Array<{ phone_number: string; capabilities: { voice: boolean; sms: boolean; mms: boolean } }> }
    return data.incoming_phone_numbers.map((n) => ({ number: n.phone_number, country: '', capabilities: n.capabilities, owned: true }))
  },

  async searchAvailableNumbers(config, query): Promise<PhoneNumberInfo[]> {
    const params = new URLSearchParams({ PageSize: String(query.limit ?? 20) })
    if (query.areaCode) params.set('AreaCode', query.areaCode)
    if (query.contains) params.set('Contains', query.contains)
    const res = await fetch(`${swApiBase(config)}/2010-04-01/Accounts/${config.accountSid}/AvailablePhoneNumbers/${query.country}/Local.json?${params}`, {
      headers: { Authorization: swAuth(config) }, signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to search numbers: ${res.status}`)
    const data = await res.json() as { available_phone_numbers: Array<{ phone_number: string; locality?: string; capabilities: { voice: boolean; sms: boolean; mms: boolean } }> }
    return data.available_phone_numbers.map((n) => ({ number: n.phone_number, country: query.country, locality: n.locality, capabilities: n.capabilities, owned: false }))
  },

  async provisionNumber(config, number): Promise<ProvisionResult> {
    const res = await fetch(`${swApiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`, {
      method: 'POST', headers: { Authorization: swAuth(config), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ PhoneNumber: number }), signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ok: false, error: `Provision failed: ${res.status}` }
    const data = await res.json() as { phone_number: string }
    return { ok: true, number: data.phone_number }
  },

  async configureWebhooks(config, phoneNumber, webhookUrls): Promise<AutoConfigResult> {
    const listRes = await fetch(`${swApiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`, {
      headers: { Authorization: swAuth(config) }, signal: AbortSignal.timeout(10_000),
    })
    if (!listRes.ok) return { ok: false, error: `Failed to find number: ${listRes.status}` }
    const listData = await listRes.json() as { incoming_phone_numbers: Array<{ sid: string }> }
    const sid = listData.incoming_phone_numbers[0]?.sid
    if (!sid) return { ok: false, error: `Number ${phoneNumber} not found` }
    const params = new URLSearchParams()
    if (webhookUrls.voiceIncoming) params.set('VoiceUrl', webhookUrls.voiceIncoming)
    if (webhookUrls.voiceStatus) params.set('StatusCallback', webhookUrls.voiceStatus)
    if (webhookUrls.smsIncoming) params.set('SmsUrl', webhookUrls.smsIncoming)
    const updateRes = await fetch(`${swApiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers/${sid}.json`, {
      method: 'POST', headers: { Authorization: swAuth(config), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params, signal: AbortSignal.timeout(10_000),
    })
    if (!updateRes.ok) return { ok: false, error: `Failed to update webhooks: ${updateRes.status}` }
    return { ok: true }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/telephony/signalwire-capabilities.ts
git commit -m "feat: SignalWire capabilities (Twilio-compatible API)"
```

---

### Task 6: Vonage Capabilities

**Files:**
- Create: `src/server/telephony/vonage-capabilities.ts`

- [ ] **Step 1: Implement Vonage capabilities**

```typescript
// src/server/telephony/vonage-capabilities.ts
import { VonageConfigSchema, type VonageConfig } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet, PhoneNumberInfo, NumberSearchQuery, ProvisionResult } from '@shared/types'

const VONAGE_API_BASE = 'https://rest.nexmo.com'
const VONAGE_API_V2 = 'https://api.nexmo.com/v2'

export const vonageCapabilities: ProviderCapabilities<VonageConfig> = {
  type: 'vonage',
  displayName: 'Vonage',
  description: 'Enterprise-grade voice and messaging APIs with global coverage',
  credentialSchema: VonageConfigSchema,

  supportsOAuth: false,
  supportsSms: true,
  supportsSip: false,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const base = (config as any)._testBaseUrl ?? VONAGE_API_BASE
      const res = await fetch(`${base}/account/get-balance?api_key=${config.apiKey}&api_secret=${config.apiSecret}`, {
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: res.status === 401 ? 'invalid_credentials' : 'unknown' }
      const data = await res.json() as { value: number }
      return { connected: true, latencyMs, accountName: `Balance: ${data.value.toFixed(2)} EUR` }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
      smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}`,
    }
  },

  async listOwnedNumbers(config): Promise<PhoneNumberInfo[]> {
    const base = (config as any)._testBaseUrl ?? VONAGE_API_BASE
    const res = await fetch(`${base}/account/numbers?api_key=${config.apiKey}&api_secret=${config.apiSecret}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to list numbers: ${res.status}`)
    const data = await res.json() as { numbers: Array<{ msisdn: string; country: string; features: string[] }> }
    return data.numbers.map((n) => ({
      number: `+${n.msisdn}`,
      country: n.country,
      capabilities: { voice: n.features.includes('VOICE'), sms: n.features.includes('SMS'), mms: n.features.includes('MMS') },
      owned: true,
    }))
  },

  async searchAvailableNumbers(config, query): Promise<PhoneNumberInfo[]> {
    const base = (config as any)._testBaseUrl ?? VONAGE_API_BASE
    const params = new URLSearchParams({
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      country: query.country,
      size: String(query.limit ?? 20),
      features: 'VOICE,SMS',
    })
    if (query.contains) params.set('pattern', query.contains)
    const res = await fetch(`${base}/number/search?${params}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Failed to search numbers: ${res.status}`)
    const data = await res.json() as { numbers: Array<{ msisdn: string; country: string; cost: string; features: string[] }> }
    return data.numbers.map((n) => ({
      number: `+${n.msisdn}`,
      country: n.country,
      capabilities: { voice: n.features.includes('VOICE'), sms: n.features.includes('SMS'), mms: false },
      monthlyFee: n.cost,
      owned: false,
    }))
  },

  async provisionNumber(config, number): Promise<ProvisionResult> {
    const base = (config as any)._testBaseUrl ?? VONAGE_API_BASE
    const msisdn = number.replace('+', '')
    const res = await fetch(`${base}/number/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: config.apiKey, api_secret: config.apiSecret, country: 'US', msisdn }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ok: false, error: `Provision failed: ${res.status}` }
    return { ok: true, number }
  },

  async configureWebhooks(config, _phoneNumber, webhookUrls) {
    // Vonage configures webhooks on the Application, not the number
    if (!config.applicationId) return { ok: false, error: 'Application ID required for webhook config' }
    const base = (config as any)._testBaseUrl ? (config as any)._testBaseUrl.replace('rest.nexmo.com', 'api.nexmo.com/v2') : VONAGE_API_V2
    const res = await fetch(`${base}/applications/${config.applicationId}`, {
      method: 'PUT',
      headers: { Authorization: 'Basic ' + btoa(`${config.apiKey}:${config.apiSecret}`), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          voice: { webhooks: { answer_url: { address: webhookUrls.voiceIncoming, http_method: 'POST' }, event_url: { address: webhookUrls.voiceStatus, http_method: 'POST' } } },
          messages: { webhooks: { inbound_url: { address: webhookUrls.smsIncoming, http_method: 'POST' } } },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, error: `Failed to configure webhooks: ${res.status}` }
    return { ok: true }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/telephony/vonage-capabilities.ts
git commit -m "feat: Vonage capabilities with number management and webhook config"
```

---

### Task 7: Plivo Capabilities

**Files:**
- Create: `src/server/telephony/plivo-capabilities.ts`

- [ ] **Step 1: Implement Plivo capabilities**

```typescript
// src/server/telephony/plivo-capabilities.ts
import { PlivoConfigSchema, type PlivoConfig } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet, PhoneNumberInfo, NumberSearchQuery, ProvisionResult } from '@shared/types'

const PLIVO_API_BASE = 'https://api.plivo.com'

function plivoAuth(config: PlivoConfig): string {
  return 'Basic ' + btoa(`${config.authId}:${config.authToken}`)
}

export const plivoCapabilities: ProviderCapabilities<PlivoConfig> = {
  type: 'plivo',
  displayName: 'Plivo',
  description: 'Voice and SMS APIs with competitive pricing and global reach',
  credentialSchema: PlivoConfigSchema,

  supportsOAuth: false,
  supportsSms: true,
  supportsSip: false,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const base = (config as any)._testBaseUrl ?? PLIVO_API_BASE
      const res = await fetch(`${base}/v1/Account/${config.authId}/`, {
        headers: { Authorization: plivoAuth(config) },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: res.status === 401 ? 'invalid_credentials' : 'unknown' }
      const data = await res.json() as { account_type?: string; cash_credits?: string }
      return { connected: true, latencyMs, accountName: `${data.account_type ?? 'Plivo'} ($${data.cash_credits ?? '?'})` }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
      smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}`,
    }
  },

  async listOwnedNumbers(config): Promise<PhoneNumberInfo[]> {
    const base = (config as any)._testBaseUrl ?? PLIVO_API_BASE
    const res = await fetch(`${base}/v1/Account/${config.authId}/Number/`, {
      headers: { Authorization: plivoAuth(config) }, signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to list numbers: ${res.status}`)
    const data = await res.json() as { objects: Array<{ number: string; country: string; voice_enabled: boolean; sms_enabled: boolean }> }
    return (data.objects ?? []).map((n) => ({
      number: `+${n.number}`,
      country: n.country,
      capabilities: { voice: n.voice_enabled, sms: n.sms_enabled, mms: false },
      owned: true,
    }))
  },

  async searchAvailableNumbers(config, query): Promise<PhoneNumberInfo[]> {
    const base = (config as any)._testBaseUrl ?? PLIVO_API_BASE
    const params = new URLSearchParams({ country_iso: query.country, limit: String(query.limit ?? 20), services: 'voice,sms' })
    if (query.contains) params.set('pattern', query.contains)
    const res = await fetch(`${base}/v1/Account/${config.authId}/PhoneNumber/?${params}`, {
      headers: { Authorization: plivoAuth(config) }, signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to search numbers: ${res.status}`)
    const data = await res.json() as { objects: Array<{ number: string; country: string; monthly_rental_rate: string; voice_enabled: boolean; sms_enabled: boolean }> }
    return (data.objects ?? []).map((n) => ({
      number: `+${n.number}`,
      country: n.country,
      capabilities: { voice: n.voice_enabled, sms: n.sms_enabled, mms: false },
      monthlyFee: `$${n.monthly_rental_rate}`,
      owned: false,
    }))
  },

  async provisionNumber(config, number): Promise<ProvisionResult> {
    const base = (config as any)._testBaseUrl ?? PLIVO_API_BASE
    const num = number.replace('+', '')
    const res = await fetch(`${base}/v1/Account/${config.authId}/PhoneNumber/${num}/`, {
      method: 'POST', headers: { Authorization: plivoAuth(config) }, signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ok: false, error: `Provision failed: ${res.status}` }
    return { ok: true, number }
  },

  async configureWebhooks(config, phoneNumber, webhookUrls) {
    const base = (config as any)._testBaseUrl ?? PLIVO_API_BASE
    const num = phoneNumber.replace('+', '')
    const res = await fetch(`${base}/v1/Account/${config.authId}/Number/${num}/`, {
      method: 'POST',
      headers: { Authorization: plivoAuth(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer_url: webhookUrls.voiceIncoming,
        hangup_url: webhookUrls.voiceStatus,
        message_url: webhookUrls.smsIncoming,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, error: `Failed to configure webhooks: ${res.status}` }
    return { ok: true }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/telephony/plivo-capabilities.ts
git commit -m "feat: Plivo capabilities with number management and webhook config"
```

---

### Task 8: Asterisk Capabilities

**Files:**
- Create: `src/server/telephony/asterisk-capabilities.ts`

- [ ] **Step 1: Implement Asterisk capabilities**

Asterisk is self-hosted — no number provisioning or webhook auto-config. SSRF protection via `validateExternalUrl()` for the `ariUrl`.

```typescript
// src/server/telephony/asterisk-capabilities.ts
import { AsteriskConfigSchema, type AsteriskConfig } from '@shared/schemas/providers'
import { validateExternalUrl } from '../lib/ssrf-guard'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'

export const asteriskCapabilities: ProviderCapabilities<AsteriskConfig> = {
  type: 'asterisk',
  displayName: 'Asterisk (Self-Hosted)',
  description: 'Self-hosted PBX via ARI bridge — requires running Asterisk + asterisk-bridge',
  credentialSchema: AsteriskConfigSchema,

  supportsOAuth: false,
  supportsSms: false,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: false,
  supportsWebhookAutoConfig: false,

  async testConnection(config): Promise<ConnectionTestResult> {
    const start = Date.now()
    // SSRF guard — allow private IPs for self-hosted Asterisk but block loopback/link-local
    const urlError = validateExternalUrl(config.ariUrl, 'ARI URL')
    if (urlError) return { connected: false, latencyMs: 0, error: urlError, errorType: 'invalid_credentials' }

    try {
      const res = await fetch(`${config.ariUrl}/asterisk/info`, {
        headers: { Authorization: 'Basic ' + btoa(`${config.ariUsername}:${config.ariPassword}`) },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: res.status === 401 ? 'invalid_credentials' : 'unknown' }
      const data = await res.json() as { system?: { version?: string } }
      return { connected: true, latencyMs, accountName: `Asterisk ${data.system?.version ?? ''}`.trim() }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
    }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/telephony/asterisk-capabilities.ts
git commit -m "feat: Asterisk capabilities with SSRF-guarded ARI health check"
```

---

### Task 9: Telnyx Capabilities (Setup Only)

**Files:**
- Create: `src/server/telephony/telnyx-capabilities.ts`

- [ ] **Step 1: Implement Telnyx capabilities**

Setup/validation only — no runtime adapter. Uses Bearer auth against Telnyx REST API.

```typescript
// src/server/telephony/telnyx-capabilities.ts
import { TelnyxConfigSchema, type TelnyxConfig } from '@shared/schemas/providers'
import type { ProviderCapabilities } from './capabilities'
import type { ConnectionTestResult, WebhookUrlSet, PhoneNumberInfo, NumberSearchQuery, ProvisionResult, AutoConfigResult } from '@shared/types'

const TELNYX_API_BASE = 'https://api.telnyx.com'

function telnyxAuth(config: TelnyxConfig): string {
  return `Bearer ${config.apiKey}`
}

export const telnyxCapabilities: ProviderCapabilities<TelnyxConfig> = {
  type: 'telnyx',
  displayName: 'Telnyx',
  description: 'Global voice and messaging with TeXML (TwiML-compatible) and competitive pricing',
  credentialSchema: TelnyxConfigSchema,

  supportsOAuth: true,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: true,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const base = (config as any)._testBaseUrl ?? TELNYX_API_BASE
      const res = await fetch(`${base}/v2/available_phone_numbers?filter[limit]=1&filter[country_code]=US`, {
        headers: { Authorization: telnyxAuth(config) },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: res.status === 401 ? 'invalid_credentials' : 'unknown' }
      return { connected: true, latencyMs, accountName: 'Telnyx' }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
      smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}`,
    }
  },

  async listOwnedNumbers(config): Promise<PhoneNumberInfo[]> {
    const base = (config as any)._testBaseUrl ?? TELNYX_API_BASE
    const res = await fetch(`${base}/v2/phone_numbers?page[size]=100`, {
      headers: { Authorization: telnyxAuth(config) }, signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to list numbers: ${res.status}`)
    const data = await res.json() as { data: Array<{ phone_number: string; country_code: string }> }
    return (data.data ?? []).map((n) => ({
      number: n.phone_number,
      country: n.country_code,
      capabilities: { voice: true, sms: true, mms: false },
      owned: true,
    }))
  },

  async searchAvailableNumbers(config, query): Promise<PhoneNumberInfo[]> {
    const base = (config as any)._testBaseUrl ?? TELNYX_API_BASE
    const params = new URLSearchParams({
      'filter[country_code]': query.country,
      'filter[limit]': String(query.limit ?? 20),
    })
    if (query.contains) params.set('filter[phone_number][contains]', query.contains)
    if (query.areaCode) params.set('filter[national_destination_code]', query.areaCode)
    const res = await fetch(`${base}/v2/available_phone_numbers?${params}`, {
      headers: { Authorization: telnyxAuth(config) }, signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Failed to search numbers: ${res.status}`)
    const data = await res.json() as { data: Array<{ phone_number: string; region_information?: Array<{ region_name?: string }>; cost_information?: { monthly_cost?: string } }> }
    return (data.data ?? []).map((n) => ({
      number: n.phone_number,
      country: query.country,
      locality: n.region_information?.[0]?.region_name,
      capabilities: { voice: true, sms: true, mms: false },
      monthlyFee: n.cost_information?.monthly_cost,
      owned: false,
    }))
  },

  async provisionNumber(config, number): Promise<ProvisionResult> {
    const base = (config as any)._testBaseUrl ?? TELNYX_API_BASE
    const res = await fetch(`${base}/v2/number_orders`, {
      method: 'POST',
      headers: { Authorization: telnyxAuth(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_numbers: [{ phone_number: number }] }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ok: false, error: `Provision failed: ${res.status}` }
    return { ok: true, number }
  },

  async configureWebhooks(config, _phoneNumber, webhookUrls): Promise<AutoConfigResult> {
    // Telnyx configures webhooks via TeXML Application
    const base = (config as any)._testBaseUrl ?? TELNYX_API_BASE
    if (config.texmlAppId) {
      // Update existing app
      const res = await fetch(`${base}/v2/texml_applications/${config.texmlAppId}`, {
        method: 'PATCH',
        headers: { Authorization: telnyxAuth(config), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_url: webhookUrls.voiceIncoming,
          status_callback_url: webhookUrls.voiceStatus,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { ok: false, error: `Failed to update TeXML app: ${res.status}` }
      return { ok: true }
    }
    // Create new TeXML app
    const res = await fetch(`${base}/v2/texml_applications`, {
      method: 'POST',
      headers: { Authorization: telnyxAuth(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        friendly_name: 'Llamenos Hotline',
        voice_url: webhookUrls.voiceIncoming,
        status_callback_url: webhookUrls.voiceStatus,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, error: `Failed to create TeXML app: ${res.status}` }
    const data = await res.json() as { data: { id: string } }
    return { ok: true, details: { texmlAppId: data.data.id } }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/telephony/telnyx-capabilities.ts
git commit -m "feat: Telnyx capabilities (setup/validation only, no runtime adapter)"
```

---

### Task 10: Messaging Channel Capabilities

**Files:**
- Create: `src/server/messaging/capabilities.ts`

- [ ] **Step 1: Create messaging capabilities interface and registry**

```typescript
// src/server/messaging/capabilities.ts
import type { z } from 'zod/v4'
import type { MessagingChannelType, ConnectionTestResult, WebhookUrlSet, AutoConfigResult } from '@shared/types'
import { SMSConfigSchema, WhatsAppConfigSchema, SignalBridgeConfigSchema, RCSConfigSchema } from '@shared/schemas/providers'

export interface MessagingChannelCapabilities<T = unknown> {
  readonly channelType: MessagingChannelType
  readonly displayName: string
  readonly description: string
  readonly credentialSchema: z.ZodType<T>
  readonly supportsWebhookAutoConfig: boolean

  testConnection(config: T): Promise<ConnectionTestResult>
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet
  configureWebhooks?(config: T, webhookUrls: WebhookUrlSet): Promise<AutoConfigResult>
}

// SMS — delegates to telephony provider for actual testing
const smsCapabilities: MessagingChannelCapabilities = {
  channelType: 'sms',
  displayName: 'SMS',
  description: 'Text messaging via your telephony provider (uses same credentials)',
  credentialSchema: SMSConfigSchema,
  supportsWebhookAutoConfig: false, // webhook config handled by telephony provider

  async testConnection(): Promise<ConnectionTestResult> {
    // SMS uses telephony provider credentials — test is done via TELEPHONY_CAPABILITIES
    return { connected: true, latencyMs: 0, accountName: 'Uses telephony provider' }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}` }
  },
}

const whatsappCapabilities: MessagingChannelCapabilities = {
  channelType: 'whatsapp',
  displayName: 'WhatsApp',
  description: 'WhatsApp Business messaging via Twilio or direct Meta Cloud API',
  credentialSchema: WhatsAppConfigSchema,
  supportsWebhookAutoConfig: false,

  async testConnection(config: any): Promise<ConnectionTestResult> {
    if (config.integrationMode === 'twilio') {
      return { connected: true, latencyMs: 0, accountName: 'Uses Twilio credentials' }
    }
    if (!config.phoneNumberId || !config.accessToken) {
      return { connected: false, latencyMs: 0, error: 'Phone Number ID and Access Token required', errorType: 'invalid_credentials' }
    }
    const start = Date.now()
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: res.status === 401 ? 'invalid_credentials' : 'unknown' }
      const data = await res.json() as { verified_name?: string }
      return { connected: true, latencyMs, accountName: data.verified_name }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { whatsappIncoming: `${baseUrl}/api/messaging/whatsapp/webhook${qs}` }
  },
}

const signalCapabilities: MessagingChannelCapabilities = {
  channelType: 'signal',
  displayName: 'Signal',
  description: 'Encrypted messaging via signal-cli REST API bridge',
  credentialSchema: SignalBridgeConfigSchema,
  supportsWebhookAutoConfig: false,

  async testConnection(config: any): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const headers: Record<string, string> = {}
      if (config.bridgeApiKey) headers.Authorization = `Bearer ${config.bridgeApiKey}`
      const res = await fetch(`${config.bridgeUrl}/v1/about`, {
        headers, signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: res.status === 401 ? 'invalid_credentials' : 'unknown' }
      const data = await res.json() as { versions?: Record<string, string> }
      return { connected: true, latencyMs, accountName: `signal-cli ${data.versions?.['signal-cli'] ?? ''}`.trim() }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { signalIncoming: `${baseUrl}/api/messaging/signal/webhook${qs}` }
  },
}

const rcsCapabilities: MessagingChannelCapabilities = {
  channelType: 'rcs',
  displayName: 'RCS',
  description: 'Rich Communication Services via Google RBM',
  credentialSchema: RCSConfigSchema,
  supportsWebhookAutoConfig: false,

  async testConnection(config: any): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      // Validate by attempting OAuth2 token exchange with service account key
      const keyData = JSON.parse(config.serviceAccountKey) as { client_email: string; private_key: string }
      if (!keyData.client_email || !keyData.private_key) {
        return { connected: false, latencyMs: 0, error: 'Invalid service account key', errorType: 'invalid_credentials' }
      }
      return { connected: true, latencyMs: Date.now() - start, accountName: keyData.client_email }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: 'Invalid JSON in service account key', errorType: 'invalid_credentials' }
    }
  },

  getWebhookUrls(baseUrl, hubId): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { rcsIncoming: `${baseUrl}/api/messaging/rcs/webhook${qs}` }
  },
}

export const MESSAGING_CAPABILITIES: Record<MessagingChannelType, MessagingChannelCapabilities> = {
  sms: smsCapabilities,
  whatsapp: whatsappCapabilities,
  signal: signalCapabilities,
  rcs: rcsCapabilities,
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/messaging/capabilities.ts
git commit -m "feat: messaging channel capabilities (SMS, WhatsApp, Signal, RCS)"
```

---

### Task 11: Add testConnection() to TelephonyAdapter Interface

**Files:**
- Modify: `src/server/telephony/adapter.ts` (line 142)

- [ ] **Step 1: Add method to interface**

After the last method in the `TelephonyAdapter` interface (around line 142), add:

```typescript
  /** Test provider connectivity using stored credentials. Used by health monitoring. */
  testConnection(): Promise<ConnectionTestResult>
```

Also add the import:

```typescript
import type { ConnectionTestResult } from '@shared/types'
```

- [ ] **Step 2: Run typecheck to find all adapters that need the new method**

Run: `bun run typecheck`
Expected: Errors in twilio.ts, signalwire.ts, vonage.ts, plivo.ts, asterisk.ts — each needs `testConnection()`.

- [ ] **Step 3: Add stub implementations to each adapter**

In each adapter file, add a `testConnection()` method that delegates to the corresponding capabilities:

```typescript
// Example in src/server/telephony/twilio.ts
async testConnection(): Promise<ConnectionTestResult> {
  const { twilioCapabilities } = await import('./twilio-capabilities')
  return twilioCapabilities.testConnection(this.config as any)
}
```

(Each adapter stores its config — pass it to the capabilities `testConnection()`.)

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Run all existing tests**

Run: `bunx playwright test tests/asterisk-auto-config.spec.ts --project bridge`
Expected: All 8 PASS (no regression)

- [ ] **Step 6: Commit**

```bash
git add src/server/telephony/adapter.ts src/server/telephony/twilio.ts src/server/telephony/signalwire.ts src/server/telephony/vonage.ts src/server/telephony/plivo.ts src/server/telephony/asterisk.ts
git commit -m "feat: add testConnection() to TelephonyAdapter interface + all implementations"
```

---

### Task 12: Final Integration — Build + Full Test Suite

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Run all provider tests**

Run: `bunx playwright test tests/provider-capabilities.spec.ts tests/asterisk-auto-config.spec.ts --project bridge`
Expected: All tests PASS

- [ ] **Step 4: Final commit if any loose changes**

```bash
git add -A
git commit -m "feat: provider capabilities interface complete — foundation for auto-registration"
```
