# Design: FreeSWITCH Adapter + Kamailio + Unified SIP Bridge

**Date:** 2026-04-03
**Status:** Draft (supersedes freeswitch-kamailio-adapter-design.md)

## Overview

Three deliverables in one effort:

1. **FreeSWITCH adapter** — 9th telephony provider, using mod_httapi (HTTP webhooks) for call flow and ESL for real-time events
2. **Kamailio integration** — SIP proxy/load balancer for high-availability deployments, sits in front of PBX instances
3. **Unified sip-bridge** — refactors `sip-bridge/` into a combined bridge handling Asterisk ARI, FreeSWITCH ESL, and Kamailio XMLRPC/JSONRPC

Building all three together ensures the sip-bridge protocol abstraction is designed correctly from the start.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| FreeSWITCH interaction | mod_httapi + ESL bridge | mod_httapi handles standard call flow (modern, webhook-driven); ESL bridge for real-time events |
| Kamailio role | Infrastructure (SIP proxy), not a TelephonyAdapter | Routes SIP traffic to PBX instances; Llamenos talks to PBX, not Kamailio directly |
| Kamailio management | JSONRPC from sip-bridge | Dispatcher list management, health monitoring, stats — all via Kamailio's JSONRPC module |
| Bridge architecture | Combined `sip-bridge/` with 3 protocol clients | Single deployment, shared webhook translation, `PBX_TYPE` config selects protocol |
| TTS | mod_flite (built-in fallback) | Users record custom IVR audio for quality; mod_flite covers unrecorded prompts only |
| Scope | Full capabilities | SIP trunk config, recording management, connection testing, WebRTC via mod_verto |
| Adapter base class | `SipBridgeAdapter` abstract class | Extracts ~200 lines of shared bridge communication (ringUsers, cancelRinging, hangupCall, recording mgmt, HMAC validation, testConnection) from AsteriskAdapter; FreeSwitchAdapter extends same base |
| Migration scope | Full rename sip-bridge → sip-bridge | 121 files reference the bridge — code, tests, CI, Docker, Ansible, Helm, docs, locales all updated |

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

## Part 2: Kamailio Integration

### Role

Kamailio is a SIP proxy/load balancer — NOT a TelephonyAdapter. It sits in front of PBX instances and distributes SIP traffic:

```
Caller → PSTN → SIP Trunk → Kamailio → FreeSWITCH Instance 1
                                      → FreeSWITCH Instance 2
                                      → Asterisk Instance 3
```

Llamenos doesn't talk to Kamailio for call control — it talks to the PBX directly. Kamailio handles:
- SIP routing and load balancing (dispatcher module)
- Automatic failover if a PBX goes down (SIP OPTIONS health checks)
- Geographic routing (route to nearest PBX)
- NAT traversal for remote PBX instances
- TLS termination for secure SIP trunks

### Management via JSONRPC

The sip-bridge manages Kamailio via its JSONRPC module (`jsonrpcs`):

- `dispatcher.list` — get current PBX instance states
- `dispatcher.set_state` — enable/disable a PBX instance
- `dispatcher.reload` — reload dispatcher list after config change
- `stats.get_statistics` — SIP traffic stats for monitoring

### Config Schema

Kamailio doesn't get its own `TelephonyProviderType` — it's infrastructure config alongside the PBX:

```typescript
// Added to FreeSwitchConfig or AsteriskConfig when HA is enabled
kamailioEnabled: z.boolean().default(false),
kamailioJsonrpcUrl: z.string().url().optional(), // e.g., http://kamailio:5060/jsonrpc
kamailioDispatcherSetId: z.number().default(1),
```

### Docker Image

```yaml
kamailio:
  image: kamailio/kamailio:5.7
  ports:
    - "5060:5060/udp"    # SIP (external-facing)
    - "5061:5061"        # SIP TLS
  volumes:
    - ./kamailio.cfg:/etc/kamailio/kamailio.cfg
```

### Ansible Deployment

- `deploy/ansible/roles/kamailio/` — Ansible role
- `deploy/ansible/templates/kamailio.cfg.j2` — dispatcher config, TLS, NAT traversal
- `freeswitch_enabled` + `kamailio_enabled` variables in deployment config

---

## Part 3: Unified SIP Bridge (`sip-bridge/`)

### Architecture

Rename/extend `sip-bridge/` → `sip-bridge/` with three protocol clients:

```
sip-bridge/
  src/
    index.ts              # Entry point — select client based on PBX_TYPE
    clients/
      ari-client.ts       # Asterisk ARI (WebSocket) — extracted from sip-bridge
      esl-client.ts       # FreeSWITCH ESL (TCP socket) — new
      kamailio-client.ts  # Kamailio JSONRPC (HTTP) — new
    bridge-client.ts      # Protocol-agnostic interface all clients implement
    webhook-sender.ts     # Shared: translate events → HTTP POST to Llamenos
    health.ts             # Health endpoint (reports PBX + optional Kamailio status)
  Dockerfile
  package.json
```

### Bridge Client Interface

All three protocol clients implement the same interface:

```typescript
interface BridgeClient {
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  onEvent(handler: (event: BridgeEvent) => void): void
  // Call control (used by webhook-sender for originate/hangup)
  originate(params: OriginateParams): Promise<string>  // returns call ID
  hangup(callId: string): Promise<void>
  bridge(callId1: string, callId2: string): Promise<void>
  // Health
  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>
}
```

### Config

```env
# Asterisk mode (existing behavior, default)
PBX_TYPE=asterisk
ARI_URL=ws://asterisk:8088/ari/events
ARI_REST_URL=http://asterisk:8088/ari
ARI_USERNAME=llamenos
ARI_PASSWORD=changeme

# FreeSWITCH mode
PBX_TYPE=freeswitch
ESL_HOST=freeswitch
ESL_PORT=8021
ESL_PASSWORD=ClueCon

# Optional: Kamailio (works with any PBX_TYPE)
KAMAILIO_ENABLED=false
KAMAILIO_JSONRPC_URL=http://kamailio:5060/jsonrpc

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
4. Translate events to `BridgeEvent` objects for the webhook sender

### Kamailio Client

The Kamailio client uses HTTP JSONRPC (no persistent connection needed):

1. Periodic health poll: `dispatcher.list` to check PBX instance states
2. On PBX health change: `dispatcher.set_state` to enable/disable instances
3. Stats collection: `stats.get_statistics` for monitoring dashboard

### Event Translation (all protocols → unified BridgeEvent)

| Source | Event | BridgeEvent | Llamenos Endpoint |
|--------|-------|-------------|------------------|
| ARI | `StasisStart` | `{ channelId, callerNumber, calledNumber, state: 'Ring' }` | `/telephony/incoming` |
| ARI | `ChannelStateChange` | `{ channelId, state: 'Up'/'Hangup' }` | `/telephony/call-status` |
| ESL | `CHANNEL_CREATE` | `{ channelId, callerNumber, calledNumber, state: 'Ring' }` | `/telephony/incoming` |
| ESL | `CHANNEL_ANSWER` | `{ channelId, state: 'Up' }` | `/telephony/call-status` |
| ESL | `CHANNEL_HANGUP` | `{ channelId, state: 'Hangup', duration }` | `/telephony/call-status` |
| ESL | `RECORD_STOP` | `{ channelId, recordingName, recordingStatus: 'done' }` | `/telephony/voicemail-recording` |
| Kamailio | `dispatcher.list` | (health status only, no call events) | sip-bridge health endpoint |

### Health Endpoint

`GET /health` reports combined status:

```json
{
  "ok": true,
  "pbx": { "type": "freeswitch", "connected": true, "latencyMs": 12 },
  "kamailio": { "enabled": true, "connected": true, "dispatchers": 2, "activeInstances": 2 }
}
```

### Migration Path

Existing `sip-bridge/` users: set `PBX_TYPE=asterisk` (default) and nothing changes. New FreeSWITCH deployments set `PBX_TYPE=freeswitch`. Kamailio is opt-in via `KAMAILIO_ENABLED=true`.

---

## Files

### New Files

| File | Description |
|------|-------------|
| `src/server/telephony/freeswitch.ts` | FreeSwitchAdapter (~450 lines) — mod_httapi XML generation |
| `src/server/telephony/freeswitch.test.ts` | Unit tests for mod_httapi XML output |
| `src/server/telephony/freeswitch-capabilities.ts` | ProviderCapabilities with SIP trunk support |
| `src/shared/schemas/external/freeswitch-httapi.ts` | Zod schemas for mod_httapi and ESL events |
| `sip-bridge/src/clients/esl-client.ts` | FreeSWITCH ESL TCP client |
| `sip-bridge/src/clients/kamailio-client.ts` | Kamailio JSONRPC HTTP client |
| `sip-bridge/src/clients/ari-client.ts` | Asterisk ARI WebSocket client (extracted from sip-bridge) |
| `sip-bridge/src/bridge-client.ts` | Protocol-agnostic BridgeClient interface |
| `sip-bridge/src/index.ts` | Unified entry point (protocol selection from PBX_TYPE) |
| `sip-bridge/src/webhook-sender.ts` | Shared webhook translation (extracted from current bridge) |
| `sip-bridge/src/health.ts` | Shared health endpoint (PBX + optional Kamailio status) |
| `deploy/ansible/roles/kamailio/` | Ansible role for Kamailio deployment |
| `deploy/ansible/templates/kamailio.cfg.j2` | Kamailio routing config template |

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
| `sip-bridge/src/index.ts` | Refactor → `sip-bridge/src/ari-client.ts` + `sip-bridge/src/index.ts` |
| `sip-bridge/` | Remove after `sip-bridge/` is verified |

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
- **Bridge refactor:** verify existing Asterisk tests still pass after `sip-bridge/` → `sip-bridge/` rename
- **CI:** `sip-bridge/` gets its own `bun install` step; no FreeSWITCH container needed (mod_httapi responses generated by our server, ESL mocked)
