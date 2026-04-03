# Design: FreeSWITCH Telephony Adapter + Unified SIP Bridge

**Date:** 2026-04-03
**Status:** Draft

## Overview

Add FreeSWITCH as the 9th telephony provider — a self-hosted PBX using mod_httapi (HTTP webhooks) for call flow and ESL (Event Socket Library) for real-time events. Also refactors `asterisk-bridge/` into a unified `sip-bridge/` that handles both Asterisk ARI and FreeSWITCH ESL.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interaction model | mod_httapi + ESL bridge | mod_httapi handles standard call flow; ESL bridge for real-time events (transfer, recording, presence) |
| Bridge architecture | Combined `sip-bridge/` (Asterisk ARI + FreeSWITCH ESL) | Single deployment, shared webhook translation layer, protocol detection from config |
| TTS | mod_flite (built-in fallback) | Users record custom IVR audio for quality; mod_flite covers unrecorded prompts only |
| Scope | Full capabilities | SIP trunk config, recording management, connection testing, WebRTC via mod_verto |

---

## Part 1: FreeSWITCH Adapter

### Interaction Model

FreeSWITCH uses **mod_httapi** for HTTP-driven call control:

1. Incoming call → FreeSWITCH sends HTTP POST to our server
2. Server responds with **XML** instructions (FreeSWITCH dialplan XML subset)
3. Events and recordings → ESL bridge translates to HTTP webhooks

The **sip-bridge** process handles ESL real-time events.

### mod_httapi XML Mapping

All responses use `<document type="xml/freeswitch-httapi"><params/><work>...</work></document>` wrapper.

Digit capture uses `<bind>` tags inside `<playback>` with regex patterns (no standalone `<getDigits>` tag).

| Llamenos Flow | mod_httapi XML |
|---------------|---------------|
| Language menu | `<playback file="..."><bind strip="#">~\d{1}#</bind></playback>` |
| CAPTCHA | `<playback file="..."><bind strip="#">~\d{4}#</bind></playback>` |
| Hold music | `<playback file="..." loops="0">` (hold audio URL) |
| Ring volunteers | ESL bridge: `originate` command per volunteer |
| Bridge/answer | `<execute application="bridge" data="...">` |
| Voicemail | `<record file="..." name="vm" action="callback-url" limit="120">` |
| Reject | `<hangup cause="CALL_REJECTED">` |
| Unavailable | `<playback file="...">` + `<hangup>` |

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

### Webhook Schemas (Zod)

New file: `src/shared/schemas/external/freeswitch-httapi.ts`

- `FreeSwitchHttapiRequestSchema` — mod_httapi POST body (channel UUID, caller, callee, variables)
- `FreeSwitchEventSchema` — ESL event translated by sip-bridge (channelId, state, duration)

---

## Part 2: Unified SIP Bridge (`sip-bridge/`)

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

```env
# Asterisk mode (existing behavior, default)
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

The ESL client connects to FreeSWITCH over TCP:

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
| `src/server/telephony/freeswitch.ts` | FreeSwitchAdapter (~450 lines) — mod_httapi XML generation |
| `src/server/telephony/freeswitch.test.ts` | Unit tests for mod_httapi XML output |
| `src/server/telephony/freeswitch-capabilities.ts` | ProviderCapabilities with SIP trunk support |
| `src/shared/schemas/external/freeswitch-httapi.ts` | Zod schemas for mod_httapi and ESL events |
| `sip-bridge/src/esl-client.ts` | FreeSWITCH ESL TCP client |
| `sip-bridge/src/index.ts` | Unified entry point (ARI or ESL based on PBX_TYPE) |
| `sip-bridge/src/webhook-sender.ts` | Shared webhook translation (extracted from current bridge) |
| `sip-bridge/src/health.ts` | Shared health endpoint |

### Modified Files

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `'freeswitch'` to `TelephonyProviderType` |
| `src/shared/schemas/providers.ts` | Add `FreeSwitchConfigSchema` |
| `src/server/lib/adapters.ts` | Register FreeSwitchAdapter in `createAdapterFromConfig` |
| `src/server/telephony/capabilities.ts` | Register in `TELEPHONY_CAPABILITIES` |
| `tests/helpers/simulation.ts` | Add FreeSWITCH webhook payload builders |
| `tests/api/simulation-telephony.spec.ts` | Add `'freeswitch'` to `PROVIDERS` array |
| `tests/ui/telephony-provider.spec.ts` | Update provider count (after Sinch lands) |

### Removed/Moved

| Path | Action |
|------|--------|
| `asterisk-bridge/src/index.ts` | Refactor → `sip-bridge/src/ari-client.ts` + `sip-bridge/src/index.ts` |
| `asterisk-bridge/` | Remove after `sip-bridge/` is verified |

## Deployment

### Docker Compose (dev)

```yaml
sip-bridge:
  build: ./sip-bridge
  environment:
    PBX_TYPE: ${PBX_TYPE:-asterisk}
    ARI_URL: ws://asterisk:8088/ari/events
    ARI_REST_URL: http://asterisk:8088/ari
    ARI_USERNAME: llamenos
    ARI_PASSWORD: changeme
    ESL_HOST: freeswitch
    ESL_PORT: 8021
    ESL_PASSWORD: ClueCon
    WORKER_WEBHOOK_URL: http://llamenos:3000
    BRIDGE_SECRET: dev-bridge-secret
    BRIDGE_PORT: 3001
```

### Ansible (production)

Add `freeswitch_enabled` variable to deployment config. When true, deploys FreeSWITCH container and sets `PBX_TYPE=freeswitch` for sip-bridge.

## Relationship to Generic SIP Trunk Adapter

The existing `generic-sip-trunk-adapter-design.md` spec describes auto-configuring SIP trunk registration for generic providers (VoIP.ms, Flowroute, sipgate, etc.). That spec is a **layer on top** of this FreeSWITCH adapter — it provisions PJSIP trunks in FreeSWITCH via ESL dynamic config, using the sip-bridge as the communication channel. Implementation order: FreeSWITCH adapter first, then generic SIP trunk provisioning as a follow-up.

## Testing

- **Unit tests:** mod_httapi XML output for each call flow step, ESL command formatting
- **ESL client integration:** connect to mock TCP server, verify auth + event subscription + event translation
- **API simulation:** FreeSWITCH-format webhooks through the full telephony route chain
- **Bridge refactor:** verify existing Asterisk tests still pass after `asterisk-bridge/` → `sip-bridge/` rename
- **CI:** `sip-bridge/` gets its own `bun install` step; no FreeSWITCH container needed (mod_httapi responses generated by our server, ESL mocked)
