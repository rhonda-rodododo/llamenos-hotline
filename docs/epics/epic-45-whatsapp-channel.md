# Epic 45: WhatsApp Business Channel

## Problem

WhatsApp has 2+ billion users globally and is the primary messaging app in many regions where crisis hotlines operate (Latin America, South Asia, parts of Europe and Africa). Supporting WhatsApp lets callers reach the hotline through their preferred channel. Since July 2025, the WhatsApp Business Calling API also supports voice calls via WebRTC/SIP.

## Threat Model — Honest Limitations

**WhatsApp Business Cloud API breaks end-to-end encryption.** This is the most significant limitation:

- **Meta decrypts messages** at their Cloud API servers. Meta acts as a "data processor" but has technical access to message content at the decryption point.
- **Meta retains metadata:** phone numbers, timestamps, frequency, duration, IP addresses, device info, group memberships.
- **Legal compulsion:** Meta can be compelled via US legal process to provide decrypted content and metadata. Meta complies with ~75% of US government data requests.
- **On-Premises API** (which preserved true E2EE) was **deprecated in 2025**. There is no E2EE-preserving option for business use.
- **WhatsApp requires phone numbers** — no anonymous access possible.

**What we CAN protect:**
- Once content reaches our server from Meta's API, it's immediately ECIES-encrypted and plaintext is discarded.
- Stored messages are ciphertext only.
- Volunteer identity is protected — WhatsApp caller communicates with the business number, never directly with volunteers.
- Voice calls via WhatsApp Business Calling API use WebRTC (encrypted in transit) but Meta manages the signaling.

**Admin UI must prominently display:** "WhatsApp messages pass through Meta's servers in plaintext. Meta can access message content and retains extensive metadata. Enable this channel only if the accessibility benefit outweighs the privacy trade-off for your deployment."

**Per-channel security label in conversation UI:** "Transport: WhatsApp (Meta can access content in transit)"

## Solution

Implement `WhatsAppAdapter` using the WhatsApp Business Cloud API (via Meta directly or through Twilio as a BSP). Support both messaging and voice calling.

## WhatsApp Business Setup Requirements

1. **Meta Business Account** — verified with Meta Business Verification
2. **WhatsApp Business Account** — created through Meta Business Manager
3. **Phone number** — can be the same hotline number or a separate WhatsApp-specific number
4. **Business Solution Provider (BSP)** — either direct (Meta Graph API) or via Twilio/Vonage

### Two Integration Paths

**Path A: Direct Meta Cloud API**
- Register via Meta Business Manager
- Webhooks configured in Meta App Dashboard
- Messages via Graph API: `POST /v21.0/{phone-number-id}/messages`
- Voice via Graph API: WebRTC SDP offer/answer exchange
- Lower per-message cost but more setup

**Path B: Via Twilio (recommended for existing Twilio users)**
- Configure WhatsApp sender in Twilio console
- Messages via Twilio Messaging API (same API as SMS, different `From: whatsapp:+{number}`)
- Voice via Twilio Programmable Voice (TwiML-based, same as phone calls)
- Higher per-message cost but unified billing and familiar API

## WhatsAppAdapter Implementation

```typescript
class WhatsAppAdapter implements MessagingAdapter {
  readonly channelType = 'whatsapp'

  // Two sub-implementations
  constructor(private config: WhatsAppConfig) {
    this.client = config.provider === 'meta-direct'
      ? new MetaDirectClient(config)
      : new TwilioWhatsAppClient(config)
  }
}

interface WhatsAppConfig {
  provider: 'meta-direct' | 'twilio'
  // Meta Direct
  phoneNumberId?: string
  businessAccountId?: string
  accessToken?: string      // encrypted in SettingsDO
  verifyToken?: string      // webhook verification
  appSecret?: string        // webhook signature validation
  // Twilio
  twilioAccountSid?: string
  twilioAuthToken?: string  // encrypted
  twilioWhatsAppNumber?: string
}
```

## Messaging Flow

### Inbound (user → hotline)

1. User sends WhatsApp message to business number
2. Meta delivers webhook to `/api/messaging/whatsapp/webhook`
3. Webhook types handled:
   - `text` — plain text message
   - `image`, `video`, `audio`, `document` — media messages
   - `location` — GPS coordinates
   - `contacts` — shared contact cards
   - `reaction` — emoji reactions
   - `interactive` — button/list responses
4. Adapter validates webhook signature (HMAC-SHA256 with app secret)
5. Standard encryption and storage flow (per Epic 42)

### Outbound (volunteer → user)

1. Volunteer composes reply in conversation UI
2. Server sends via WhatsApp API
3. **24-hour window rule:** WhatsApp restricts business-initiated messages. After a user messages, the business has 24 hours to respond freely. After that, only pre-approved template messages can be sent.
4. Auto-detect window status and warn volunteer if template-only mode

### Voice Calling (WhatsApp Business Calling API)

**Inbound calls:**
1. User taps call icon in WhatsApp chat with the business
2. Meta sends webhook with WebRTC SDP offer
3. Server routes to on-shift volunteer's browser (WebRTC endpoint)
4. Volunteer answers → SDP answer sent back → audio stream established
5. This integrates with the existing WebRTC calling infrastructure

**Limitations:**
- No PSTN bridging — cannot ring volunteers' phones, only WebRTC endpoints
- Volunteers must use browser-based calling (`callPreference: 'browser'`)
- Max 1,000 concurrent calls per WhatsApp Business Account

**Implementation:** Extend `CallRouterDO` to handle WhatsApp voice calls alongside telephony calls. WhatsApp calls marked with `channelType: 'whatsapp'` in `CallRecord`.

## Template Messages

For re-engaging users after the 24-hour window, pre-approved templates are needed:

- **Follow-up:** "Hi, this is [Hotline Name]. We wanted to check in on you. Reply if you'd like to talk."
- **Missed message:** "We received your message but couldn't respond in time. Please reach out again — we're here for you."

Templates must be submitted to Meta for approval (typically 24-48 hours).

## Files

- **Create:** `src/worker/messaging/whatsapp/adapter.ts` — WhatsAppAdapter
- **Create:** `src/worker/messaging/whatsapp/meta-client.ts` — direct Meta Graph API client
- **Create:** `src/worker/messaging/whatsapp/twilio-client.ts` — Twilio WhatsApp client
- **Create:** `src/worker/messaging/whatsapp/types.ts` — WhatsApp-specific types (webhook payloads, templates)
- **Create:** `src/worker/messaging/whatsapp/voice.ts` — WhatsApp calling SDP/WebRTC handling
- **Modify:** `src/worker/durable-objects/settings-do.ts` — WhatsAppConfig
- **Modify:** `src/worker/durable-objects/call-router.ts` — handle WhatsApp voice calls
- **Modify:** `src/client/components/settings/` — WhatsApp channel configuration UI
- **Create:** `src/client/components/WhatsAppSetupGuide.tsx` — step-by-step Meta Business setup

## Dependencies

- Epic 42 (Messaging Architecture)
- Epic 43 (Setup Wizard — channel configuration flows)

## Testing

- E2E: Inbound text message → encrypted storage → volunteer sees and replies → user receives reply
- E2E: Inbound media (image, audio, video) → encrypted R2 storage → volunteer views decrypted
- E2E: 24-hour window expiry → volunteer warned → template message fallback
- E2E: WhatsApp voice call → WebRTC routing → volunteer answers in browser
- E2E: Webhook signature validation rejects forged webhooks
