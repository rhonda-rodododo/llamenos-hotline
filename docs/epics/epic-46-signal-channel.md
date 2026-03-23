# Epic 46: Signal Channel

## Problem

Signal is the gold standard for private messaging. For a crisis hotline with an advanced threat model, Signal provides the strongest transport encryption of any messaging platform. Users who choose Signal are often the most security-conscious and most in need of communication privacy. However, Signal has no official API — integration requires an unofficial bridge that introduces fragility and operational overhead.

## Threat Model — Honest Assessment

**Transport encryption is the strongest of all channels, but the bridge is a trust point:**

- **Signal Protocol** (Double Ratchet + X3DH) provides forward secrecy and post-compromise security for the transport leg (user's device → bridge server).
- **The bridge server decrypts messages.** `signal-cli` acts as a Signal client and must decrypt incoming messages to process them. This is "end-to-bridge encryption" (E2BE), not true E2EE.
- **The bridge is self-hosted** — unlike WhatsApp (Meta controls the decryption point) or SMS (carrier controls), the bridge runs on infrastructure you control. This keeps the trust boundary within your organization.
- **Minimal metadata:** Signal retains almost no metadata server-side. No contacts, no message history, no IP logs (with "relay calls" enabled). The bridge server is the primary metadata accumulator.
- **No phone number exposure to third parties:** Signal contacts see only the hotline's Signal number. Volunteer identities are fully hidden.

**Operational risks:**
- `signal-cli` is unofficial and can break when Signal updates its protocol (~every 3 months)
- Signal can ban the account without notice or recourse
- No SLA, no support, no guarantee of continued compatibility
- Rate limiting can throttle message delivery during high-volume periods

**At-rest protection:** Same as all channels — messages ECIES-encrypted immediately upon receipt, plaintext discarded.

**Admin UI must display:** "Signal provides strong transport encryption. Messages are decrypted at our self-hosted bridge server (within your infrastructure) for processing, then re-encrypted for storage. The bridge requires ongoing maintenance as Signal updates its protocol."

**Per-channel security label:** "Transport: Signal (E2EE to bridge, strongest available)"

## Solution

Deploy `signal-cli-rest-api` as a sidecar service alongside the Bun/Hono backend. The Worker communicates with the Signal bridge via authenticated HTTP. The bridge runs in a Docker container on the same VPS infrastructure the admin controls.

## Architecture

```
[Signal User] ←—Signal Protocol—→ [Signal Servers] ←—Signal Protocol—→ [signal-cli-rest-api]
                                                                              ↓
                                                                        [HTTP webhook]
                                                                              ↓
                                                          [Bun/Hono Worker /api/messaging/signal/webhook]
                                                                              ↓
                                                                    [ECIES encrypt + store]
```

The Signal bridge is NOT part of the primary application process. It's a separate Docker service that the admin provisions and connects via configuration.

## Signal Bridge Setup

### Prerequisites

1. A Linux server (VPS, on-premises, or container platform)
2. Docker installed
3. A phone number for Signal registration (can be the hotline number)
4. Network access to Signal's servers (ports 443, 4433)
5. A reverse proxy with TLS (for webhook delivery to the backend)

### Deployment

```bash
docker run -d --name signal-api \
  -p 8080:8080 \
  -v signal-data:/home/.local/share/signal-cli \
  -e MODE=json-rpc \
  bbernhard/signal-cli-rest-api:latest
```

### Registration

Manual registration via curl (for reference). See **Automated Registration** below for the recommended flow when the hotline number is a Twilio/cloud number.

```bash
# Register the hotline number with Signal
curl -X POST 'http://localhost:8080/v1/register/{number}' \
  -H 'Content-Type: application/json' \
  -d '{"use_voice": true}'  # use voice verification if number is a landline/VoIP

# Verify with the code received
curl -X POST 'http://localhost:8080/v1/register/{number}/verify/{code}'

# Set registration lock PIN
curl -X PUT 'http://localhost:8080/v1/accounts/{number}/settings' \
  -H 'Content-Type: application/json' \
  -d '{"registration_lock_pin": "..."}'
```

### Webhook Configuration

Configure signal-cli-rest-api to forward incoming messages to the Worker:

```bash
curl -X POST 'http://localhost:8080/v1/receive/{number}' \
  -H 'Content-Type: application/json' \
  -d '{"webhook_url": "https://{worker-domain}/api/messaging/signal/webhook", "webhook_auth": "Bearer {shared-secret}"}'
```

## Automated Registration

When the hotline's phone number is a Twilio (or other cloud telephony) number, the Signal verification SMS arrives inbound to that same number — which already has its SMS webhook pointing at our backend. We intercept it automatically, eliminating the need for manual curl commands during setup.

**Signal verification SMS format:** `"Your Signal code: 123456 Do not share this code."` — reliable, stable pattern extractable by regex.

### SMS Intercept Flow (Automatic)

1. Admin clicks "Register Signal" in the setup wizard or settings panel.
2. Frontend calls `POST /api/messaging/signal/register` with `{ bridgeUrl, registeredNumber, useVoice: false }`.
3. Worker calls `POST /v1/register/{number}` on the signal-cli-rest-api bridge.
4. Worker writes `signalRegistrationPending: { number, bridgeUrl, expiresAt }` to SettingsDO (10-minute TTL).
5. Worker returns `{ ok: true, method: 'sms' }` — UI shows "Waiting for verification SMS…" with countdown.
6. Signal sends a 6-digit verification SMS to the hotline Twilio number.
7. Twilio routes the SMS to `/api/messaging/sms/webhook` (already configured).
8. SMS webhook reads `signalRegistrationPending` from SettingsDO. If the flag is set **and** the body matches the Signal verification pattern, it intercepts the message (does not route to the conversation handler).
9. Worker extracts the 6-digit code and calls `POST /v1/register/{number}/verify/{code}` on the bridge.
10. On success: Worker persists `SignalConfig` in SettingsDO, clears `signalRegistrationPending`.
11. UI polls `GET /api/messaging/signal/registration-status` — transitions to `{ status: 'complete' }`.

### Voice Verification Fallback (VoIP/Landline Numbers)

VoIP numbers (including many Twilio numbers in certain markets) cannot receive SMS from Signal. In this case Signal places a robocall and reads the 6-digit code aloud.

1. Admin checks "Use voice verification" before clicking "Register Signal".
2. Frontend calls `POST /api/messaging/signal/register` with `{ bridgeUrl, registeredNumber, useVoice: true }`.
3. Worker calls `POST /v1/register/{number}` with body `{ "use_voice": true }` on the bridge.
4. Worker writes `signalRegistrationPending` with `method: 'voice'` (10-minute TTL).
5. Worker returns `{ ok: true, method: 'voice' }` — UI shows a manual code entry field and countdown timer.
6. Admin hears the 6-digit code via the robocall and types it into the UI.
7. Frontend calls `POST /api/messaging/signal/verify` with `{ code: "123456" }`.
8. Worker reads pending registration from SettingsDO, calls `POST /v1/register/{number}/verify/{code}` on bridge.
9. On success: Worker persists `SignalConfig`, clears pending flag.
10. UI polls registration-status — transitions to `{ status: 'complete' }`.

### New API Endpoints

**`POST /api/messaging/signal/register`**
- Auth: admin only
- Body: `{ bridgeUrl: string, registeredNumber: string, useVoice?: boolean }`
- Calls signal-cli `POST /v1/register/{number}` (with `{ use_voice: true }` if `useVoice` is set)
- Writes `signalRegistrationPending: { number, bridgeUrl, expiresAt, method }` to SettingsDO
- Returns `{ ok: true, method: 'sms' | 'voice' }`
- Returns 409 if registration is already pending or Signal is already configured

**`GET /api/messaging/signal/registration-status`**
- Auth: admin only
- Returns `{ status: 'idle' | 'pending' | 'complete' | 'failed', method?: 'sms' | 'voice', expiresAt?: string, error?: string }`
- Polled by UI every 3 seconds while status is `'pending'`

**`POST /api/messaging/signal/verify`**
- Auth: admin only
- Body: `{ code: string }` (voice path only — SMS path completes automatically)
- Reads pending registration from SettingsDO (returns 404 if none or expired)
- Calls signal-cli `POST /v1/register/{number}/verify/{code}`
- On success: persists `SignalConfig`, clears pending flag, returns `{ ok: true }`
- On failure: sets `signalRegistrationPending.status = 'failed'`, returns 400 with error detail

### SettingsDO Changes

Add `signalRegistrationPending` state alongside existing `SignalConfig`:

```typescript
interface SignalRegistrationPending {
  number: string
  bridgeUrl: string
  method: 'sms' | 'voice'
  expiresAt: string   // ISO 8601 — 10 minutes from initiation
  status: 'pending' | 'complete' | 'failed'
  error?: string
}
```

SettingsDO must expose:
- `getSignalRegistrationPending(): Promise<SignalRegistrationPending | null>` — returns null if not set or expired
- `setSignalRegistrationPending(pending: SignalRegistrationPending): Promise<void>`
- `clearSignalRegistrationPending(): Promise<void>`

TTL enforcement: `getSignalRegistrationPending` checks `expiresAt` against `Date.now()` and returns null (clearing the entry) if expired — prevents stale pending state from blocking future attempts.

### SMS Webhook Modification

`src/worker/messaging/router.ts` must check for pending Signal registration **before** routing to the normal conversation handler:

```typescript
// Signal verification SMS interception — runs before normal SMS routing
const pending = await settings.getSignalRegistrationPending()
if (pending && pending.method === 'sms' && isSignalVerificationSMS(body)) {
  const code = extractSignalCode(body)
  await completeSignalRegistration(pending, code, settings)
  return twiml('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
}
// ... normal conversation routing continues below
```

Helper functions (in `src/worker/messaging/signal/registration.ts`):

- `isSignalVerificationSMS(body: string): boolean` — regex: `/^Your Signal code: \d{6}/`
- `extractSignalCode(body: string): string` — captures the 6-digit group: `/Your Signal code: (\d{6})/`
- `completeSignalRegistration(pending, code, settings)` — calls bridge verify endpoint, persists config or stores failure

### Security Considerations

- **TTL on pending state** (10 minutes) prevents a delayed or replayed verification SMS from completing registration at an unexpected time. `getSignalRegistrationPending` enforces expiry server-side.
- **Constant-time code comparison** is not strictly required here (the code is compared by the signal-cli bridge, not by our code), but the SMS interception check uses `isSignalVerificationSMS` to gate on format before any code extraction — ensuring arbitrary SMS traffic does not trigger bridge API calls.
- **Admin-only endpoints** — all three registration endpoints require admin authentication. A leaked registration initiation cannot be completed without also controlling the SMS webhook path.
- **One pending registration at a time** — `POST /api/messaging/signal/register` returns 409 if `signalRegistrationPending` is already set and not expired. Prevents concurrent registration attempts from different admin sessions.
- **Bridge URL validation** — the `bridgeUrl` submitted in the registration request is validated against the configured allowed bridge host(s) before any HTTP call is made, preventing SSRF via a crafted bridge URL.

## SignalAdapter Implementation

```typescript
class SignalAdapter implements MessagingAdapter {
  readonly channelType = 'signal'

  constructor(private config: SignalConfig) {}

  async parseIncomingMessage(request: Request): Promise<IncomingMessage> {
    const payload = await request.json()
    // signal-cli-rest-api webhook format:
    // { envelope: { source, sourceUuid, timestamp, dataMessage: { message, attachments } } }
    return {
      channelType: 'signal',
      externalId: payload.envelope.timestamp.toString(),
      senderIdentifier: payload.envelope.sourceUuid || payload.envelope.source,
      senderIdentifierHash: await hashIdentifier(payload.envelope.source),
      body: payload.envelope.dataMessage?.message,
      mediaUrls: payload.envelope.dataMessage?.attachments?.map(a => a.id),
      mediaTypes: payload.envelope.dataMessage?.attachments?.map(a => a.contentType),
      timestamp: new Date(payload.envelope.timestamp).toISOString(),
    }
  }

  async validateWebhook(request: Request): Promise<boolean> {
    // Verify shared secret in Authorization header
    const auth = request.headers.get('Authorization')
    return auth === `Bearer ${this.config.webhookSecret}`
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    // POST to signal-cli-rest-api
    const response = await fetch(`${this.config.bridgeUrl}/v2/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.bridgeApiKey}`,
      },
      body: JSON.stringify({
        number: this.config.registeredNumber,
        recipients: [params.recipientIdentifier],
        message: params.body,
      }),
    })
    return { success: response.ok, externalId: (await response.json()).timestamp }
  }

  async sendMediaMessage(params: SendMediaParams): Promise<SendResult> {
    // Download decrypted media to bridge, then send as attachment
    // signal-cli-rest-api supports base64-encoded attachments
  }

  async getChannelStatus(): Promise<ChannelStatus> {
    // Health check: ping bridge, check registration status
    try {
      const res = await fetch(`${this.config.bridgeUrl}/v1/about`, {
        headers: { 'Authorization': `Bearer ${this.config.bridgeApiKey}` },
      })
      return { connected: res.ok, details: await res.json() }
    } catch {
      return { connected: false, error: 'Bridge unreachable' }
    }
  }
}

interface SignalConfig {
  bridgeUrl: string          // e.g., "https://signal-bridge.internal:8080"
  bridgeApiKey: string       // shared secret for bridge API auth (encrypted in SettingsDO)
  webhookSecret: string      // shared secret for webhook auth (encrypted in SettingsDO)
  registeredNumber: string   // the Signal-registered phone number
}
```

## Voice Messages as Voicemail

Signal doesn't support programmatic voice calls, but voice messages work:

1. User records a voice message in Signal and sends it to the hotline number
2. Bridge receives the audio attachment and forwards to Worker webhook
3. Worker downloads the audio from the bridge
4. Worker transcribes using Cloudflare Workers AI (Whisper) — same as voicemail transcription
5. Transcript is ECIES dual-encrypted and stored as an `EncryptedMessage` with `hasAttachments: true`
6. Audio file is ECIES-encrypted and stored in R2
7. Volunteer sees the transcribed text + can play the encrypted audio

This provides a "voicemail via Signal" experience without needing Signal voice call support.

## Bridge Health Monitoring

The Signal bridge is a critical external dependency. Implement monitoring:

- **Periodic health check:** Worker pings bridge every 5 minutes via a Cron Trigger
- **Status in admin dashboard:** green/yellow/red indicator for bridge connectivity
- **Alert on failure:** if bridge is unreachable for >15 minutes, log audit event + show admin notification
- **Version check:** compare signal-cli version against latest release, warn if >30 days old (approaching 3-month expiry window)

## Graceful Degradation

When the Signal bridge is unavailable:
- New Signal messages are lost (Signal doesn't have a reliable retry mechanism for bridges)
- Admin dashboard shows "Signal channel offline" prominently
- Existing conversations show "Signal bridge temporarily unavailable" to volunteers
- Auto-response is not possible (bridge is the only way to send)

## Setup Guide

Create an admin-facing setup guide (in the docs section) covering:
1. Provisioning a server for the bridge
2. Docker deployment and configuration
3. Signal number registration (automated flow for Twilio numbers; manual fallback)
4. Webhook configuration
5. Connecting to the Llamenos admin settings
6. Ongoing maintenance (updating signal-cli, monitoring)
7. Troubleshooting common issues (rate limiting, registration lock, protocol updates)

## Files

- **Create:** `src/worker/messaging/signal/adapter.ts` — SignalAdapter
- **Create:** `src/worker/messaging/signal/types.ts` — signal-cli webhook payload types
- **Create:** `src/worker/messaging/signal/health.ts` — bridge health check logic
- **Create:** `src/worker/messaging/signal/registration.ts` — `isSignalVerificationSMS`, `extractSignalCode`, `completeSignalRegistration` helpers
- **Create:** `src/worker/api/messaging/signal-registration.ts` — registration API route handlers (`/register`, `/registration-status`, `/verify`)
- **Modify:** `src/worker/durable-objects/settings-do.ts` — `SignalConfig` + `SignalRegistrationPending` state + TTL-aware getter
- **Modify:** `src/shared/types.ts` — add `SignalRegistrationPending` type
- **Modify:** `src/worker/messaging/router.ts` — intercept Signal verification SMS before conversation routing
- **Modify:** `src/worker/app.ts` — mount new signal registration routes
- **Modify:** `src/client/components/settings/` — Signal channel configuration UI (registration wizard + status polling)
- **Create:** `src/client/components/SignalBridgeStatus.tsx` — health indicator
- **Create:** `site/src/content/docs/en/setup-signal.md` — Signal bridge setup guide (+ translations)
- **Create:** `tests/signal-auto-registration.spec.ts` — E2E tests for automated registration flow

## Dependencies

- Epic 42 (Messaging Architecture)
- Epic 43 (Setup Wizard — channel configuration flows)
- Epic 47 (Encrypted File Uploads — for voice message audio storage)

## Testing

- E2E: Simulated webhook delivery → encrypted storage → volunteer sees message → replies → outbound via bridge
- E2E: Voice message attachment → transcription → encrypted storage
- E2E: Bridge health check → status displayed in admin dashboard
- E2E: Bridge unreachable → graceful degradation in UI
- E2E: Webhook without valid auth header → rejected
- E2E: Admin initiates SMS registration → simulated verification SMS hits SMS webhook → registration completes automatically → status endpoint returns `complete`
- E2E: Admin initiates voice registration → manual code entry UI appears → admin submits code → registration completes → status endpoint returns `complete`
- E2E: Registration pending TTL expires → subsequent registration attempt succeeds (no 409 conflict)
- E2E: Non-Signal SMS during pending window → routed normally to conversation handler (not intercepted)
- E2E: Duplicate registration attempt while pending → returns 409
