# Design: Sinch Telephony Adapter

**Date:** 2026-04-03
**Status:** Draft

## Overview

Implement a TelephonyAdapter for Sinch — a global CPaaS provider with strong coverage in Latin America, Europe, and Asia. Uses SVAML (Sinch Voice Application Markup Language) — a JSON-based call control format.

## Architecture

Sinch uses **callback + SVAML response** model:
1. Incoming call → Sinch sends ICE (Incoming Call Event) webhook
2. Server responds with SVAML JSON (instructions for the call)
3. Call events → ACE (Answered Call Event), DiCE (Disconnected Call Event)

This is similar to Vonage's NCCO pattern — return JSON instructions.

### Authentication
- **API calls:** Application key + secret (Basic auth or signed requests)
- **Webhooks:** Callback signing with application secret (HMAC-SHA256)

### SVAML Actions & Instructions

| Action | Purpose |
|--------|---------|
| `runMenu` | IVR menu with TTS + DTMF gathering |
| `hangup` | End the call |
| `continue` | Continue to next callback |
| `connectPstn` | Bridge to PSTN number |
| `connectMxp` | Connect via Sinch SDK (WebRTC) |
| `park` | Hold the call (play audio) |

| Instruction | Purpose |
|-------------|---------|
| `say` | TTS playback |
| `playFiles` | Play audio URL |
| `startRecording` | Begin recording |
| `sendDtmf` | Send DTMF tones |

### Call Flow Mapping

| Llamenos Flow | SVAML |
|---------------|-------|
| Language menu | ICE response: `runMenu` with `options` per digit |
| CAPTCHA | `runMenu` with maxDigits + TTS prompt |
| Hold music | `park` action with `playFiles` instruction |
| Ring volunteers | POST `/calling/v1/callouts` per volunteer |
| Bridge | `connectPstn` with volunteer's number |
| Voicemail | `startRecording` instruction + `say` prompt |
| Reject | `hangup` action |

## Config Schema

```typescript
const SinchConfigSchema = BaseProviderSchema.extend({
  type: z.literal('sinch'),
  applicationKey: z.string().min(1),
  applicationSecret: z.string().min(1),
  projectId: z.string().optional(),
  region: z.enum(['us', 'eu', 'au', 'br', 'se']).default('us'),
})
```

## Geographic Advantage

Sinch has local numbers and PSTN infrastructure in:
- **Latin America:** Brazil, Mexico, Colombia, Argentina, Chile
- **Europe:** All EU + UK, Switzerland, Norway
- **Asia:** India, Singapore, Japan, Philippines
- **Middle East:** UAE, Saudi Arabia

This matters for crisis hotlines serving immigrant communities — callers can reach a local number.

## Files

| File | Action |
|------|--------|
| `src/server/telephony/sinch.ts` | Create — SinchAdapter (SVAML pattern, ~400 lines) |
| `src/server/telephony/sinch-capabilities.ts` | Create — ProviderCapabilities |
| `src/shared/schemas/providers.ts` | Modify — add SinchConfigSchema |
| `src/shared/schemas/external/sinch-voice.ts` | Create — webhook schemas |
| `src/server/lib/adapters.ts` | Modify — register adapter |
| `src/server/provider-setup/sinch.ts` | Create — number provisioning |

## Testing

- Unit tests: SVAML output validation
- Webhook signature verification tests
- Live testing requires Sinch account
