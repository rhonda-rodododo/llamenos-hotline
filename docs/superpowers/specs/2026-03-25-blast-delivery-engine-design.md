# Blast Delivery Engine — Design Spec

**Date:** 2026-03-25
**Status:** Draft
**Epic:** 62 (Message Blasts)

## Problem

The blast sending system has complete CRUD infrastructure (database schema, service layer, API endpoints, messaging adapters) but no delivery engine. The `/send` endpoint flips status to `'sending'` and returns — no messages are actually sent. No background processor, rate limiting, batching, delivery tracking, or scheduled send support exists.

## Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scale target | Medium (1k–50k subscribers) | Crisis hotline community alerting, not marketing platform |
| Architecture | In-process job loop | No new dependencies; 30s `setInterval` poll (simpler variant of the retention-purge daily timer pattern) |
| Subscriber privacy | Encrypted identifier column | Hub-key symmetric encryption (XChaCha20-Poly1305); consistent with E2EE posture |
| Delivery tracking | Fire-and-forget (send status only) | Track adapter success/failure; skip webhook-based DLR for now |
| Scheduled sends | Polling-based (30s interval) | Restart-safe, simple, worst-case 30s late |

## Prerequisites

Before implementing the blast processor, two existing interface changes are needed:

1. **Make `SendMessageParams.conversationId` optional.** The `MessagingAdapter.sendMessage()` interface requires `conversationId: string`, but blast messages are not conversations. Change the type to `conversationId?: string` in `src/server/messaging/adapter.ts` and update adapter implementations to handle `undefined` (use blast delivery ID as fallback tracking reference).

2. **Export `eciesUnwrapKeyServer` from `src/server/lib/crypto.ts`.** The function exists but is not exported. The blast processor needs it to unwrap the hub key from its ECIES envelope. Alternatively, create a dedicated `unwrapHubKeyForServer(hubId, serverSecret, settings)` helper that encapsulates the full unwrap flow (fetch envelope → derive server keypair via HKDF with `LABEL_SERVER_NOSTR_KEY` → ECIES unwrap with `LABEL_HUB_KEY_WRAP`).

## Architecture

### BlastProcessor

A single class in `src/server/jobs/blast-processor.ts`. Registered at server startup alongside `scheduleRetentionPurge`. Uses `setInterval(30_000)` to poll for work (unlike retention-purge's daily `setTimeout` → `setInterval` chain, the blast processor needs frequent polling).

**Poll cycle:**

1. Query blasts with `status = 'scheduled' AND scheduledAt <= now()` → set status to `'sending'`, set `sentAt = now()`
2. Query blasts with `status = 'sending'` → process one at a time
3. For the active blast: fetch matching subscribers, send in batches, track deliveries
4. On completion: update status to `'sent'` with final stats, log `blastSent` audit entry
5. On unrecoverable error: update status to `'failed'` with error detail, log `blastFailed` audit entry

**Resumability:** On server restart, the processor finds any blast with `status = 'sending'` and resumes. It queries `blastDeliveries` for that blast to get already-processed subscriber IDs, then skips them when iterating. No additional tracking column is needed — the delivery records themselves are the progress marker.

**Graceful shutdown:** `server.ts` clears the processor's interval on shutdown (same pattern as `providerHealth.stop()`). Any in-flight batch completes before exit; the blast remains in `'sending'` status and resumes on next startup.

### Data Flow

```
Admin hits /send
  → blast.status = 'sending', blast.sentAt = now()
  → HTTP 200 returned immediately

BlastProcessor poll (every 30s)
  → finds blast with status = 'sending'
  → unwraps hub key (server keypair + ECIES envelope)
  → queries subscribers matching filters (channels, tags, languages)
  → queries existing deliveries for this blast (for resume)
  → for each batch of 50 subscribers (configurable per hub):
      → check blast status (stop if cancelled)
      → decrypt subscriber identifier (XChaCha20-Poly1305 with hub key)
      → select first verified channel matching blast target channels
      → get messaging adapter for channel type
      → call adapter.sendMessage({ recipientIdentifier, body, conversationId: deliveryId })
      → create blastDelivery record (sent/failed)
      → apply per-provider rate delay
      → update blast.stats with running totals
  → set blast.status = 'sent', log blastSent audit entry
```

### Subscriber Identifier Encryption

**Problem:** The `subscribers` table stores `identifierHash` (one-way HMAC-SHA256). The blast processor needs plaintext identifiers to send messages.

**Solution:** Add `encryptedIdentifier` column — XChaCha20-Poly1305 symmetric encryption with the hub key, hex-encoded. Uses the existing `encryptForHub`/`decryptFromHub` functions which handle nonce generation and packing (`hex(nonce(24) || ciphertext)`). No additional domain separation label is needed — the hub key is already domain-separated at the ECIES wrapping layer via `LABEL_HUB_KEY_WRAP`.

**Migration:** Add `encrypted_identifier text` column to `subscribers` table. Nullable for backward compatibility — existing subscribers imported without encryption will need re-import.

**Encryption flow:**
- On subscriber creation (import, keyword opt-in): encrypt identifier with hub key, store in `encryptedIdentifier`
- On blast send: decrypt with hub key at runtime, pass to messaging adapter
- Hub key rotation: re-encrypt all subscriber identifiers (same as note re-encryption pattern)

**Server-side hub key access:** The blast processor derives the server's Nostr keypair from `SERVER_NOSTR_SECRET` via HKDF (using `LABEL_SERVER_NOSTR_KEY`). It then fetches the hub's key envelopes via `settings.getHubKeyEnvelopes(hubId)`, finds the envelope addressed to the server's pubkey, and unwraps it using `eciesUnwrapKeyServer(envelope, serverPrivateKey, LABEL_HUB_KEY_WRAP)`. The server must be included as a hub key recipient during hub setup — production provisioning must ensure this.

### Rate Limiting

Per-provider delays between sends, configurable per hub:

| Provider | Default delay | Effective rate | Rationale |
|----------|--------------|----------------|-----------|
| SMS (Twilio/SignalWire/Vonage/Plivo) | 1000ms | ~1 msg/sec | Twilio standard rate limit |
| WhatsApp | 50ms | ~20 msg/sec | Conservative below 80/sec API limit |
| Signal | 500ms | ~2 msg/sec | signal-cli bridge limited |
| RCS | 200ms | ~5 msg/sec | Varies by carrier |

At these rates, a 10k subscriber SMS blast takes ~2.8 hours. A 10k WhatsApp blast takes ~8 minutes.

Implementation: simple `await sleep(delay)` between sends within a batch. No token bucket or sliding window — the sequential in-process model naturally enforces rate limits.

Defaults stored in `blastRateLimits` in hub settings (new JSONB field on settings). Admins can tune per-hub. Batch size (default 50) is also configurable alongside rate limits.

### Subscriber Filtering

When processing a blast, the processor filters subscribers by:

1. **Hub scope:** `subscriber.hubId = blast.hubId`
2. **Active status:** `subscriber.status = 'active'`
3. **Channel match:** subscriber has at least one **verified** channel in `blast.targetChannels` (if specified)
4. **Tag match:** subscriber has at least one tag in `blast.targetTags` (if specified)
5. **Language match:** subscriber's language is in `blast.targetLanguages` (if specified)
6. **Has encrypted identifier:** `subscriber.encryptedIdentifier IS NOT NULL`

If `targetChannels`, `targetTags`, or `targetLanguages` are empty arrays, that filter is skipped (matches all).

For each matching subscriber, the processor sends to the **first verified channel** that matches the blast's target channels. Unverified channels (`verified: false`) are skipped. If a subscriber has multiple matching verified channels, only one message is sent (no duplicates).

### Message Content

The blast `content` field is a string. The processor appends a localized opt-out footer based on the subscriber's `language` field:

```
{blast.content}

{localizedFooter(subscriber.language)}
```

The footer translations are stored in the existing locale JSON files (`src/client/locales/*.json`) under a `blast.optOutFooter` key. Fallback to English if the subscriber's language is not available. Example: `"Reply STOP to unsubscribe"` (en), `"Responda STOP para cancelar la suscripción"` (es).

For WhatsApp: content must comply with template message requirements. Template pre-approval is out of scope — that's a future concern when WhatsApp blasts are actually configured.

### Status Transitions & Stats

```
draft → sending       (on /send endpoint)
draft → scheduled     (on /schedule endpoint)
scheduled → sending   (when scheduledAt <= now(), by processor)
scheduled → cancelled (on /cancel endpoint)
sending → cancelled   (on /cancel endpoint, partial stats preserved)
sending → sent        (all deliveries processed)
sending → failed      (unrecoverable error, e.g., hub key unavailable)
```

Stats updated after each batch:

```typescript
interface BlastStats {
  totalRecipients: number  // total matching subscribers
  sent: number             // adapter returned success
  delivered: number        // 0 (no DLR tracking yet)
  failed: number           // adapter returned failure
  optedOut: number         // 0 (tracked separately via STOP keywords)
}
```

### Audit Logging

All blast lifecycle events are audit-logged (consistent with codebase security requirements):

| Event | Audit action | Details |
|-------|-------------|---------|
| Blast sent | `blastSent` | blastId, totalRecipients, sent, failed |
| Blast cancelled | `blastCancelled` | blastId, sentSoFar, cancelledBy |
| Blast failed | `blastFailed` | blastId, error, sentSoFar |
| Blast scheduled | `blastScheduled` | blastId, scheduledAt |

### Error Handling

| Error | Behavior |
|-------|----------|
| Adapter `sendMessage()` fails | Record delivery as `'failed'` with error, continue to next subscriber |
| Hub key unavailable | Set blast to `'failed'`, log `blastFailed` audit, stop processing |
| Subscriber has no encrypted identifier | Skip subscriber, don't create delivery record |
| Server crash mid-blast | On restart, resume from where it left off (skip existing deliveries) |
| All subscribers fail | Blast completes as `'sent'` with `failed = totalRecipients` (not `'failed'` — that's for infrastructure errors) |

### Cancellation

Admin can cancel a sending or scheduled blast via `POST /api/blasts/:id/cancel`. Sets status to `'cancelled'`. The processor checks blast status before each batch — if cancelled, it stops, updates stats with what was sent so far, and logs a `blastCancelled` audit entry.

## Schema Changes

### Migration: Add encrypted_identifier to subscribers

```sql
ALTER TABLE subscribers ADD COLUMN encrypted_identifier text;
```

### Migration: Add scheduledAt and error to blasts

```sql
ALTER TABLE blasts ADD COLUMN scheduled_at timestamptz;
ALTER TABLE blasts ADD COLUMN error text;
```

Note: the existing `/schedule` endpoint currently stores the scheduled time in `sentAt`. This migration adds a dedicated `scheduledAt` column to avoid overloading `sentAt` (which means "when the blast was actually sent"). The `/schedule` route handler must be updated to use `scheduledAt` instead.

### Migration: Add unique constraint to blastDeliveries

```sql
ALTER TABLE blast_deliveries ADD CONSTRAINT blast_deliveries_blast_subscriber_unique
  UNIQUE (blast_id, subscriber_id);
```

This enforces the invariant that each subscriber gets at most one delivery per blast, which the resumability logic depends on.

## New Files

| File | Purpose |
|------|---------|
| `src/server/jobs/blast-processor.ts` | BlastProcessor class + `scheduleBlastProcessor()` |
| `drizzle/migrations/0017_blast_delivery_engine.sql` | Schema migration |

## Modified Files

| File | Change |
|------|--------|
| `src/server/server.ts` | Register `scheduleBlastProcessor()` at startup, clear interval on shutdown |
| `src/server/db/schema/blasts.ts` | Add `encryptedIdentifier` to subscribers, `scheduledAt` + `error` to blasts, unique constraint on deliveries |
| `src/server/services/blasts.ts` | Add `listSubscribersForBlast()` filtered query, `getDeliveredSubscriberIds()` for resume |
| `src/server/routes/blasts.ts` | Add `/cancel` endpoint, update `/schedule` to use `scheduledAt`, validate hub key on `/send` |
| `src/server/messaging/adapter.ts` | Make `conversationId` optional in `SendMessageParams` |
| `src/server/lib/crypto.ts` | Export `eciesUnwrapKeyServer` or add `unwrapHubKeyForServer()` helper |

## Testing

### Unit Tests (bun:test)

- `blast-processor.test.ts`: Test processor logic with mocked services
  - Processes a blast with 3 subscribers, creates 3 deliveries
  - Skips subscribers without encrypted identifier
  - Skips subscribers with only unverified channels
  - Resumes after simulated crash (pre-existing deliveries skipped)
  - Respects cancellation between batches
  - Handles adapter failures gracefully (continues to next subscriber)
  - Updates stats correctly after completion
  - Scheduled blast transitions to sending when due

### API Integration Tests (Playwright)

- Fix existing `blast-sending.spec.ts:46` flaky test (poll for status transition instead of immediate check)
- New test: send blast to imported subscribers, verify delivery records created
- New test: cancel a sending blast, verify partial stats
- New test: scheduled blast fires after scheduledAt passes

## Out of Scope

- Webhook-based delivery receipts (DLR) — add later when needed
- WhatsApp template pre-approval workflow
- Multi-channel per-subscriber (send to all channels) — currently first-match only
- Blast content preview/rendering per channel
- Real-time progress via Nostr relay (can be added by publishing events in the batch loop)
- Distributed workers / external queue
