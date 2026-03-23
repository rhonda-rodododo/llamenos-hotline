# Sub-Project A: Provider Capabilities Interface + Zod Schemas — Design Spec

**Date:** 2026-03-23
**Parent:** [Provider Auto-Registration Master Spec](2026-03-23-provider-auto-registration-design.md)
**Status:** Draft
**Dependencies:** None — foundation for all other sub-projects

## Problem

Adding a new telephony or messaging provider requires touching 8+ files with no guide. Each provider's test logic is duplicated across `settings.ts` and `provider-setup.ts`. The existing `TelephonyConfigSchema` is `z.record(z.string(), z.unknown())` — no per-provider validation. The `PROVIDER_REQUIRED_FIELDS` in `types.ts` is a flat string array rather than a rich schema.

## Goal

A single `ProviderCapabilities` interface that self-describes what a provider can do, what credentials it needs, how to test connectivity, how to discover/provision numbers, and how to auto-configure webhooks. Adding a new provider = implement this interface + add to the registry. No route changes, no UI changes, no schema changes.

## Design

### ProviderCapabilities Interface

**File:** `src/server/telephony/capabilities.ts` (new)

```typescript
import type { TelephonyProviderType, TelephonyProviderConfig } from '@shared/types'
import type { z } from 'zod/v4'

export interface ProviderCapabilities<T extends TelephonyProviderConfig = TelephonyProviderConfig> {
  // Identity
  readonly type: TelephonyProviderType
  readonly displayName: string
  readonly description: string

  // Credential schema — typed Zod schema so safeParse().data is T, not unknown
  readonly credentialSchema: z.ZodType<T>

  // Feature flags
  readonly supportsOAuth: boolean
  readonly supportsSms: boolean
  readonly supportsSip: boolean
  readonly supportsWebRtc: boolean
  readonly supportsNumberProvisioning: boolean
  readonly supportsWebhookAutoConfig: boolean

  // Connection validation (typed credentials from Zod parse)
  testConnection(credentials: TelephonyProviderConfig): Promise<ConnectionTestResult>

  // Webhook URL generation
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet

  // Number management (optional)
  listOwnedNumbers?(credentials: TelephonyProviderConfig): Promise<PhoneNumberInfo[]>
  searchAvailableNumbers?(credentials: TelephonyProviderConfig, query: NumberSearchQuery): Promise<PhoneNumberInfo[]>
  provisionNumber?(credentials: TelephonyProviderConfig, number: string): Promise<ProvisionResult>

  // Auto-configuration (optional)
  configureWebhooks?(credentials: TelephonyProviderConfig, phoneNumber: string, webhookUrls: WebhookUrlSet): Promise<AutoConfigResult>
  configureSipTrunk?(credentials: TelephonyProviderConfig, options: SipTrunkOptions): Promise<AutoConfigResult>
}
```

### MessagingChannelCapabilities Interface

**File:** `src/server/messaging/capabilities.ts` (new)

Each channel has its own typed config (SMSConfig, WhatsAppConfig, SignalConfig, RCSConfig). The generic ensures `testConnection()` and `configureWebhooks()` are type-safe per channel:

```typescript
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
```

Example: `smsCapabilities` is `MessagingChannelCapabilities<SMSConfig>`, `signalCapabilities` is `MessagingChannelCapabilities<SignalConfig>`.

### SSRF Protection

All `testConnection()` implementations that accept user-supplied URLs (Asterisk `ariUrl`, Signal `bridgeUrl`) MUST validate via the existing `validateExternalUrl()` in `src/server/lib/ssrf-guard.ts`. Asterisk is an exception for private IPs (self-hosted PBX), but loopback/link-local must still be blocked. Cloud providers (Twilio, SignalWire, Vonage, Plivo, Telnyx) use hardcoded API base URLs — no SSRF concern.

### Shared Types

**File:** `src/shared/types.ts` (additions)

```typescript
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
  number: string       // E.164
  country: string      // ISO 3166-1 alpha-2
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

### Per-Provider Zod Schemas (discriminated union)

**File:** `src/shared/schemas/providers.ts` (new)

Replace the loose `TelephonyConfigSchema` with a discriminated union:

```typescript
import { z } from 'zod/v4'

const BaseProviderSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format'),
})

export const TwilioConfigSchema = BaseProviderSchema.extend({
  type: z.literal('twilio'),
  accountSid: z.string().startsWith('AC'),
  authToken: z.string().min(32),
  // Optional WebRTC fields
  webrtcEnabled: z.boolean().optional(),
  apiKeySid: z.string().optional(),
  apiKeySecret: z.string().optional(),
  twimlAppSid: z.string().optional(),
})

export const SignalWireConfigSchema = BaseProviderSchema.extend({
  type: z.literal('signalwire'),
  accountSid: z.string(),
  authToken: z.string(),
  signalwireSpace: z.string(),
})

export const VonageConfigSchema = BaseProviderSchema.extend({
  type: z.literal('vonage'),
  apiKey: z.string(),
  apiSecret: z.string(),
  applicationId: z.string().uuid(),
  privateKey: z.string().optional(), // PEM format
})

export const PlivoConfigSchema = BaseProviderSchema.extend({
  type: z.literal('plivo'),
  authId: z.string(),
  authToken: z.string(),
})

export const AsteriskConfigSchema = BaseProviderSchema.extend({
  type: z.literal('asterisk'),
  ariUrl: z.url(),
  ariUsername: z.string(),
  ariPassword: z.string(),
  bridgeCallbackUrl: z.url().optional(),
})

export const TelnyxConfigSchema = BaseProviderSchema.extend({
  type: z.literal('telnyx'),
  apiKey: z.string(),
  // TeXML application ID (auto-created during setup)
  texmlAppId: z.string().optional(),
})

export const TelephonyProviderConfigSchema = z.discriminatedUnion('type', [
  TwilioConfigSchema,
  SignalWireConfigSchema,
  VonageConfigSchema,
  PlivoConfigSchema,
  AsteriskConfigSchema,
  TelnyxConfigSchema,
])
export type TelephonyProviderConfig = z.infer<typeof TelephonyProviderConfigSchema>
```

### Messaging Channel Schemas

Same file, per-channel schemas:

```typescript
export const SMSConfigSchema = z.object({
  enabled: z.boolean(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})

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

export const SignalConfigSchema = z.object({
  bridgeUrl: z.url(),
  bridgeApiKey: z.string(),
  webhookSecret: z.string(),
  registeredNumber: z.string(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})

export const RCSConfigSchema = z.object({
  agentId: z.string(),
  serviceAccountKey: z.string(),
  webhookSecret: z.string().optional(),
  fallbackToSms: z.boolean(),
  autoResponse: z.string().optional(),
  afterHoursResponse: z.string().optional(),
})
```

### Capabilities Registry

**File:** `src/server/telephony/capabilities.ts`

```typescript
export const TELEPHONY_CAPABILITIES: Record<TelephonyProviderType, ProviderCapabilities> = {
  twilio: twilioCapabilities,
  signalwire: signalwireCapabilities,
  vonage: vonageCapabilities,
  plivo: plivoCapabilities,
  asterisk: asteriskCapabilities,
  telnyx: telnyxCapabilities,
}
```

Each adapter file exports a capabilities object. Example for Twilio:

```typescript
// In src/server/telephony/twilio.ts (addition)
export const twilioCapabilities: ProviderCapabilities = {
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

  async testConnection(config) {
    const start = Date.now()
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}.json`,
      { headers: { Authorization: 'Basic ' + btoa(`${config.accountSid}:${config.authToken}`) } }
    )
    const latencyMs = Date.now() - start
    if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: res.status === 401 ? 'invalid_credentials' : 'unknown' }
    const data = await res.json()
    return { connected: true, latencyMs, accountName: data.friendly_name }
  },

  getWebhookUrls(baseUrl, hubId) {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/api/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/api/telephony/call-status${qs}`,
      smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}`,
    }
  },

  async listOwnedNumbers(config) { /* Twilio API call */ },
  async searchAvailableNumbers(config, query) { /* Twilio API call */ },
  async provisionNumber(config, number) { /* Twilio API call */ },
  async configureWebhooks(config, phoneNumber, webhookUrls) { /* Update number resource */ },
}
```

### testConnection() Endpoints

| Provider | Endpoint | Auth |
|----------|----------|------|
| Twilio | `GET /2010-04-01/Accounts/{sid}.json` | Basic |
| SignalWire | `GET /api/laml/2010-04-01/Accounts/{pid}.json` | Basic |
| Vonage | `GET /account/get-balance?api_key=...&api_secret=...` | Query params |
| Plivo | `GET /v1/Account/{authId}/` | Basic |
| Asterisk | `GET {ariUrl}/ari/asterisk/info` | Basic |
| Telnyx | `GET /v2/texml_applications` | Bearer |

### Type System Changes

- `TelephonyProviderType` in `types.ts` gains `'telnyx'`
- `PROVIDER_REQUIRED_FIELDS` **removed atomically** with the `'telnyx'` addition (not deprecated — replaced by `credentialSchema`). All consumers switch to capabilities registry in the same commit.
- `TELEPHONY_PROVIDER_LABELS` in `types.ts` gains `telnyx: 'Telnyx'` entry
- `TelephonyProviderConfig` type derived from Zod discriminated union (replaces the manually-defined interface)
- All messaging config types derived from Zod schemas

### Cascading Changes from Adding 'telnyx'

Adding `'telnyx'` to `TelephonyProviderType` will cause TypeScript exhaustiveness errors in:
- `TELEPHONY_PROVIDER_LABELS` map in `types.ts`
- `createAdapterFromConfig()` switch in `src/server/lib/adapters.ts` — add a case that throws "Telnyx runtime adapter not yet implemented"
- Any other switch/if-else on provider type — grep for `TelephonyProviderType` and fix all

### ChannelStatus vs ConnectionTestResult Alignment

The existing `MessagingAdapter.getChannelStatus()` returns `ChannelStatus` (`{ connected, details?, error? }`). The new capabilities system uses `ConnectionTestResult` (`{ connected, latencyMs, accountName?, error?, errorType? }`).

Resolution: Add a `toConnectionTestResult(status: ChannelStatus, latencyMs: number): ConnectionTestResult` mapper in the health service. Do NOT change the existing `MessagingAdapter` interface — `ChannelStatus` is fine for runtime use. The capabilities `testConnection()` method returns `ConnectionTestResult` directly (it measures latency itself). The health service wraps the runtime `getChannelStatus()` call with timing and maps the result.

### Files Changed

- `src/shared/schemas/providers.ts` — NEW: per-provider Zod schemas (discriminated union)
- `src/shared/types.ts` — ADD: `ConnectionTestResult`, `PhoneNumberInfo`, `NumberSearchQuery`, `WebhookUrlSet`, `ProvisionResult`, `AutoConfigResult`, `SipTrunkOptions`. UPDATE: `TelephonyProviderType` adds `'telnyx'`. DEPRECATE: `PROVIDER_REQUIRED_FIELDS` (replaced by capabilities).
- `src/server/telephony/capabilities.ts` — NEW: `ProviderCapabilities` interface + registry
- `src/server/telephony/twilio.ts` — ADD: `twilioCapabilities` export
- `src/server/telephony/signalwire.ts` — ADD: `signalwireCapabilities` export
- `src/server/telephony/vonage.ts` — ADD: `vonageCapabilities` export
- `src/server/telephony/plivo.ts` — ADD: `plivoCapabilities` export
- `src/server/telephony/asterisk.ts` — ADD: `asteriskCapabilities` export
- `src/server/messaging/capabilities.ts` — NEW: `MessagingChannelCapabilities` interface + registry
- `src/server/messaging/sms/factory.ts` — ADD: `smsCapabilities` export
- `src/server/messaging/whatsapp/factory.ts` — ADD: `whatsappCapabilities` export
- `src/server/messaging/signal/factory.ts` — ADD: `signalCapabilities` export
- `src/server/messaging/rcs/factory.ts` — ADD: `rcsCapabilities` export
- `src/server/telephony/adapter.ts` — ADD: `testConnection()` to TelephonyAdapter interface
- `src/shared/schemas/settings.ts` — UPDATE: `TelephonyConfigSchema` to use new discriminated union

### Testing

- E2E test per provider: `testConnection()` with mock HTTP server returning expected responses
- E2E test: capabilities registry returns correct info for each provider type
- E2E test: Zod schemas validate and reject correctly (valid config passes, missing fields fail, wrong type fails)
- Real integration test for Asterisk (already passing — extend with capabilities)
