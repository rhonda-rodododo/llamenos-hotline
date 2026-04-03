# Spec: Incomplete Adapter Completion

**Date:** 2026-04-02
**Priority:** Medium (Provider Coverage)
**Status:** Draft

## Overview

Four adapter implementations are incomplete: Telnyx telephony (runtime 501), Telnyx SMS (factory throws), SignalWire WebRTC tokens (throws), and Vonage webhook verification (returns warning). This spec covers completing each adapter.

---

## Adapter 1: Telnyx Telephony Runtime

### Current State
- **Capabilities:** Fully defined in `src/server/telephony/telnyx-capabilities.ts` (OAuth, SMS, SIP, WebRTC, number provisioning, webhook auto-config)
- **Config schema:** Defined in `src/shared/schemas/providers.ts` — `{ type: 'telnyx', apiKey, texmlAppId?, phoneNumber }`
- **Runtime:** Throws `501 Not Implemented` at `src/server/lib/adapters.ts:195-199`

### Required Work

Create `src/server/telephony/telnyx.ts` implementing the full `TelephonyAdapter` interface (23 methods):

**IVR/Call Handling (5):** `handleLanguageMenu`, `handleIncomingCall`, `handleCaptchaResponse`, `handleCallAnswered`, `handleVoicemail`

**Call Control (5):** `handleWaitMusic`, `rejectCall`, `hangupCall`, `ringUsers`, `cancelRinging`

**Webhook Validation & Recording (4):** `validateWebhook`, `getCallRecording`, `getRecordingAudio`, `deleteRecording`

**Webhook Parsing (7):** `parseIncomingWebhook`, `parseLanguageWebhook`, `parseCaptchaWebhook`, `parseCallStatusWebhook`, `parseQueueWaitWebhook`, `parseQueueExitWebhook`, `parseRecordingWebhook`

**Response Helpers (3):** `handleVoicemailComplete`, `handleUnavailable`, `emptyResponse`

**Health & Config (2):** `testConnection`, `verifyWebhookConfig`

### Implementation Notes

- Telnyx uses **TeXML** (their TwiML equivalent) — XML-based, very similar to Twilio
- Can reference `TwilioAdapter` as primary template since TeXML is nearly identical
- Key differences: API base URL (`https://api.telnyx.com/v2`), auth header format, call control endpoint paths
- TeXML docs: use context7 to look up current Telnyx TeXML reference

### Dependencies
- Telnyx account for testing
- Telnyx phone number provisioned

---

## Adapter 2: Telnyx SMS

### Current State
- Factory throws at `src/server/messaging/sms/factory.ts:86-88`
- Other SMS adapters (Twilio, SignalWire, Vonage, Plivo) are fully implemented

### Required Work

Create `src/server/messaging/sms/telnyx.ts` implementing `MessagingAdapter`:

```typescript
interface MessagingAdapter {
  readonly channelType: MessagingChannelType
  parseIncomingMessage(request: Request): Promise<IncomingMessage>
  validateWebhook(request: Request): Promise<boolean>
  sendMessage(params: SendMessageParams): Promise<SendResult>
  sendMediaMessage(params: SendMediaParams): Promise<SendResult>
  getChannelStatus(): Promise<ChannelStatus>
  parseStatusWebhook?(request: Request): Promise<MessageStatusUpdate | null>
}
```

### Implementation Notes

- Reference `TwilioSMSAdapter` (`src/server/messaging/sms/twilio.ts`) as template
- Telnyx webhooks are **JSON** (not form-encoded like Twilio)
- Telnyx uses webhook signing secret for validation
- REST API: `POST https://api.telnyx.com/v2/messages`
- Status mapping: Telnyx statuses → normalized `MessageDeliveryStatus`

---

## Adapter 3: SignalWire WebRTC Token

### Current State
- Throws at `src/server/telephony/webrtc-tokens.ts:24`
- `isWebRtcConfigured()` returns `false` for SignalWire at line 57

### Required Work

Add `generateSignalWireToken()` function in `webrtc-tokens.ts`.

### Implementation Notes

- SignalWire uses the **same JWT format as Twilio** (HS256 with Voice grant)
- The existing `generateTwilioToken()` function (lines 69-101) is the exact template
- Key difference: config uses `signalwireSpace` instead of Twilio's account structure
- Also update `isWebRtcConfigured()` to return `true` when SignalWire has WebRTC config

### Scope

~30 lines of code. Copy Twilio token logic, adapt config extraction.

---

## Adapter 4: Vonage Webhook Verification

### Current State
- Returns warning string at `src/server/telephony/vonage.ts:594-607`
- `verifyWebhookConfig()` doesn't actually verify

### Required Work

Implement actual Vonage Application API query:
1. Sign JWT with RS256 using the stored private key
2. Query `GET /v1/applications/{applicationId}` with JWT auth
3. Extract `voice_webhooks` from response
4. Compare incoming/status URLs with expected base URL
5. Return proper `WebhookVerificationResult` with `actualUrl` field

### Implementation Notes

- Vonage requires application-level JWT auth (RS256, not HMAC)
- Private key is already available in the adapter config
- The code at `vonageCapabilities.testConnection` already does JWT signing — reuse that pattern
- Use context7 to look up Vonage Application API endpoint format

---

## Testing Strategy

### Telnyx Telephony
- Unit tests for TeXML output correctness
- Mock HTTP client for API calls
- Live testing requires Telnyx account (optional, deferred)

### Telnyx SMS
- Unit tests for webhook parsing (JSON format)
- Unit tests for message sending (API construction)
- Mock HTTP client

### SignalWire WebRTC
- Unit test for JWT token structure
- Verify token is valid HS256 with correct grants

### Vonage Webhook Verification
- Unit test with mocked Vonage API response
- Test correct JWT construction
- Test URL comparison logic
