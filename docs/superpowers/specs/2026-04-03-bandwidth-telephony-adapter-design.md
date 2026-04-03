# Design: Bandwidth Telephony Adapter

**Date:** 2026-04-03
**Status:** Draft

## Overview

Implement a TelephonyAdapter for Bandwidth — a US carrier-grade CPaaS provider. Bandwidth owns PSTN infrastructure (unlike Twilio which resells), offering better call quality and 50-70% lower costs. Popular with nonprofits, government, and enterprise.

## Architecture

Bandwidth uses **BXML** (Bandwidth XML) — similar to Twilio's TwiML. The adapter returns BXML XML in response to webhook callbacks. This is the same pattern as our TwilioAdapter.

### Authentication
- **API calls:** Basic auth with `{accountId}:{apiToken}`
- **Webhooks:** Basic auth callback validation (configurable username/password per application)

### Key Differences from Twilio
- BXML verbs: `<SpeakSentence>` (not `<Say>`), `<PlayAudio>` (not `<Play>`), `<Gather>` is similar
- Call creation: POST to `/v2/accounts/{accountId}/calls`
- Recording: `<StartRecording>` / `<StopRecording>` inline BXML verbs
- Bridging: `<Bridge>` verb connects two calls
- No queue system — use `<Ring>` + `<PlayAudio>` for hold, bridge manually

### Call Flow Mapping

| Llamenos Flow | BXML |
|---------------|------|
| Language menu | `<Gather>` + `<SpeakSentence>` per language |
| CAPTCHA | `<Gather maxDigits="4">` + `<SpeakSentence>` |
| Hold music | `<PlayAudio>` with redirect loop |
| Ring volunteers | POST `/calls` per volunteer |
| Bridge | `<Bridge targetCall="{callId}">` |
| Voicemail | `<StartRecording>` + `<SpeakSentence>` |
| Reject | `<Hangup>` |

### Webhook Events
- `initiate` — new inbound call
- `answer` — call answered
- `disconnect` — call ended
- `transferComplete` / `transferDisconnect` — bridge events
- `gather` — DTMF digits collected
- `recordingAvailable` — recording ready for download

## Config Schema

```typescript
const BandwidthConfigSchema = BaseProviderSchema.extend({
  type: z.literal('bandwidth'),
  accountId: z.string().min(1),
  apiToken: z.string().min(1),
  apiSecret: z.string().min(1),
  applicationId: z.string().min(1), // Bandwidth Voice Application ID
  // WebRTC
  webrtcEnabled: z.boolean().optional(),
})
```

## Files

| File | Action |
|------|--------|
| `src/server/telephony/bandwidth.ts` | Create — BandwidthAdapter (BXML pattern, ~450 lines) |
| `src/server/telephony/bandwidth-capabilities.ts` | Create — ProviderCapabilities |
| `src/shared/schemas/providers.ts` | Modify — add BandwidthConfigSchema |
| `src/shared/schemas/external/bandwidth-voice.ts` | Create — webhook payload schemas |
| `src/server/lib/adapters.ts` | Modify — register adapter |
| `src/server/provider-setup/bandwidth.ts` | Create — number provisioning |

## Implementation Notes

- BXML is similar enough to TwiML that we could create a shared XML builder
- Bandwidth provides WebRTC via their `webrtc` API — different from Twilio's but achieves same result
- Number provisioning: Bandwidth owns numbers directly, search/order via `/availableNumbers` and `/orders`
- SMS/MMS: Bandwidth has its own Messaging API (separate from voice) — add BandwidthSMSAdapter too

## Testing

- Unit tests: BXML output validation (same pattern as Twilio TwiML tests)
- Mock webhook payloads for all event types
- Live testing requires Bandwidth account (free trial available)
