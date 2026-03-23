# Message Delivery Status & Read Receipts — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

When a volunteer sends an SMS, WhatsApp, or Signal message to a caller, there is no feedback about whether the message was delivered. The conversation thread shows the message as sent, but volunteers cannot distinguish between: sent-to-provider, delivered-to-handset, read, or failed. Failed deliveries are invisible — volunteers may not realise their message never arrived.

## Goals

1. Track delivery status for outbound messages: `pending → sent → delivered → read → failed`.
2. Surface the status in the conversation thread with a small icon per message (not intrusive).
3. Update status in real-time via provider webhooks (Twilio status callback, Meta webhooks).
4. Store failed delivery errors so volunteers can see why a message failed.
5. Do not expose delivery metadata beyond what the provider already knows — no new privacy surface.

## Non-Goals

- Read receipts for inbound messages (we don't know when volunteers read conversations; no scope for that here).
- Delivery receipts for Signal (Signal for Business doesn't support read receipts — `sent` is the final positive state).
- Push delivery into existing Nostr events (status updates go through REST for simplicity; they're not time-sensitive enough to require relay).
- Retry logic for failed messages (operators should handle that manually; automatic retry risks spam).

## Status Lifecycle

```
pending   → message queued/accepted but not yet confirmed sent by provider
sent      → provider confirmed transmission to the network
delivered → handset confirmed receipt (SMS delivery report, WhatsApp delivered tick)
read      → recipient opened the message (WhatsApp blue tick, RCS read receipt)
failed    → provider reported delivery failure (invalid number, carrier rejection, etc.)
```

Not all providers support all statuses:
- **SMS (Twilio):** pending → sent → delivered | failed (no read receipts)
- **WhatsApp:** pending → sent → delivered → read | failed
- **Signal:** pending → sent | failed (no delivery/read receipts)

## Data Model Changes

```typescript
// New columns on messages table:
deliveryStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'  // default: 'pending'
deliveryStatusUpdatedAt: Date | null
providerMessageId: string | null   // Twilio MessageSid, Meta message_id, etc.
deliveryError: string | null       // human-readable error from provider on failure
```

No new table required — these are columns on the existing `messages` table.

## Provider Integration

### Twilio (SMS)
- `sendMessage()` returns `MessageSid` → store as `providerMessageId`, initial status `sent`
- `statusCallback` URL set to `POST /api/messaging/status-callback` on every send
- Twilio POSTs: `{MessageSid, MessageStatus: queued|sent|delivered|undelivered|failed}`
- Mapping: `queued/accepted → pending`, `sending/sent → sent`, `delivered → delivered`, `undelivered/failed → failed`

### WhatsApp (Meta/Twilio)
- Same Twilio flow for Twilio-managed WhatsApp; Meta webhook for direct Meta integration
- Meta `statuses[].status`: `sent → sent`, `delivered → delivered`, `read → read`, `failed → failed`

### Signal
- No webhook callbacks; status is `sent` once API returns 200, `failed` on error

## Architecture Decision: Webhook vs Polling

**Option A: Provider webhooks** (chosen)
- Low latency updates, no unnecessary polling
- Requires public webhook URL (`APP_URL` env var must be set)
- Twilio status callbacks are fired per-message — manageable volume

**Option B: Polling provider API**
- Simpler setup, no webhook URL needed
- High latency, unnecessary API calls, rate limit risk

Decision: webhooks. `APP_URL` is already needed for invite links anyway.

## Real-Time Update to UI

When a status callback arrives:
1. Update `messages` row in DB
2. Emit Nostr event `{"type": "message:status-updated", "messageId": "...", "status": "..."}` encrypted with hub key
3. Conversation thread subscribes and updates icon live

Fallback: If Nostr relay is unavailable, the correct status is returned on next `GET /api/conversations/:id/messages` poll.

## UI Design

- Status icons on outbound messages only (right-aligned, below message bubble):
  - `pending`: clock icon, gray
  - `sent`: single check, gray
  - `delivered`: double check, gray
  - `read`: double check, blue (WhatsApp convention)
  - `failed`: warning icon, red; hover/tap shows `deliveryError` text
- No status icons on inbound messages
- Provider-specific caveats: for Signal, tooltip on `sent` icon: "Signal does not confirm delivery"

## Privacy Considerations

- `deliveryError` may contain phone number fragments from provider error messages — strip or mask before storing
- Status updates are part of the message record (E2EE conversation) — status metadata is NOT encrypted (same as existing `direction`, `timestamp` columns; these are operational metadata, not content)
- The `providerMessageId` (Twilio SID etc.) is stored plaintext — acceptable, it's a reference ID with no PII

## Testing

- Send message → initial status `pending` or `sent`
- Mock Twilio status callback POST → verify DB updated to `delivered`
- Mock failure callback → status `failed`, `deliveryError` populated
- UI shows correct icon per status (snapshot or E2E)
- Signal message: status stays `sent` after provider confirms (no further updates)
