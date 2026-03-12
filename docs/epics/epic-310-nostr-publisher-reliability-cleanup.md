# Epic 310: Nostr Publisher Reliability & Housekeeping

**Status**: COMPLETE
**Priority**: High
**Depends on**: Epic 306 (relay delivery fixes — publisher OK handling)
**Blocks**: None
**Branch**: `desktop`

## Summary

Fix 11 reliability gaps and documentation issues in the Nostr event publishing pipeline discovered during the post-Epic-306 audit. Covers: `publishNostrEvent()` async return type, `flushPendingEvents()` OK acknowledgment bypass, reconnect cap, orphaned kind constants, stale skill documentation, strfry production hardening config, and minor import cleanups. All changes are backend-only or documentation — no client UI changes.

## Problem Statement

The Epic 306 audit revealed that while the relay connection itself now works, the publishing pipeline has reliability gaps that can cause silent event loss:

### P1: `publishNostrEvent()` is void — callers can't know if events published

**File**: `apps/worker/lib/nostr-events.ts:9`

The function signature is `void`. The internal `.catch()` logs errors but swallows them. Callers in `conversations.ts` (3 calls), `reports.ts` (3 calls) have zero error handling — if the relay is down, clients never see real-time updates and nobody knows.

### P2: `flushPendingEvents()` bypasses OK acknowledgment

**File**: `apps/worker/lib/nostr-publisher.ts:327-334`

Events queued during reconnection are flushed with raw `ws.send()` — no `sendAndAwaitOk()`, no timeout, no rejection tracking. These events can be silently rejected by the relay.

### P3: No reconnect attempt cap

**File**: `apps/worker/lib/nostr-publisher.ts:336-348`

`scheduleReconnect()` increments `reconnectAttempts` without limit. The exponential backoff caps at 30s, but the publisher will retry forever even if the relay is permanently gone. In a long-running Node.js process this wastes resources.

### P4: Cached publisher has no lifetime management

**File**: `apps/worker/lib/do-access.ts:175-180`

`getNostrPublisher()` caches a single instance per isolate. If `NOSTR_RELAY_URL` changes at runtime (config rotation), the stale publisher is reused. Similarly, `cachedEventKey` in `nostr-events.ts:6` never invalidates.

### P5: `messaging/router.ts` bypasses encryption — events sent unencrypted

**File**: `apps/worker/messaging/router.ts:110-136, 343-371`

Two calls in the messaging router use `getNostrPublisher().publish()` directly with `JSON.stringify()` content instead of going through `publishNostrEvent()`. This means these events are sent to the relay **without hub event encryption** — a security gap. All other publish paths encrypt content with XChaCha20-Poly1305 via `encryptHubEvent()`.

### P6: Three orphaned kind constants

**File**: `packages/shared/nostr-events.ts:32-43`

`KIND_SHIFT_UPDATE` (1020), `KIND_SETTINGS_CHANGED` (1030), and `KIND_CALL_SIGNAL` (20001) are defined but never imported or published anywhere. They suggest incomplete features and confuse developers.

### P7: Skill documentation severely out of sync

**File**: `.claude/skills/nostr-realtime-events/SKILL.md:147-160`

Lists 6 nonexistent constants (`KIND_CALL_EVENT`, `KIND_NOTE_EVENT`, etc.) with wrong kind numbers (20001-20006). None of these exist in the codebase. The skill should document the actual constants from `packages/shared/nostr-events.ts`.

### P8: Desktop uses hardcoded 22242 for NIP-42 AUTH

**File**: `apps/worker/lib/nostr-publisher.ts:313`

The NIP-42 auth event uses `kind: 22242` as a magic number. `KIND_NIP42_AUTH` is exported from `packages/shared/nostr-events.ts` but not imported here.

### P9: `call-router.ts` duplicates encryption logic

**File**: `apps/worker/durable-objects/call-router.ts:517-557`

`CallRouterDO.publishNostrEvent()` duplicates the encryption + publish pattern from `nostr-events.ts:publishNostrEvent()`, with its own `eventKey` cache and `withRetry` wrapper. This is the only caller that retries — all route-level callers use the fire-and-forget version.

### P10: strfry config missing production hardening

**File**: `deploy/docker/strfry-dev.conf`

- `rejectEventsOlderThanSeconds = 94608000` (3 years) — should be much shorter for a notification relay
- No rate limiting configuration
- No connection limits beyond defaults
- Dev config comment says "For production, use a write-policy plugin" but no production config exists

### P11: strfry-test.conf references nonexistent write-policy.py

**File**: `deploy/docker/strfry-test.conf:50`

`plugin = "/app/write-policy.py"` — this file doesn't exist in the strfry Docker image. This was the original bug from Epic 306 P1 (strfry rejecting all events). The test config still references it.

## Implementation

### Task 1: Make `publishNostrEvent()` return `Promise<void>`

**File**: `apps/worker/lib/nostr-events.ts`

Change from fire-and-forget to async with error propagation:

```typescript
/** Publish an event to the Nostr relay. Returns a promise that rejects on failure. */
export async function publishNostrEvent(
  env: AppEnv['Bindings'],
  kind: number,
  content: Record<string, unknown>,
): Promise<void> {
  const publisher = getNostrPublisher(env)

  let eventContent: string
  if (env.SERVER_NOSTR_SECRET) {
    if (!cachedEventKey) {
      cachedEventKey = deriveServerEventKey(env.SERVER_NOSTR_SECRET)
    }
    eventContent = encryptHubEvent(content, cachedEventKey)
  } else {
    eventContent = JSON.stringify(content)
  }

  await publisher.publish({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'global'], ['t', 'llamenos:event']],
    content: eventContent,
  })
}
```

Remove the outer try-catch and inner `.catch()`. Callers that want fire-and-forget behavior can add their own `.catch()`.

### Task 2: Update all route callers to handle errors

**File**: `apps/worker/routes/conversations.ts` (3 calls)
**File**: `apps/worker/routes/reports.ts` (3 calls)

Add `.catch()` at each call site with structured logging:

```typescript
publishNostrEvent(c.env, KIND_MESSAGE_NEW, {
  type: 'message:new',
  conversationId: id,
}).catch((e) => {
  console.error(`[conversations] Failed to publish message:new event for ${id}:`, e)
})
```

This preserves the existing fire-and-forget behavior but makes it explicit at the call site rather than hidden inside the function.

### Task 3: Migrate `messaging/router.ts` to use `publishNostrEvent()` (SECURITY FIX)

**File**: `apps/worker/messaging/router.ts`

Two calls at lines 110-136 and 343-371 bypass `publishNostrEvent()` entirely. They call `getNostrPublisher().publish()` directly with `JSON.stringify()` content — **no hub event encryption**. These events go to the relay as plaintext JSON while all other events are encrypted.

Replace both with `publishNostrEvent()`:

```typescript
// Line 110-136: Replace manual publish with:
publishNostrEvent(c.env, KIND_MESSAGE_NEW, {
  type: 'message:status',
  conversationId: result.conversationId,
  messageId: result.messageId,
  status: statusUpdate.status,
  timestamp: statusUpdate.timestamp,
}).catch((e) => {
  console.error('[messaging] Failed to publish status update:', e)
})

// Line 343-371: Replace manual publish with:
publishNostrEvent(env, KIND_CONVERSATION_ASSIGNED, {
  type: 'conversation:assigned',
  conversationId,
  assignedTo: bestCandidate,
  autoAssigned: true,
}).catch((e) => {
  console.error('[messaging] Failed to publish auto-assignment:', e)
})
```

This fixes the encryption gap and eliminates duplicated publisher access + retry logic.

### Task 4: Consolidate `CallRouterDO.publishNostrEvent()` to use shared function

**File**: `apps/worker/durable-objects/call-router.ts`

Replace the private `publishNostrEvent()` method with a call to the shared `publishNostrEvent()` from `nostr-events.ts`, wrapped in `withRetry`:

```typescript
private async publishEvent(kind: number, content: Record<string, unknown>): Promise<void> {
  await withRetry(
    () => publishNostrEvent(this.env, kind, content),
    {
      maxAttempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      isRetryable: isRetryableError,
      onRetry: (attempt) => {
        console.warn(`[call-router] Publish retry ${attempt} (kind=${kind})`)
      },
    },
  ).catch((err) => {
    console.error('[call-router] Failed to publish event after retries:', err)
  })
}
```

This eliminates the duplicated encryption logic and event key cache.

### Task 5: Fix `flushPendingEvents()` to use `sendAndAwaitOk()`

**File**: `apps/worker/lib/nostr-publisher.ts`

```typescript
private flushPendingEvents(): void {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

  while (this.pendingEvents.length > 0) {
    const event = this.pendingEvents.shift()!
    // Use sendAndAwaitOk for relay acknowledgment.
    // Errors are logged but not propagated — these events were already
    // accepted by the caller's publish() promise (queued during reconnect).
    this.sendAndAwaitOk(event).catch((err) => {
      console.error(`[nostr-publisher] Flushed event ${event.id} rejected:`, err)
    })
  }
}
```

### Task 6: Cap reconnect attempts

**File**: `apps/worker/lib/nostr-publisher.ts`

Add a max reconnect constant and stop after hitting it:

```typescript
private static readonly MAX_RECONNECT_ATTEMPTS = 10

private scheduleReconnect(): void {
  if (this.closed || this.reconnectTimer) return

  this.reconnectAttempts++
  if (this.reconnectAttempts > NodeNostrPublisher.MAX_RECONNECT_ATTEMPTS) {
    console.error(`[nostr-publisher] Max reconnect attempts (${NodeNostrPublisher.MAX_RECONNECT_ATTEMPTS}) reached, giving up`)
    return
  }

  const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000)
  this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = null
    this.connect().catch((err) => {
      console.error('[nostr-publisher] Reconnect failed:', err)
    })
  }, delay)
}
```

### Task 7: Import `KIND_NIP42_AUTH` instead of magic number

**File**: `apps/worker/lib/nostr-publisher.ts`

```typescript
import { KIND_NIP42_AUTH } from '@shared/nostr-events'

// In handleNIP42Auth():
const authEvent = finalizeEvent({
  kind: KIND_NIP42_AUTH,  // was: 22242
  ...
```

### Task 8: Remove orphaned kind constants

**File**: `packages/shared/nostr-events.ts`

Remove:
- `KIND_SHIFT_UPDATE = 1020` — never published or subscribed
- `KIND_SETTINGS_CHANGED = 1030` — never published or subscribed
- `KIND_CALL_SIGNAL = 20001` — never published (was intended for WebRTC signaling but uses REST instead)

Also remove `KIND_CALL_SIGNAL` from mobile subscription filters since no events of this kind are ever published:

**File**: `apps/ios/Sources/Services/WebSocketService.swift`
**File**: `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt`

Change kind filter from `[1000,1001,1002,1010,1011,20000,20001]` to `[1000,1001,1002,1010,1011,20000]`.

### Task 9: Update skill documentation

**File**: `.claude/skills/nostr-realtime-events/SKILL.md`

Replace the fake event kinds table (lines 147-160) with the actual constants:

```markdown
## Existing Event Kinds

All constants defined in `packages/shared/nostr-events.ts`:

| Constant | Value | Published By | Content Type | Trigger |
|----------|-------|-------------|--------------|---------|
| `KIND_CALL_RING` | 1000 | CallRouterDO | `call:ring` | Incoming call |
| `KIND_CALL_UPDATE` | 1001 | CallRouterDO | `call:update` | Call answered, completed, etc. |
| `KIND_CALL_VOICEMAIL` | 1002 | CallRouterDO | `voicemail:new` | Voicemail received |
| `KIND_MESSAGE_NEW` | 1010 | Routes | `message:new` | Inbound message |
| `KIND_CONVERSATION_ASSIGNED` | 1011 | Routes | `conversation:assigned` / `conversation:closed` | Assignment change |
| `KIND_PRESENCE_UPDATE` | 20000 | CallRouterDO | `presence:summary` | Volunteer availability changed |
| `KIND_NIP42_AUTH` | 22242 | NodeNostrPublisher | NIP-42 auth | Relay authentication |

Kinds 1000-1011 are regular (persisted by relay). Kind 20000 is ephemeral (broadcast only, 5-min TTL).
```

Also update the "Adding a New Event Type" section to reference the correct function name and pattern.

### Task 10: Fix strfry-test.conf write policy

**File**: `deploy/docker/strfry-test.conf`

Change `plugin = "/app/write-policy.py"` to `plugin = ""` (same as dev config). The test relay should accept all events — the server signs events with a known keypair, and tests verify signatures in BDD scenarios.

### Task 11: Add strfry production config

**File**: `deploy/docker/strfry-prod.conf` (new)

Production-hardened relay config with:
- `rejectEventsOlderThanSeconds = 86400` (1 day — events are notifications, not archives)
- `ephemeralEventsLifetimeSeconds = 300` (5 min, same as dev)
- `maxSubsPerConnection = 10` (tighter than dev's 20)
- `maxFilterLimit = 100` (tighter than dev's 500)
- Write policy comment noting that server pubkey whitelist should be configured per deployment

```
# strfry config for production — hardened relay
# Mount via docker-compose.yml or Helm chart.

db = "./strfry-db/"

dbParams {
    maxreaders = 256
    mapsize = 10995116277760
    noReadAhead = false
}

events {
    maxEventSize = 65536
    rejectEventsNewerThanSeconds = 60
    rejectEventsOlderThanSeconds = 86400
    rejectEphemeralEventsOlderThanSeconds = 60
    ephemeralEventsLifetimeSeconds = 300
    maxNumTags = 50
    maxTagValSize = 256
}

relay {
    bind = "0.0.0.0"
    port = 7777

    nofiles = 0
    realIpHeader = "X-Forwarded-For"

    info {
        name = "llamenos relay"
        description = "Private relay for Llamenos hub events"
        pubkey = ""
        contact = ""
        icon = ""
        nips = ""
    }

    maxWebsocketPayloadSize = 65536
    maxReqFilterSize = 50
    autoPingSeconds = 30
    enableTcpKeepalive = true
    queryTimesliceBudgetMicroseconds = 5000
    maxFilterLimit = 100
    maxSubsPerConnection = 10

    writePolicy {
        # Production: configure write-policy plugin to whitelist server pubkey
        # See docs/DEPLOYMENT_HARDENING.md for setup
        plugin = ""
    }

    compression {
        enabled = true
        slidingWindow = true
    }

    logging {
        dumpInAll = false
        dumpInEvents = false
        dumpInReqs = false
        dbScanPerf = false
        invalidEvents = true
    }

    numThreads {
        ingester = 3
        reqWorker = 3
        reqMonitor = 3
        negentropy = 2
    }

    negentropy {
        enabled = true
        maxSyncEvents = 1000000
    }
}
```

## Files to Create

| File | Purpose |
|------|---------|
| `deploy/docker/strfry-prod.conf` | Production-hardened strfry relay configuration |

## Files to Modify

| File | Change |
|------|--------|
| `apps/worker/lib/nostr-events.ts` | Task 1: Return `Promise<void>` instead of `void` |
| `apps/worker/routes/conversations.ts` | Task 2: Add `.catch()` to 3 `publishNostrEvent` calls |
| `apps/worker/routes/reports.ts` | Task 2: Add `.catch()` to 3 `publishNostrEvent` calls |
| `apps/worker/messaging/router.ts` | Task 3: Replace direct publisher calls with `publishNostrEvent()` (SECURITY: fixes unencrypted events) |
| `apps/worker/durable-objects/call-router.ts` | Task 4: Replace private method with shared `publishNostrEvent()` |
| `apps/worker/lib/nostr-publisher.ts` | Tasks 5-7: flushPendingEvents OK, reconnect cap, NIP42 import |
| `packages/shared/nostr-events.ts` | Task 8: Remove orphaned constants |
| `apps/ios/Sources/Services/WebSocketService.swift` | Task 8: Remove 20001 from kind filter |
| `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt` | Task 8: Remove 20001 from kind filter |
| `.claude/skills/nostr-realtime-events/SKILL.md` | Task 9: Replace fake event kinds with actual constants |
| `deploy/docker/strfry-test.conf` | Task 10: Remove nonexistent write-policy.py reference |

## Testing

### Unit Tests

**File**: `apps/worker/__tests__/unit/nostr-publisher.test.ts`

Add/update tests:
- `flushPendingEvents sends events through sendAndAwaitOk` — verify flushed events get OK tracking
- `scheduleReconnect stops after MAX_RECONNECT_ATTEMPTS` — verify no retry after cap
- `publish uses KIND_NIP42_AUTH constant for auth` — verify import used

**File**: `apps/worker/__tests__/unit/nostr-events.test.ts` (new)

- `publishNostrEvent rejects when publisher rejects`
- `publishNostrEvent resolves when publisher resolves`
- `publishNostrEvent encrypts content when SERVER_NOSTR_SECRET is set`

### Backend BDD

Existing relay event delivery scenarios in `relay-event-delivery.feature` should continue passing.

## Acceptance Criteria & Test Scenarios

- [ ] `publishNostrEvent()` returns `Promise<void>` — callers can await or catch
  -> `apps/worker/__tests__/unit/nostr-events.test.ts: "rejects when publisher rejects"`
- [ ] All 8 route/messaging callers have explicit `.catch()` handlers
  -> Code review: grep for `publishNostrEvent` in routes + messaging, verify each has `.catch()`
- [ ] `messaging/router.ts` uses `publishNostrEvent()` with encryption (SECURITY)
  -> Code review: no direct `getNostrPublisher().publish()` in messaging/router.ts, no `JSON.stringify` content
- [ ] `CallRouterDO` uses shared `publishNostrEvent()` instead of duplicating encryption
  -> Code review: `call-router.ts` has no `deriveServerEventKey` or `encryptHubEvent` import
- [ ] `flushPendingEvents()` uses `sendAndAwaitOk()` for relay acknowledgment
  -> `apps/worker/__tests__/unit/nostr-publisher.test.ts: "flushPendingEvents tracks OK"`
- [ ] Reconnect stops after 10 attempts
  -> `apps/worker/__tests__/unit/nostr-publisher.test.ts: "stops reconnecting after max attempts"`
- [ ] NIP-42 auth uses `KIND_NIP42_AUTH` import
  -> Code review: no literal `22242` in `nostr-publisher.ts`
- [ ] Orphaned constants removed from `packages/shared/nostr-events.ts`
  -> Code review: no `KIND_SHIFT_UPDATE`, `KIND_SETTINGS_CHANGED`, or `KIND_CALL_SIGNAL` exports
- [ ] Mobile kind filters updated to `[1000,1001,1002,1010,1011,20000]`
  -> Code review: no `20001` in iOS/Android kind filters
- [ ] Skill documentation matches actual codebase constants
  -> Code review: `.claude/skills/nostr-realtime-events/SKILL.md` kind table matches `packages/shared/nostr-events.ts`
- [ ] strfry-test.conf no longer references nonexistent write-policy.py
  -> `deploy/docker/strfry-test.conf` has `plugin = ""`
- [ ] strfry-prod.conf exists with hardened settings
  -> File exists with `rejectEventsOlderThanSeconds = 86400`
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `apps/worker/__tests__/unit/nostr-events.test.ts` | New | Unit tests for publishNostrEvent |
| `apps/worker/__tests__/unit/nostr-publisher.test.ts` | Modified | Additional tests for flush, reconnect cap |

## Risk Assessment

- **Low risk**: Tasks 6-10 — import fixes, constant cleanup, config files, documentation
- **Medium risk**: Task 1-2 — changing `publishNostrEvent()` signature affects 6 callers, but all become explicit `.catch()` which preserves existing behavior
- **Medium risk**: Task 3 — consolidating CallRouterDO encryption into shared function, but encryption logic is identical
- **Low risk**: Task 4 — flushPendingEvents now tracks OK, but errors are logged not propagated (queued events have no caller to report to)
- **Low risk**: Task 5 — reconnect cap is a safety valve, not a behavior change for healthy relays

## Execution

- Tasks 1-4 are sequential (signature change → route callers → messaging router → call-router consolidation)
- Tasks 5-7 are independent (all in `nostr-publisher.ts` but different methods)
- Tasks 8-11 are independent (different files, no overlap)
- After Task 4, Tasks 5-11 can run in parallel
