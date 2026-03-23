# Provider Auto-Registration & Management — Design Spec

**Date:** 2026-03-23
**Status:** Master spec — detailed interfaces defined in sub-specs (A/B/C/D) which supersede this document

**Sub-Specs:**
- [A: Provider Capabilities Interface](2026-03-23-provider-capabilities-interface-design.md)
- [B: Credential Encryption](2026-03-23-credential-encryption-design.md)
- [C: Route Fix + Setup Automation](2026-03-23-route-fix-setup-automation-design.md)
- [D: Health Monitoring + Admin Management](2026-03-23-health-monitoring-admin-management-design.md)

## Problem Statement

The provider system has critical bugs and architectural gaps:

1. **Provider setup routes never mounted** — `src/server/routes/provider-setup.ts` defines OAuth, phone number management, and credential validation routes but is never imported in `app.ts`. Every frontend call to `/api/setup/provider/*` returns 404.
2. **Credential encryption is fake** — `encryptCredentials()` in `provider-setup/index.ts` just hex-encodes. The `LABEL_PROVIDER_CREDENTIAL_WRAP` constant is imported but unused. `telephonyConfig.config` stores full credentials as plaintext JSONB.
3. **No unified adapter self-description** — adding a new provider (Telnyx, Bandwidth, etc.) requires touching 8+ files with no guide. Each provider's test logic is duplicated across `settings.ts` and `provider-setup.ts`.
4. **No SMS connection test** in setup wizard (WhatsApp and Signal have test buttons).
5. **No provider health monitoring** — if a provider goes down mid-shift, nobody knows until calls fail.
6. **No post-setup provider management** — can't switch providers or change phone numbers without direct DB manipulation.

## Design Goals

- **Maximum automation**: Enter credentials → auto-discover numbers → auto-configure webhooks → auto-register SMS (A2P) → continuous health monitoring
- **Single interface for new providers**: Adding Telnyx, Bandwidth, or any future provider = implement one interface + add to registry
- **Real credential encryption**: XChaCha20-Poly1305 symmetric encryption keyed from `SERVER_NOSTR_SECRET` via HKDF

## Future Provider Roadmap

The interface must accommodate these providers without changes:

| Provider | Type | API Style | Notes |
|----------|------|-----------|-------|
| Telnyx | Voice+SMS | TeXML (TwiML-compatible) | OAuth, number provisioning. Already has setup module, no runtime adapter. |
| Bandwidth | Voice+SMS | REST (XML/JSON) | Number provisioning, SIP, A2P messaging |
| Flowroute | Voice+SMS | REST | Number search/provisioning, SIP trunking |
| Telegram Bot | Messaging | Bot API | New MessagingChannelType |

---

## Architecture: ProviderCapabilities Interface

### Telephony Capabilities

A self-describing interface separate from the runtime `TelephonyAdapter` (which handles live calls). Capabilities describe setup, testing, and automation.

```typescript
export interface ProviderCapabilities {
  // Identity
  type: TelephonyProviderType
  displayName: string
  description: string

  // Credential schema (drives UI form generation)
  requiredFields: FieldDescriptor[]
  optionalFields: FieldDescriptor[]

  // Feature flags
  supportsOAuth: boolean
  supportsSms: boolean
  supportsSip: boolean
  supportsWebRtc: boolean
  supportsNumberProvisioning: boolean
  supportsWebhookAutoConfig: boolean

  // Connection validation
  testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult>

  // Webhook URL generation
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet

  // Number management (optional — if supportsNumberProvisioning)
  listOwnedNumbers?(credentials: Record<string, string>): Promise<PhoneNumberInfo[]>
  searchAvailableNumbers?(credentials: Record<string, string>, query: NumberSearchQuery): Promise<PhoneNumberInfo[]>
  provisionNumber?(credentials: Record<string, string>, number: string): Promise<ProvisionResult>

  // Auto-configuration (optional)
  configureWebhooks?(credentials: Record<string, string>, phoneNumber: string, webhookUrls: WebhookUrlSet): Promise<{ ok: boolean; error?: string }>
  configureSipTrunk?(credentials: Record<string, string>, options: SipTrunkOptions): Promise<{ ok: boolean; domain?: string; error?: string }>
}
```

### testConnection() Endpoints Per Provider

| Provider | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Twilio | `GET /2010-04-01/Accounts/{sid}.json` | Basic | Returns account name, status. Already used by TwilioSMSAdapter.getChannelStatus() |
| SignalWire | `GET /api/laml/2010-04-01/Accounts/{pid}.json` | Basic | Same shape as Twilio |
| Vonage | `GET /account/get-balance` | Query params | Returns EUR balance |
| Plivo | `GET /v1/Account/{authId}/` | Basic | Returns account type, credits |
| Asterisk | `GET {ariUrl}/ari/asterisk/info` | Basic | Returns version, status |
| Telnyx | `GET /v2/texml_applications` | Bearer | Validates API key |
| WhatsApp/Meta | `GET /v21.0/{phoneNumberId}` | Bearer | Returns phone info |
| Signal | `GET {bridgeUrl}/v1/about` | Bearer | Returns version, registration |
| RCS/Google | OAuth2 token exchange | JWT | Token success = creds valid |

### Number Discovery & Provisioning Per Provider

| Provider | List Owned | Search Available | Provision | Webhook Auto-Config |
|----------|-----------|-----------------|-----------|-------------------|
| Twilio | `GET /IncomingPhoneNumbers.json` | `GET /AvailablePhoneNumbers/{country}/Local.json` | `POST /IncomingPhoneNumbers.json` | Update voice/sms URLs on number resource |
| SignalWire | Same as Twilio | Same as Twilio | Same as Twilio | Same as Twilio |
| Vonage | `GET /v2/numbers` | `GET /v2/numbers/available` | `POST /v2/numbers` | Via Application config |
| Plivo | `GET /v1/Account/{id}/Number/` | `GET /v1/Account/{id}/PhoneNumber/` | `POST /v1/Account/{id}/PhoneNumber/{num}/` | Via Application config |
| Asterisk | N/A (self-hosted) | N/A | N/A | PJSIP auto-config via ARI (already implemented) |
| Telnyx | `GET /v2/phone_numbers` | `GET /v2/available_phone_numbers` | `POST /v2/number_orders` | Via TeXML Application |

### Messaging Channel Capabilities (parallel interface)

```typescript
export interface MessagingChannelCapabilities {
  channelType: MessagingChannelType
  displayName: string
  description: string
  requiredFields: FieldDescriptor[]
  optionalFields: FieldDescriptor[]
  supportsWebhookAutoConfig: boolean
  testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult>
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet
  configureWebhooks?(credentials: Record<string, string>, webhookUrls: WebhookUrlSet): Promise<{ ok: boolean; error?: string }>
}
```

### Capabilities Registry

```typescript
export const TELEPHONY_CAPABILITIES: Record<TelephonyProviderType, ProviderCapabilities> = {
  twilio: twilioCapabilities,
  signalwire: signalwireCapabilities,
  vonage: vonageCapabilities,
  plivo: plivoCapabilities,
  asterisk: asteriskCapabilities,
  telnyx: telnyxCapabilities,  // setup/validation only — no runtime adapter yet
}
```

---

## Route Architecture: Fix the 404 Bug

### Current State (broken)

- `src/server/routes/provider-setup.ts` defines routes but is **never mounted** in `app.ts`
- Frontend API functions call `/api/setup/provider/*` paths — all 404
- The `settings.ts` routes (`/api/settings/telephony-provider/test`) have duplicated test logic

### Fix

Mount in `app.ts`: `authenticated.route('/setup/provider', providerSetupRoutes)`

Rewrite routes to match frontend contract (provider in body, not URL):

| Frontend Expects | Server Has | Action |
|-----------------|-----------|--------|
| `POST /setup/provider/oauth/start` | `GET /:provider/oauth/start` | Rewrite |
| `GET /setup/provider/oauth/status/:token` | N/A | Add |
| `POST /setup/provider/validate` | `POST /:provider/configure` | Rewrite |
| `POST /setup/provider/phone-numbers` | `GET /:provider/numbers` | Rewrite |
| `POST /setup/provider/phone-numbers/search` | N/A | Add |
| `POST /setup/provider/phone-numbers/provision` | `POST /:provider/provision-number` | Rewrite |
| `GET /setup/provider/webhooks` | N/A | Add |
| `POST /setup/provider/configure-webhooks` | N/A | Add |

All rewritten routes delegate to `TELEPHONY_CAPABILITIES[provider]` methods.

---

## Credential Encryption

### Current State (insecure)

```typescript
// provider-setup/index.ts — NOT real encryption
function encryptCredentials(plaintext: string): string {
  const _label = LABEL_PROVIDER_CREDENTIAL_WRAP  // UNUSED!
  return bytesToHex(new TextEncoder().encode(plaintext))  // Just hex
}
```

### Design: Symmetric Encryption

XChaCha20-Poly1305 keyed from `SERVER_NOSTR_SECRET` via HKDF. Server needs runtime access to credentials (asymmetric ECIES would be wrong).

- Key: `HKDF(SHA-256, serverSecret, LABEL_PROVIDER_CREDENTIAL_WRAP, 'llamenos:provider-creds:v1', 32)`
- Nonce: Random 24 bytes per encryption
- Storage: `hex(nonce || ciphertext)`

### Scope

| Table | Column | Current | After |
|-------|--------|---------|-------|
| `provider_config` | `encryptedCredentials` | Hex-encoded | Real encryption |
| `telephony_config` | `config` | Plaintext JSONB | Encrypted text |
| `messaging_config` | `config` | Plaintext JSONB | Encrypted text |
| `geocoding_config` | `apiKey` | Plaintext text | Encrypted text |

Schema change: `telephonyConfig.config` and `messagingConfig.config` change from `jsonb` to `text`.

Migration: Pre-production — detect hex-only values (AEAD will fail), re-encrypt with real encryption on first read.

---

## Full Setup Automation Flow

When admin enters credentials:

1. **Validate credentials** → `capabilities.testConnection()`
2. **List owned numbers** → `capabilities.listOwnedNumbers()`
3. **If no numbers: search & provision** → user picks country/area code → `capabilities.searchAvailableNumbers()` → `capabilities.provisionNumber()`
4. **Auto-configure webhooks** → `capabilities.configureWebhooks()` with auto-generated URLs from `capabilities.getWebhookUrls()`
5. **Test SMS** → create SMS adapter, call `getChannelStatus()`
6. **Auto-configure SIP trunk** (if applicable) → `capabilities.configureSipTrunk()`
7. **Submit A2P brand** (Twilio) → existing `ProviderSetup.submitA2pBrand()`

Each step shows progress feedback. Steps that CAN be automated ARE automated.

---

## Provider Health Monitoring

### Runtime testConnection()

Add `testConnection(): Promise<ConnectionTestResult>` to `TelephonyAdapter` interface. Same endpoints as capabilities but using stored credentials.

### Background Health Service

- 60-second interval (configurable)
- Tests active telephony provider + all enabled messaging channels
- In-memory result storage (ephemeral)
- Publishes status changes via Nostr relay for real-time dashboard
- Logs warnings on failure, errors after 3 consecutive failures

### Dashboard

- `GET /api/settings/provider-health` endpoint
- Health badge component on admin dashboard + settings page
- Shows: status, latency, last check time, consecutive failures

---

## Post-Setup Provider Management

Admin UI flows for after initial setup:

1. **Switch Provider** — capabilities.requiredFields drives form, validate, migrate webhooks
2. **Change Phone Number** — list owned numbers, search/provision, reconfigure webhooks
3. **Rotate Credentials** — validate new creds via testConnection(), save

---

## Type System Changes

- `TelephonyProviderType` gains `'telnyx'` (aligns with existing `SupportedProvider`)
- Add `PROVIDER_REQUIRED_FIELDS` entry for telnyx: `['apiKey', 'phoneNumber']`
- Shared types: `ConnectionTestResult`, `PhoneNumberInfo`, `NumberSearchQuery`, `WebhookUrlSet`, `FieldDescriptor`
