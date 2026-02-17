# Epic 43: SMS Channel

## Problem

SMS is the most accessible text-based crisis channel. It works on every phone (including non-smartphones), requires no app installation, and is the established model for crisis text services (988, Crisis Text Line). The hotline phone number should accept both calls and texts.

## Threat Model — Honest Limitations

**SMS is NOT end-to-end encrypted.** This must be clearly communicated:

- **Carriers** (AT&T, T-Mobile, Verizon, etc.) can read SMS content in transit and may retain it per their data retention policies.
- **Telephony providers** (Twilio, SignalWire, Vonage, Plivo) process SMS content in plaintext and may log it per their policies. Twilio retains message bodies for 400 days by default (configurable).
- **Law enforcement** can obtain SMS content and metadata via subpoena to carriers or providers.
- **SS7 vulnerabilities** allow sophisticated attackers to intercept SMS in transit.

**What we CAN protect:**
- Once an SMS reaches our server, the content is immediately ECIES-encrypted (dual: volunteer + admin) and the plaintext is discarded from server memory.
- Stored messages are ciphertext only — a database breach reveals nothing.
- Volunteer identity is still protected — the caller's SMS goes to the hotline number, not directly to a volunteer's phone.

**Admin UI must display:** "SMS messages are encrypted at rest but visible to carriers and your telephony provider during transit. Do not use SMS for the most sensitive communications."

## Solution

Implement `SMSAdapter` for each supported telephony provider. All five providers (Twilio, SignalWire, Vonage, Plivo, Asterisk) support SMS on the same number used for voice calls. The adapter translates provider-specific SMS webhook formats into the unified `IncomingMessage` type from Epic 42.

## Provider Implementations

### TwilioSMSAdapter

Webhook fields: `From`, `To`, `Body`, `MessageSid`, `NumMedia`, `MediaUrl0..N`, `MediaContentType0..N`
Validation: Twilio signature verification (same `X-Twilio-Signature` HMAC as voice)
Outbound: `POST /2010-04-01/Accounts/{sid}/Messages.json` with `To`, `From`, `Body`
MMS: `MediaUrl` parameter for outbound; `MediaUrl{N}` fields on inbound

### SignalWireSMSAdapter

Nearly identical to Twilio (cXML compatibility). Same webhook fields, same signature validation.
Outbound: compatible REST API at SignalWire's base URL.
Can extend `TwilioSMSAdapter` and override base URL (same pattern as `SignalWireAdapter` extends `TwilioAdapter` for voice).

### VonageSMSAdapter

Webhook: JSON body with `msisdn` (sender), `to`, `text`, `messageId`, `type`
Validation: JWT signature verification or signed webhook with `X-Vonage-Signature`
Outbound: Messages API v1 — `POST /v1/messages` with `channel: "sms"`, `message_type: "text"`
MMS: supported via Messages API with `message_type: "image"/"video"/"audio"/"file"`

### PlivoSMSAdapter

Webhook: `From`, `To`, `Text`, `MessageUUID`, `Type` (sms/mms), `Media0..N` (MMS)
Validation: signature validation via `X-Plivo-Signature-V3` + nonce
Outbound: `POST /v1/Account/{id}/Message/` with `src`, `dst`, `text`
MMS: `media_urls` parameter for outbound

### AsteriskSMSAdapter

Asterisk SMS support is limited and provider-dependent:
- SIP MESSAGE method for SIP-based messaging (limited carrier support)
- External SMS via AMI/ARI commands to SIP trunks that support it
- Most Asterisk deployments use a separate SMS provider alongside Asterisk for voice
- Implementation: if the telephony provider is Asterisk, SMS config points to a separate provider (e.g., Twilio for SMS alongside Asterisk for voice)

## Webhook Configuration

Each provider needs the SMS webhook URL configured to point to:
`https://{worker-domain}/api/messaging/sms/webhook`

For providers that use the same webhook URL for voice and SMS (Twilio, SignalWire), the main webhook router inspects the request to determine if it's a voice call or SMS and routes accordingly.

For providers where voice and SMS have separate webhook configs (Vonage, Plivo), the admin configures the SMS webhook URL separately.

## Inbound Message Flow

1. Caller sends SMS to hotline number
2. Provider delivers webhook to `/api/messaging/sms/webhook`
3. `SMSAdapter.validateWebhook()` verifies signature
4. `SMSAdapter.parseIncomingMessage()` extracts sender, body, media
5. Server hashes sender phone number for storage
6. Server encrypts message body via ECIES (dual-encrypted: volunteer + admin)
7. If media attachments exist: download from provider, encrypt with ECIES, upload to R2 (see Epic 46)
8. Store encrypted message in `ConversationDO`
9. Route to on-shift volunteer (new conversation) or existing assignee (ongoing conversation)
10. WebSocket broadcast: `message:new` or `conversation:new`

## Outbound Message Flow

1. Volunteer types reply in `ConversationThread` UI
2. Client encrypts message via ECIES (dual: self + admin)
3. `POST /api/conversations/:id/messages` with encrypted content + plaintext for sending
4. Server calls `SMSAdapter.sendMessage()` to deliver via provider
5. Server stores the encrypted copy, discards plaintext
6. Provider delivers SMS to the caller

**Security note:** The outbound plaintext must transit the server briefly to reach the provider API. This is unavoidable with SMS — the provider must see the content to deliver it. The server discards the plaintext after the API call succeeds.

## Auto-Response Configuration

Admin-configurable auto-responses for:
- **First contact:** "You've reached [Hotline Name]. A volunteer will respond shortly. If this is an emergency, call [number]."
- **After hours:** "Our text line is currently unattended. Please call [number] for immediate help."
- **Conversation closed:** "This conversation has been closed. Text again anytime to start a new one."

Auto-response templates stored in `SettingsDO` as part of `MessagingConfig`, translatable via i18n.

## Provider Message Retention Cleanup

To minimize exposure, implement optional post-delivery cleanup:
- **Twilio:** Call `DELETE /Messages/{sid}` after message is encrypted and stored. This removes the message body from Twilio's logs. Configurable per-deployment (some orgs may need Twilio's logs for compliance).
- **Other providers:** Similar deletion APIs where available.

Admin toggle: "Delete messages from provider after processing" (default: on).

## Files

- **Create:** `src/worker/messaging/sms/adapter.ts` — SMSAdapter interface
- **Create:** `src/worker/messaging/sms/twilio.ts` — TwilioSMSAdapter
- **Create:** `src/worker/messaging/sms/signalwire.ts` — SignalWireSMSAdapter (extends Twilio)
- **Create:** `src/worker/messaging/sms/vonage.ts` — VonageSMSAdapter
- **Create:** `src/worker/messaging/sms/plivo.ts` — PlivoSMSAdapter
- **Create:** `src/worker/messaging/sms/asterisk.ts` — AsteriskSMSAdapter (external provider wrapper)
- **Create:** `src/worker/messaging/sms/factory.ts` — createSMSAdapter() from config
- **Modify:** `src/worker/durable-objects/settings-do.ts` — SMSConfig, auto-response templates
- **Modify:** `src/client/components/settings/` — SMS channel configuration UI
- **Modify:** Telephony provider setup docs (all 13 locales) — add SMS webhook setup instructions

## Dependencies

- Epic 42 (Messaging Architecture)

## Testing

- E2E: Send SMS via provider test API → verify webhook received → verify encrypted message stored → verify volunteer sees conversation → verify reply delivered
- E2E: Auto-response on first contact, after hours, conversation close
- E2E: MMS with image attachment → encrypted upload to R2 → volunteer sees decrypted image
- E2E: Provider message deletion after processing
