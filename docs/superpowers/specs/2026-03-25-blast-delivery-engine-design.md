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
| Architecture | In-process job loop | Follows existing retention-purge pattern, no new dependencies |
| Subscriber privacy | Encrypted identifier column | Hub-key encrypted; consistent with E2EE posture |
| Delivery tracking | Fire-and-forget (send status only) | Track adapter success/failure; skip webhook-based DLR for now |
| Scheduled sends | Polling-based (30s interval) | Restart-safe, simple, worst-case 30s late |

## Architecture

### BlastProcessor

A single class in `src/server/jobs/blast-processor.ts`. Registered at server startup alongside `scheduleRetentionPurge`. Polls every 30 seconds for work.

**Poll cycle:**

1. Query blasts with `status = 'scheduled' AND scheduledAt <= now()` → set status to `'sending'`
2. Query blasts with `status = 'sending'` → process one at a time
3. For the active blast: fetch matching subscribers, send in batches, track deliveries
4. On completion: update status to `'sent'` with final stats
5. On unrecoverable error: update status to `'failed'` with error detail

**Resumability:** On server restart, the processor finds any blast with `status = 'sending'` and resumes. It skips subscribers who already have a `blastDeliveries` record for that blast, so work is never duplicated.

### Data Flow

```
Admin hits /send
  → blast.status = 'sending', blast.sentAt = now()
  → HTTP 200 returned immediately

BlastProcessor poll (every 30s)
  → finds blast with status = 'sending'
  → queries subscribers matching filters (channels, tags, languages)
  → for each batch of 50 subscribers:
      → decrypt subscriber identifier (hub key + encryptedIdentifier)
      → get messaging adapter for channel type
      → call adapter.sendMessage()
      → create blastDelivery record (sent/failed)
      → apply per-provider rate delay
  → update blast.stats with running totals
  → set blast.status = 'sent'
```

### Subscriber Identifier Encryption

**Problem:** The `subscribers` table stores `identifierHash` (one-way HMAC-SHA256). The blast processor needs plaintext identifiers to send messages.

**Solution:** Add `encryptedIdentifier` column — XChaCha20-Poly1305 encrypted with the hub key, hex-encoded. This is the same `encryptForHub`/`decryptFromHub` pattern used elsewhere in the codebase.

**Migration:** Add `encrypted_identifier text` column to `subscribers` table. Nullable for backward compatibility — existing subscribers imported without encryption will need re-import.

**Encryption flow:**
- On subscriber creation (import, keyword opt-in): encrypt identifier with hub key, store in `encryptedIdentifier`
- On blast send: decrypt with hub key at runtime, pass to messaging adapter
- Hub key rotation: re-encrypt all subscriber identifiers (same as note re-encryption pattern)

**Server-side hub key access:** The blast processor needs the hub key to decrypt identifiers. The server already has `SERVER_NOSTR_SECRET` which derives a server keypair. Hub key envelopes are ECIES-wrapped for each member. For blast processing, the server's own keypair should have a hub key envelope — this is already the case in `test-reset` (dev.ts line 87). Production setup must include the server as a hub key recipient.

### Rate Limiting

Per-provider delays between sends, configurable in hub settings:

| Provider | Default delay | Effective rate |
|----------|--------------|----------------|
| SMS (Twilio/SignalWire/Vonage/Plivo) | 1000ms | ~1 msg/sec |
| WhatsApp | 50ms | ~20 msg/sec (conservative) |
| Signal | 500ms | ~2 msg/sec (bridge limited) |
| RCS | 200ms | ~5 msg/sec |

Implementation: simple `await sleep(delay)` between sends within a batch. No token bucket or sliding window — the sequential in-process model naturally enforces rate limits.

These defaults are stored in `blastRateLimits` in hub settings (new field on `settingsService`). Admins can tune per-hub.

### Subscriber Filtering

When processing a blast, the processor filters subscribers by:

1. **Hub scope:** `subscriber.hubId = blast.hubId`
2. **Active status:** `subscriber.status = 'active'`
3. **Channel match:** subscriber has at least one channel in `blast.targetChannels` (if specified)
4. **Tag match:** subscriber has at least one tag in `blast.targetTags` (if specified)
5. **Language match:** subscriber's language is in `blast.targetLanguages` (if specified)
6. **Has encrypted identifier:** `subscriber.encryptedIdentifier IS NOT NULL`

If `targetChannels`, `targetTags`, or `targetLanguages` are empty arrays, that filter is skipped (matches all).

For each matching subscriber, the processor sends to the **first available channel** that matches the blast's target channels. If a subscriber has multiple matching channels, only one message is sent (no duplicates).

### Message Content

The blast `content` field is a string. The processor appends an opt-out footer:

```
{blast.content}

Reply STOP to unsubscribe
```

For WhatsApp: content must comply with template message requirements. The spec does not address template pre-approval — that's a future concern when WhatsApp blasts are actually configured.

### Status Transitions & Stats

```
draft → sending       (on /send endpoint)
draft → scheduled     (on /schedule endpoint)
scheduled → sending   (when scheduledAt <= now(), by processor)
scheduled → cancelled (on /cancel endpoint)
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

### Error Handling

| Error | Behavior |
|-------|----------|
| Adapter `sendMessage()` fails | Record delivery as `'failed'` with error, continue to next subscriber |
| Hub key unavailable | Set blast to `'failed'`, log error, stop processing |
| Subscriber has no encrypted identifier | Skip subscriber, don't create delivery record |
| Server crash mid-blast | On restart, resume from where it left off (skip existing deliveries) |
| All subscribers fail | Blast completes as `'sent'` with `failed = totalRecipients` (not `'failed'` — that's for infrastructure errors) |

### Cancellation

Admin can cancel a sending blast via `POST /api/blasts/:id/cancel`. Sets status to `'cancelled'`. The processor checks blast status before each batch — if cancelled, it stops and updates stats with what was sent so far.

## Schema Changes

### Migration: Add encrypted_identifier to subscribers

```sql
ALTER TABLE subscribers ADD COLUMN encrypted_identifier text;
```

### Migration: Add blast processing columns

```sql
-- Track which subscriber the processor is working on for resumability
ALTER TABLE blasts ADD COLUMN last_processed_subscriber_id text;
-- Track processing errors
ALTER TABLE blasts ADD COLUMN error text;
```

## New Files

| File | Purpose |
|------|---------|
| `src/server/jobs/blast-processor.ts` | BlastProcessor class + `scheduleBlastProcessor()` |
| `drizzle/migrations/0017_blast_delivery_engine.sql` | Schema migration |

## Modified Files

| File | Change |
|------|--------|
| `src/server/server.ts` | Register `scheduleBlastProcessor()` at startup |
| `src/server/db/schema/blasts.ts` | Add `encryptedIdentifier` to subscribers, `lastProcessedSubscriberId` + `error` to blasts |
| `src/server/services/blasts.ts` | Add `listSubscribersForBlast()` filtered query, `getDeliveredSubscriberIds()` for resume |
| `src/server/routes/blasts.ts` | Add `/cancel` endpoint, fix `/send` to validate hub key availability |
| `src/server/lib/crypto.ts` | Export `encryptForHub`/`decryptFromHub` if not already server-accessible |
| `src/shared/crypto-labels.ts` | Add `LABEL_SUBSCRIBER_IDENTIFIER` domain separation constant |

## Testing

### Unit Tests (bun:test)

- `blast-processor.test.ts`: Test processor logic with mocked services
  - Processes a blast with 3 subscribers, creates 3 deliveries
  - Skips subscribers without encrypted identifier
  - Resumes after simulated crash (pre-existing deliveries skipped)
  - Respects cancellation between batches
  - Handles adapter failures gracefully (continues to next subscriber)
  - Updates stats correctly after completion

### API Integration Tests (Playwright)

- Fix existing `blast-sending.spec.ts:46` flaky test (status checked before DB write completes — add polling/retry)
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
