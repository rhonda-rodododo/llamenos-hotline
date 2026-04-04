# Design: Sinch Telephony Adapter

**Date:** 2026-04-03
**Status:** Draft

## Overview

Add Sinch as the 8th telephony provider — a global CPaaS with SVAML (JSON instruction format) and strong coverage in Latin America, Europe, and Asia. Implements the full `TelephonyAdapter` interface + `ProviderCapabilities` with all capabilities.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Credentials | OAuth 2.0 + key/secret (both) | OAuth enables automated setup wizard; key/secret for quick manual config |
| TTS | Sinch native voices | Map per language like all other providers |
| Scope | Full capabilities | Number provisioning, webhook auto-config, connection testing, recording management |

## Interaction Model

Sinch uses **callback + SVAML response** (similar to Vonage NCCO):

1. Incoming call → Sinch sends **ICE** (Incoming Call Event) webhook
2. Server responds with **SVAML JSON** (actions + instructions)
3. Call events → **ACE** (Answered Call Event), **DiCE** (Disconnected Call Event)
4. Recording events → **PICE** (Post-call Information Call Event)

## Authentication

- **API calls:** OAuth 2.0 bearer token (from `/oauth2/token` using `client_id` + `client_secret`)
- **Quick setup:** Application key + secret (Basic auth for REST API, HMAC-SHA256 for webhooks)
- **Webhooks:** Callback URL signing with application secret (HMAC-SHA256 of request body)

## SVAML Mapping

| Llamenos Flow | SVAML Action | SVAML Instructions |
|---------------|-------------|-------------------|
| Language menu | `runMenu` | `items: [{type:"Say"}, {type:"GetDigits", max:1}]` per language |
| CAPTCHA | `runMenu` | `items: [{type:"Say"}, {type:"GetDigits", max:4}]` |
| Hold music | `park` | `playFiles` instruction |
| Ring volunteers | REST: `POST /calling/v1/callouts` per volunteer | — |
| Bridge/answer | `connectPstn` | `cli` (caller ID) |
| Voicemail | `continue` (to next callback) | `startRecording` + `say` prompt |
| Reject | `hangup` | — |
| Unavailable | `hangup` | `say` with message |

## Config Schema

```typescript
const SinchConfigSchema = BaseProviderSchema.extend({
  type: z.literal('sinch'),
  // OAuth 2.0 (recommended for setup wizard)
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  // Application key/secret (manual setup)
  applicationKey: z.string().min(1),
  applicationSecret: z.string().min(1),
  projectId: z.string().min(1),
  region: z.enum(['us', 'eu', 'au', 'br', 'se']).default('us'),
})
```

## Voice Map

```typescript
const SINCH_VOICES: Record<string, { name: string; locale: string }> = {
  en: { name: 'Joanna', locale: 'en-US' },
  es: { name: 'Lupe', locale: 'es-US' },
  zh: { name: 'Zhiyu', locale: 'cmn-CN' },
  ar: { name: 'Zeina', locale: 'ar-XA' },
  fr: { name: 'Lea', locale: 'fr-FR' },
  ko: { name: 'Seoyeon', locale: 'ko-KR' },
  ru: { name: 'Tatyana', locale: 'ru-RU' },
  hi: { name: 'Kajal', locale: 'hi-IN' },
  pt: { name: 'Camila', locale: 'pt-BR' },
  de: { name: 'Vicki', locale: 'de-DE' },
  tl: { name: 'Joanna', locale: 'en-US' },
  vi: { name: 'Joanna', locale: 'en-US' },
  ht: { name: 'Lea', locale: 'fr-FR' },
}
```

## Capabilities

| Capability | Supported | Notes |
|-----------|-----------|-------|
| OAuth | Yes | Client credentials flow |
| SMS | Yes | Via Sinch SMS API (separate from voice) |
| SIP | No | Not applicable (cloud CPaaS) |
| WebRTC | Yes | Via Sinch RTC SDK |
| Number provisioning | Yes | `GET /v1/projects/{projectId}/availableNumbers`, `POST /rent` |
| Webhook auto-config | Yes | `PATCH /v1/projects/{projectId}/apps/{appId}` |

## Webhook Schemas (Zod)

New file: `src/shared/schemas/external/sinch-voice.ts`

- `SinchICESchema` — Incoming Call Event (callId, cli, to, timestamp)
- `SinchACESchema` — Answered Call Event (callId, timestamp)
- `SinchDiCESchema` — Disconnected Call Event (callId, reason, duration)
- `SinchPIESchema` — Prompt Input Event (menuResult with value and menuId)
- `SinchNotificationSchema` — Recording/transcription notifications

## Geographic Advantage

Sinch has local numbers and PSTN infrastructure in Latin America (Brazil, Mexico, Colombia, Argentina, Chile), Europe (all EU + UK), Asia (India, Singapore, Japan, Philippines), and Middle East (UAE, Saudi Arabia). This matters for crisis hotlines serving immigrant communities — callers can reach a local number.

## Files

### New Files

| File | Description |
|------|-------------|
| `src/server/telephony/sinch.ts` | SinchAdapter (~500 lines) — SVAML response generation |
| `src/server/telephony/sinch.test.ts` | Unit tests for SVAML output, webhook signature verification, OAuth token refresh |
| `src/server/telephony/sinch-capabilities.ts` | ProviderCapabilities with OAuth + number provisioning |
| `src/shared/schemas/external/sinch-voice.ts` | Zod schemas for Sinch webhook events |

### Modified Files

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `'sinch'` to `TelephonyProviderType` |
| `src/shared/schemas/providers.ts` | Add `SinchConfigSchema` |
| `src/server/lib/adapters.ts` | Register SinchAdapter in `createAdapterFromConfig` |
| `src/server/telephony/capabilities.ts` | Register in `TELEPHONY_CAPABILITIES` |
| `tests/helpers/simulation.ts` | Add Sinch webhook payload builders |
| `tests/api/simulation-telephony.spec.ts` | Add `'sinch'` to `PROVIDERS` array |
| `tests/ui/telephony-provider.spec.ts` | Update provider count 7→8 |

## Testing

- **Unit tests:** SVAML JSON output for each call flow step, webhook HMAC-SHA256 signature verification, OAuth token request/refresh
- **API simulation:** Sinch-format ICE/ACE/DiCE webhooks through the full telephony route chain
- **Capabilities:** testConnection against mock endpoint, number listing/provisioning
