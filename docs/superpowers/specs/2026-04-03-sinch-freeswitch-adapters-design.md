# Design: Sinch + FreeSWITCH Telephony Adapters

**Date:** 2026-04-03
**Status:** Draft (supersedes sinch-telephony-adapter-design.md and generic-sip-trunk-adapter-design.md)

## Overview

Add two telephony adapters to bring the provider count to 9:

1. **Sinch** — global CPaaS with SVAML (JSON instruction format), strong Latin America/EU/Asia coverage
2. **FreeSWITCH** — self-hosted PBX via mod_httapi (HTTP webhooks) + ESL bridge (real-time events)

Both implement the full `TelephonyAdapter` interface + `ProviderCapabilities` with all capabilities (number provisioning, webhook auto-config, connection testing).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sinch credentials | OAuth 2.0 + key/secret (both) | OAuth enables automated setup wizard flows; key/secret for quick manual config |
| FreeSWITCH interaction | mod_httapi + ESL bridge | mod_httapi handles standard call flow; ESL bridge for real-time events |
| Bridge architecture | Combined `sip-bridge/` (Asterisk ARI + FreeSWITCH ESL) | Single deployment, shared webhook translation layer, protocol detection from config |
| FreeSWITCH TTS | mod_flite (built-in fallback) | Users record custom IVR audio; mod_flite covers unrecorded prompts only |
| Sinch TTS | Sinch native voices | Map per language like all other providers |
| Scope | Full capabilities from day one | Number provisioning, webhook auto-config, SIP trunk config, recording management |

---

## Part 1: Sinch Adapter

### Interaction Model

Sinch uses **callback + SVAML response** (similar to Vonage NCCO):

1. Incoming call → Sinch sends **ICE** (Incoming Call Event) webhook
2. Server responds with **SVAML JSON** (actions + instructions)
3. Call events → **ACE** (Answered Call Event), **DiCE** (Disconnected Call Event)
4. Recording events → **PICE** (Post-call Information Call Event)

### Authentication

- **API calls:** OAuth 2.0 bearer token (from `/oauth2/token` using `client_id` + `client_secret`)
- **Quick setup:** Application key + secret (Basic auth for REST API, HMAC-SHA256 for webhooks)
- **Webhooks:** Callback URL signing with application secret (HMAC-SHA256 of request body)

### SVAML Mapping

| Llamenos Flow | SVAML Action | SVAML Instructions |
|---------------|-------------|-------------------|
| Language menu | `runMenu` | `options` per digit, `say` per language |
| CAPTCHA | `runMenu` | `maxDigits: 4`, `say` with digits |
| Hold music | `park` | `playFiles` instruction |
| Ring volunteers | REST: `POST /calling/v1/callouts` per volunteer | — |
| Bridge/answer | `connectPstn` | `cli` (caller ID) |
| Voicemail | `continue` (to next callback) | `startRecording` + `say` prompt |
| Reject | `hangup` | — |
| Unavailable | `hangup` | `say` with message |

### Config Schema

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

### Sinch Voice Map

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
  // Fallback to English for unsupported languages
  tl: { name: 'Joanna', locale: 'en-US' },
  vi: { name: 'Joanna', locale: 'en-US' },
  ht: { name: 'Lea', locale: 'fr-FR' },
}
```

### Capabilities

| Capability | Supported | Notes |
|-----------|-----------|-------|
| OAuth | Yes | Client credentials flow |
| SMS | Yes | Via Sinch SMS API (separate from voice) |
| SIP | No | Not applicable (cloud CPaaS) |
| WebRTC | Yes | Via Sinch RTC SDK |
| Number provisioning | Yes | `GET /v1/projects/{projectId}/availableNumbers`, `POST /rent` |
| Webhook auto-config | Yes | `PATCH /v1/projects/{projectId}/apps/{appId}` |

### Webhook Schemas (Zod)

New file: `src/shared/schemas/external/sinch-voice.ts`

- `SinchICESchema` — Incoming Call Event (callId, cli, to, timestamp)
- `SinchACESchema` — Answered Call Event (callId, timestamp)
- `SinchDiCESchema` — Disconnected Call Event (callId, reason, duration)
- `SinchPICESchema` — Post-call Info (recordings, duration)
- `SinchMenuResultSchema` — DTMF gather result (value, menuId)

---

## Part 2: FreeSWITCH Adapter

### Interaction Model

FreeSWITCH uses **mod_httapi** for HTTP-driven call control:

1. Incoming call → FreeSWITCH sends HTTP POST to our server
2. Server responds with **XML** instructions (similar to TwiML but FreeSWITCH dialplan XML)
3. Events and recordings → ESL bridge translates to HTTP webhooks

The **sip-bridge** process handles ESL real-time events (transfer, recording status, presence).

### mod_httapi XML Mapping

| Llamenos Flow | mod_httapi XML |
|---------------|---------------|
| Language menu | `<work><playback>` + `<getDigits>` |
| CAPTCHA | `<work><getDigits digits="4">` + `<playback>` |
| Hold music | `<work><playback loops="0">` (hold audio URL) |
| Ring volunteers | ESL bridge: `originate` command per volunteer |
| Bridge/answer | `<work><execute application="bridge">` |
| Voicemail | `<work><record>` with `name` and `action` |
| Reject | `<work><hangup cause="CALL_REJECTED">` |
| Unavailable | `<work><playback>` + `<hangup>` |

### Config Schema

```typescript
const FreeSwitchConfigSchema = BaseProviderSchema.extend({
  type: z.literal('freeswitch'),
  // ESL connection (for sip-bridge)
  eslHost: z.string().default('localhost'),
  eslPort: z.number().default(8021),
  eslPassword: z.string().min(1),
  // mod_httapi base URL (our server URL that FreeSWITCH calls)
  httapiUrl: z.string().url().optional(), // auto-detected from request if not set
  // Bridge callback
  bridgeCallbackUrl: z.string().url(),
  bridgeSecret: z.string().min(8),
})
```

### TTS

FreeSWITCH uses **mod_flite** (built-in, basic quality) as the default TTS engine. Users are expected to record custom IVR audio for production quality. The adapter:

1. Checks `audioUrls` map for custom recordings first
2. Falls back to mod_flite `<speak>` for unrecorded prompts
3. mod_flite voice: `slt` (female) for all languages (English-only engine — another reason to record)

### Capabilities

| Capability | Supported | Notes |
|-----------|-----------|-------|
| OAuth | No | Self-hosted, no cloud auth |
| SMS | No | Voice-only PBX |
| SIP | Yes | Native SIP support, trunk provisioning via ESL |
| WebRTC | Yes | mod_verto for browser calling |
| Number provisioning | No | DIDs come from SIP trunk provider |
| Webhook auto-config | No | FreeSWITCH config managed via ESL/XML |

---

## Part 3: Unified SIP Bridge (`sip-bridge/`)

### Architecture

Rename/extend `asterisk-bridge/` → `sip-bridge/` with protocol detection:

```
sip-bridge/
  src/
    index.ts          # Entry point — detect ARI or ESL from config
    ari-client.ts     # Existing ARI WebSocket client (from asterisk-bridge)
    esl-client.ts     # New ESL TCP client for FreeSWITCH
    webhook-sender.ts # Shared: translate events → HTTP POST to Llamenos
    health.ts         # Health endpoint (shared)
  Dockerfile
  package.json
```

### Config

```
# Asterisk mode (existing)
PBX_TYPE=asterisk
ARI_URL=ws://asterisk:8088/ari/events
ARI_REST_URL=http://asterisk:8088/ari
ARI_USERNAME=llamenos
ARI_PASSWORD=changeme

# FreeSWITCH mode (new)
PBX_TYPE=freeswitch
ESL_HOST=freeswitch
ESL_PORT=8021
ESL_PASSWORD=ClueCon

# Shared
WORKER_WEBHOOK_URL=http://llamenos:3000
BRIDGE_SECRET=shared-secret
BRIDGE_PORT=3001
```

### ESL Client

The ESL (Event Socket Library) client connects to FreeSWITCH over TCP:

1. Connect to `ESL_HOST:ESL_PORT`
2. Authenticate with `auth ESL_PASSWORD`
3. Subscribe to events: `event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP RECORD_STOP DTMF`
4. Translate events to webhook POSTs matching the same format as ARI webhooks

### Event Translation

| FreeSWITCH Event | Webhook POST | Llamenos Endpoint |
|-----------------|-------------|------------------|
| `CHANNEL_CREATE` | `{ channelId, callerNumber, calledNumber, state: 'Ring' }` | `/telephony/incoming` |
| `CHANNEL_ANSWER` | `{ channelId, state: 'Up' }` | `/telephony/call-status` |
| `CHANNEL_HANGUP` | `{ channelId, state: 'Hangup', duration }` | `/telephony/call-status` |
| `RECORD_STOP` | `{ channelId, recordingName, recordingStatus: 'done' }` | `/telephony/voicemail-recording` |
| `DTMF` | `{ channelId, digit }` | (handled by mod_httapi, not bridge) |

### Migration Path

Existing `asterisk-bridge/` users: set `PBX_TYPE=asterisk` (default) and nothing changes. New FreeSWITCH deployments set `PBX_TYPE=freeswitch`.

---

## Files

### New Files

| File | Description |
|------|-------------|
| `src/server/telephony/sinch.ts` | SinchAdapter (~500 lines) — SVAML response generation |
| `src/server/telephony/sinch.test.ts` | Unit tests for SVAML output |
| `src/server/telephony/sinch-capabilities.ts` | ProviderCapabilities with OAuth + number provisioning |
| `src/shared/schemas/external/sinch-voice.ts` | Zod schemas for Sinch webhook events |
| `src/server/telephony/freeswitch.ts` | FreeSwitchAdapter (~450 lines) — mod_httapi XML generation |
| `src/server/telephony/freeswitch.test.ts` | Unit tests for mod_httapi XML output |
| `src/server/telephony/freeswitch-capabilities.ts` | ProviderCapabilities with SIP trunk support |
| `src/shared/schemas/external/freeswitch-httapi.ts` | Zod schemas for mod_httapi webhook events |
| `sip-bridge/src/esl-client.ts` | FreeSWITCH ESL TCP client |
| `sip-bridge/src/index.ts` | Unified entry point (ARI or ESL based on PBX_TYPE) |

### Modified Files

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `'sinch' \| 'freeswitch'` to `TelephonyProviderType` |
| `src/shared/schemas/providers.ts` | Add `SinchConfigSchema`, `FreeSwitchConfigSchema` |
| `src/server/lib/adapters.ts` | Register both adapters in `createAdapterFromConfig` |
| `src/server/telephony/capabilities.ts` | Register both in `TELEPHONY_CAPABILITIES` registry |
| `sip-bridge/src/ari-client.ts` | Extract from current `asterisk-bridge/src/index.ts` |
| `sip-bridge/src/webhook-sender.ts` | Extract shared webhook POST logic |
| `tests/ui/telephony-provider.spec.ts` | Update provider count 7→9 |

### Removed Files

| File | Reason |
|------|--------|
| `asterisk-bridge/` (directory) | Replaced by `sip-bridge/` (ARI client preserved, new entry point) |

---

## Testing

### Unit Tests

- **Sinch**: SVAML JSON output for each call flow step, webhook signature verification, OAuth token refresh
- **FreeSWITCH**: mod_httapi XML output for each call flow step, ESL command formatting

### API Simulation Tests

- Add `'sinch'` and `'freeswitch'` to the `PROVIDERS` array in `tests/api/simulation-telephony.spec.ts`
- Add webhook payload builders in `tests/helpers/simulation.ts` for both providers

### Integration Tests

- ESL client: connect to mock TCP server, verify auth + event subscription
- Sinch OAuth: token request/refresh against mock endpoint

### CI

- `sip-bridge/` gets its own `bun install` step in CI (like `asterisk-bridge/` today)
- `docker-compose.ci.yml` doesn't need FreeSWITCH container (mod_httapi responses are generated by our server, ESL is mocked in tests)

---

## Deployment

### Docker Compose (dev)

```yaml
sip-bridge:
  build: ./sip-bridge
  environment:
    PBX_TYPE: ${PBX_TYPE:-asterisk}
    # Asterisk (default)
    ARI_URL: ws://asterisk:8088/ari/events
    ARI_REST_URL: http://asterisk:8088/ari
    ARI_USERNAME: llamenos
    ARI_PASSWORD: changeme
    # FreeSWITCH (when PBX_TYPE=freeswitch)
    ESL_HOST: freeswitch
    ESL_PORT: 8021
    ESL_PASSWORD: ClueCon
    # Shared
    WORKER_WEBHOOK_URL: http://llamenos:3000
    BRIDGE_SECRET: dev-bridge-secret
    BRIDGE_PORT: 3001
```

### Ansible (production)

Add `freeswitch_enabled` variable to `demo_vars.yml`. When true, deploys FreeSWITCH container alongside or instead of Asterisk.
