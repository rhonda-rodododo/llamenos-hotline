# Design: FreeSWITCH Adapter + Kamailio Load Balancer

**Date:** 2026-04-03
**Status:** Draft

## Overview

Two complementary self-hosted telephony components:
1. **FreeSWITCH Adapter** — alternative to Asterisk for call control, using ESL (Event Socket Library)
2. **Kamailio Integration** — SIP proxy/load balancer for high-availability deployments

## Part 1: FreeSWITCH Adapter

### Architecture

FreeSWITCH uses ESL (Event Socket Library) for programmatic call control — analogous to Asterisk's ARI but with a different paradigm:

- **Inbound ESL:** FreeSWITCH connects TO your app (socket server mode)
- **Outbound ESL:** Your app connects TO FreeSWITCH and subscribes to events

For Llamenos, we use **outbound ESL** — the app connects to FreeSWITCH's event socket and issues commands.

```
Caller → PSTN → FreeSWITCH → ESL connection → Llamenos Server
                     ↕
         Volunteer ← SIP/WebRTC
```

### ESL Command Mapping

| Llamenos Flow | ESL Commands |
|---------------|-------------|
| Answer call | `answer` |
| Language menu | `play_and_get_digits` (TTS + DTMF collection) |
| CAPTCHA | `play_and_get_digits` with max 4 digits |
| Hold music | `playback` with loop |
| Ring volunteers | `originate` per volunteer |
| Bridge | `uuid_bridge` (connect two call legs) |
| Voicemail | `record` + `speak` |
| Hangup | `hangup` |
| Recording | `uuid_record` (start/stop recording) |

### ESL Events

| Event | FreeSWITCH Name | Purpose |
|-------|----------------|---------|
| Incoming call | `CHANNEL_CREATE` | New inbound call |
| Call answered | `CHANNEL_ANSWER` | Leg answered |
| DTMF received | `DTMF` | Digit press |
| Call ended | `CHANNEL_HANGUP_COMPLETE` | Call terminated |
| Recording complete | `RECORD_STOP` | Recording file ready |

### Node.js ESL Library

Use `modesl` (modern ESL for Node.js) or `drachtio-srf` (SIP request framework):

```typescript
import { Connection } from 'modesl'

const esl = new Connection('localhost', 8021, 'ClueCon', () => {
  esl.subscribe(['CHANNEL_CREATE', 'CHANNEL_ANSWER', 'CHANNEL_HANGUP_COMPLETE', 'DTMF'])
  esl.on('esl::event::CHANNEL_CREATE::*', (event) => {
    const callId = event.getHeader('Unique-ID')
    const from = event.getHeader('Caller-Caller-ID-Number')
    // Handle incoming call...
  })
})
```

### Config Schema

```typescript
const FreeSwitchConfigSchema = BaseProviderSchema.extend({
  type: z.literal('freeswitch'),
  eslHost: z.string().default('localhost'),
  eslPort: z.number().default(8021),
  eslPassword: z.string().default('ClueCon'),
  // WebRTC (uses verto or SIP over WSS)
  webrtcEnabled: z.boolean().optional(),
  wssPort: z.number().optional(),
})
```

### Docker Image

```yaml
freeswitch:
  image: safarov/freeswitch:1.10
  ports:
    - "5060:5060/udp"    # SIP
    - "8021:8021"        # ESL
    - "8082:8082"        # WSS (verto)
  volumes:
    - freeswitch-config:/etc/freeswitch
```

### Files

| File | Action |
|------|--------|
| `src/server/telephony/freeswitch.ts` | Create — FreeSwitchAdapter (~500 lines) |
| `src/server/telephony/freeswitch-capabilities.ts` | Create — ProviderCapabilities |
| `src/server/telephony/freeswitch-provisioner.ts` | Create — SIP endpoint provisioning |
| `src/shared/schemas/providers.ts` | Modify — add FreeSwitchConfigSchema |
| `deploy/docker/docker-compose.yml` | Modify — add freeswitch service (profile) |

---

## Part 2: Kamailio Load Balancer

### Role

Kamailio sits in front of multiple PBX instances (Asterisk or FreeSWITCH) and distributes SIP traffic:

```
Caller → PSTN → Kamailio → Asterisk/FreeSWITCH Instance 1
                         → Asterisk/FreeSWITCH Instance 2
                         → Asterisk/FreeSWITCH Instance 3
```

### Use Case

For high-availability crisis hotlines that can't afford downtime:
- Active-active across 2+ PBX instances
- Automatic failover if one PBX goes down
- Geographic load balancing (route to nearest PBX)

### Architecture

Kamailio is NOT a TelephonyAdapter — it's **infrastructure** that sits below the adapter layer:
- Transparently proxies SIP between trunk providers and PBX instances
- Llamenos doesn't need to know Kamailio exists
- Configuration is purely in Kamailio's `kamailio.cfg` routing rules

### Integration

1. SIP trunk provider points at Kamailio's IP
2. Kamailio routes to available PBX instances
3. PBX handles call control via existing adapters (Asterisk ARI / FreeSWITCH ESL)
4. Llamenos connects to the PBX directly for call control

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

### Config Template

The Ansible role would template a `kamailio.cfg` with:
- Dispatcher module for load balancing across PBX IPs
- TLS support for secure SIP trunks
- NAT traversal for remote PBX instances
- Health checks (SIP OPTIONS pings to each PBX)

### Files

| File | Action |
|------|--------|
| `deploy/docker/docker-compose.yml` | Modify — add kamailio service (profile) |
| `deploy/ansible/roles/kamailio/` | Create — Ansible role for kamailio deployment |
| `deploy/ansible/templates/kamailio.cfg.j2` | Create — routing config template |

---

## Implementation Priority

1. **FreeSWITCH adapter** — fills the "alternative PBX" gap, client-side already supports it
2. **Kamailio** — infrastructure for HA, not an adapter — deploy config only
3. **Generic SIP trunk** (separate spec) — works with both Asterisk and FreeSWITCH

## Testing

### FreeSWITCH
- Unit tests: ESL command generation, event parsing
- Integration: Docker FreeSWITCH + ESL connection test
- E2E: Full call flow through FreeSWITCH

### Kamailio
- Integration: SIP OPTIONS health check through Kamailio to PBX
- Load test: Verify round-robin across multiple PBX instances
