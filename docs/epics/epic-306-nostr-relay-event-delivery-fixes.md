# Epic 306: Nostr Relay Event Delivery Fixes

**Status**: COMPLETE
**Priority**: High (P0 — blocks real-time features across all platforms)
**Depends on**: None
**Blocks**: Epic 307 (Real-Time Event Delivery BDD Coverage)
**Branch**: `desktop`

## Summary

Fix 5 independent bugs that collectively break all real-time Nostr relay event delivery. The strfry relay was silently rejecting all events due to a write policy whitelist (already fixed — `strfry-dev.conf` mounted in compose). The `NodeNostrPublisher` swallows relay rejections. Mobile clients subscribe to the wrong event kind (20001 instead of the kinds the backend publishes: 1000-1011, 20000). Android's event type string parser uses underscores (`call_ring`) when the backend sends colons (`call:ring`). CF and Node publishers have inconsistent error semantics.

## Problem Statement

### P1: strfry write policy blocks all events (FIXED)
The `dockurr/strfry:1.0.1` Docker image ships with a default write policy that whitelists specific pubkeys. The dev and test compose files did not mount a custom config, so the image's built-in whitelist blocked all events from the server's derived pubkey. **Already fixed** — `strfry-dev.conf` and `strfry-test.conf` now set `plugin = ""`.

### P2: NodeNostrPublisher silently swallows relay rejections
When strfry returns `["OK", eventId, false, "reason"]`, `NodeNostrPublisher.setupListeners()` (line 242) logs `console.warn()` but the `publish()` promise has already resolved. The caller never knows the event was rejected. This means:
- `call-router.ts:551` `.catch()` never fires for relay rejections
- `nostr-events.ts:29` `.catch()` never fires
- DB state is mutated (call answered, message stored) but the real-time notification is silently lost

### P3: Mobile clients subscribe to wrong Nostr event kind
iOS (`WebSocketService.swift:181`) and Android (`WebSocketService.kt:162`) both subscribe with `{"kinds":[20001]}`, which is `KIND_CALL_SIGNAL`. But the backend publishes:
- `KIND_CALL_RING = 1000`
- `KIND_CALL_UPDATE = 1001`
- `KIND_CALL_VOICEMAIL = 1002`
- `KIND_MESSAGE_NEW = 1010`
- `KIND_CONVERSATION_ASSIGNED = 1011`
- `KIND_PRESENCE_UPDATE = 20000`

**Nothing publishes kind 20001.** Mobile clients receive zero events even with a working relay.

### P4: Android event type string mismatch
`WebSocketService.kt:204-231` parses `content.type` using underscores (`call_ring`, `call_ended`, `message_received`, `conversation_update`). The backend publishes colons: `call:ring`, `call:update`, `voicemail:new`, `message:new`, `conversation:assigned`, `conversation:closed`, `presence:summary`. Every event would fall through to `LlamenosEvent.Unknown(type)`.

### P5: CF vs Node publisher error semantics inconsistency
`CFNostrPublisher.publish()` throws on relay rejection (with circuit breaker + retry). `NodeNostrPublisher.publish()` resolves successfully even when the relay rejects. Callers cannot write platform-agnostic error handling.

## Implementation

### Task 1: NodeNostrPublisher rejection handling (P2)

**File**: `apps/worker/lib/nostr-publisher.ts`

Track pending publish promises and reject them when the relay responds with `OK false`:

```typescript
// Add to NodeNostrPublisher class:
private pendingPublishes = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()
private publishTimeout = 10_000 // 10s timeout for OK acknowledgment

async publish(template: EventTemplate): Promise<void> {
  const event = signServerEvent(template, this.secretKey)

  if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
    return this.sendAndAwaitOk(event)
  }

  // Queue and ensure connection
  this.pendingEvents.push(event)
  if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
    this.connect().catch((err) => {
      console.error('[nostr-publisher] Failed to connect:', err)
    })
  }
}

private sendAndAwaitOk(event: VerifiedEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pendingPublishes.delete(event.id)
      reject(new Error(`Relay did not acknowledge event ${event.id} within ${this.publishTimeout}ms`))
    }, this.publishTimeout)

    this.pendingPublishes.set(event.id, {
      resolve: () => { clearTimeout(timer); resolve() },
      reject: (err) => { clearTimeout(timer); reject(err) },
    })

    this.ws!.send(JSON.stringify(['EVENT', event]))
  })
}
```

Update the OK handler in `setupListeners()`:

```typescript
} else if (data[0] === 'OK') {
  const eventId = data[1] as string
  const accepted = data[2] as boolean
  const message = data[3] as string
  const pending = this.pendingPublishes.get(eventId)
  if (pending) {
    this.pendingPublishes.delete(eventId)
    if (accepted) {
      pending.resolve()
    } else {
      pending.reject(new Error(`Relay rejected event ${eventId}: ${message}`))
    }
  }
}
```

Update `flushPendingEvents()` to use `sendAndAwaitOk()`:

```typescript
private flushPendingEvents(): void {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

  while (this.pendingEvents.length > 0) {
    const event = this.pendingEvents.shift()!
    // Fire-and-forget for queued events during reconnect — they were already
    // accepted by the caller's publish() promise (which resolved when queued)
    this.ws.send(JSON.stringify(['EVENT', event]))
  }
}
```

Also clean up pending publishes on close:

```typescript
// In close():
for (const pending of this.pendingPublishes.values()) {
  pending.reject(new Error('Publisher closed'))
}
this.pendingPublishes.clear()

// In 'close' event handler:
for (const pending of this.pendingPublishes.values()) {
  pending.reject(new Error('WebSocket closed'))
}
this.pendingPublishes.clear()
```

### Task 2: Mobile kind filter fix (P3)

**iOS**: `apps/ios/Sources/Services/WebSocketService.swift:180-181`

**Before**:
```swift
let reqMessage = """
["REQ","\(subscriptionId)",{"kinds":[20001],"#t":["llamenos:event"]}]
"""
```

**After**:
```swift
let reqMessage = """
["REQ","\(subscriptionId)",{"kinds":[1000,1001,1002,1010,1011,20000,20001],"#t":["llamenos:event"]}]
"""
```

**Android**: `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt:162`

**Before**:
```kotlin
val filter = """{"kinds":[20001],"#t":["llamenos:event"]}"""
```

**After**:
```kotlin
val filter = """{"kinds":[1000,1001,1002,1010,1011,20000,20001],"#t":["llamenos:event"]}"""
```

**Future improvement**: Both mobile clients should import kind constants from codegen rather than hardcoding. But that requires `packages/protocol` to generate kind constants for Swift/Kotlin — out of scope for this fix.

### Task 3: Android event type string fix (P4)

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt:203-231`

**Before**:
```kotlin
when (type) {
    "call_ring" -> LlamenosEvent.CallRing(callId)
    "call_ended" -> LlamenosEvent.CallEnded(callId)
    "shift_update" -> LlamenosEvent.ShiftUpdate(shiftId, status)
    "note_created" -> LlamenosEvent.NoteCreated(noteId)
    "message_received" -> LlamenosEvent.MessageReceived(conversationId, messageId)
    "conversation_update" -> LlamenosEvent.ConversationUpdate(conversationId, status)
    else -> LlamenosEvent.Unknown(type)
}
```

**After** (matching backend `content.type` values from `call-router.ts`, `nostr-events.ts`, `conversations.ts`):
```kotlin
when (type) {
    "call:ring" -> LlamenosEvent.CallRing(callId)
    "call:update" -> {
        val status = obj["status"]?.jsonPrimitive?.content ?: return null
        if (status == "completed") LlamenosEvent.CallEnded(callId)
        else LlamenosEvent.CallUpdate(callId, status)
    }
    "voicemail:new" -> LlamenosEvent.VoicemailNew(callId)
    "presence:summary" -> {
        val hasAvailable = obj["hasAvailable"]?.jsonPrimitive?.boolean ?: false
        LlamenosEvent.PresenceSummary(hasAvailable)
    }
    "message:new" -> {
        val conversationId = obj["conversationId"]?.jsonPrimitive?.content ?: return null
        LlamenosEvent.MessageNew(conversationId)
    }
    "conversation:assigned" -> {
        val conversationId = obj["conversationId"]?.jsonPrimitive?.content ?: return null
        val assignedTo = obj["assignedTo"]?.jsonPrimitive?.content
        LlamenosEvent.ConversationAssigned(conversationId, assignedTo)
    }
    "conversation:closed" -> {
        val conversationId = obj["conversationId"]?.jsonPrimitive?.content ?: return null
        LlamenosEvent.ConversationClosed(conversationId)
    }
    else -> LlamenosEvent.Unknown(type)
}
```

This also requires updating the `LlamenosEvent` sealed class in `apps/android/app/src/main/java/org/llamenos/hotline/model/LlamenosEvent.kt` to add the new subtypes (`CallUpdate`, `VoicemailNew`, `PresenceSummary`, `MessageNew`, `ConversationAssigned`, `ConversationClosed`).

### Task 4: iOS event type handling (P3/P4 related)

iOS `WebSocketService.swift` currently emits raw `NostrEvent` objects via `AsyncStream` without parsing `content.type`. The `HubEventType` enum (lines 58-71) maps tag values like `llamenos:call-incoming` — but the backend uses the `["t", "llamenos:event"]` tag for ALL events and differentiates by `content.type` inside the encrypted payload.

**File**: `apps/ios/Sources/Services/WebSocketService.swift`

The iOS client needs a `parseLlamenosContent()` equivalent that:
1. Decrypts the event content using the hub key (via `CryptoService`)
2. Parses `content.type` using the same strings the backend publishes: `call:ring`, `call:update`, `voicemail:new`, `presence:summary`, `message:new`, `conversation:assigned`, `conversation:closed`
3. Emits typed events (not raw `NostrEvent`)

Update `HubEventType` to match backend type strings:

```swift
enum HubEventType: String, Sendable {
    case callRing = "call:ring"
    case callUpdate = "call:update"
    case voicemailNew = "voicemail:new"
    case presenceSummary = "presence:summary"
    case messageNew = "message:new"
    case conversationAssigned = "conversation:assigned"
    case conversationClosed = "conversation:closed"
    case unknown
}
```

### Task 5: Normalize publisher error semantics (P5)

No code change needed in callers — once Task 1 makes `NodeNostrPublisher.publish()` reject on relay rejection, both publishers have consistent throw-on-failure semantics. The existing `withRetry` + `.catch()` in callers will correctly handle both.

**Verify**: After Task 1, the call-router's `withRetry({ maxAttempts: 2 })` will actually retry on relay rejection (currently it only retries on connection errors, since rejection never throws).

## Files to Modify

### Files to Modify

| File | Change |
|------|--------|
| `apps/worker/lib/nostr-publisher.ts` | Task 1: Add OK-awaiting publish, timeout, rejection propagation |
| `apps/ios/Sources/Services/WebSocketService.swift` | Tasks 2, 4: Fix kind filter, update HubEventType enum, add content type parsing |
| `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt` | Tasks 2, 3: Fix kind filter, fix type string matching |
| `apps/android/app/src/main/java/org/llamenos/hotline/model/LlamenosEvent.kt` | Task 3: Add new event subtypes |
| `apps/worker/__tests__/unit/nostr-publisher.test.ts` | Task 1: Add tests for OK handling, rejection, timeout |

### Files Already Fixed (P1)

| File | Change |
|------|--------|
| `deploy/docker/strfry-dev.conf` | New — open relay config (no write policy) |
| `deploy/docker/docker-compose.dev.yml` | Mount strfry-dev.conf |
| `deploy/docker/strfry-test.conf` | Changed plugin to "" (was referencing non-existent write-policy.py) |

## Testing

### Unit Tests

**`apps/worker/__tests__/unit/nostr-publisher.test.ts`** — add:
- `NodeNostrPublisher.publish()` resolves when relay returns `["OK", eventId, true, ""]`
- `NodeNostrPublisher.publish()` rejects when relay returns `["OK", eventId, false, "blocked"]`
- `NodeNostrPublisher.publish()` rejects on timeout (no OK received within 10s)
- `NodeNostrPublisher.publish()` rejects all pending publishes on WebSocket close
- `NodeNostrPublisher.publish()` rejects all pending publishes on `close()` call

### Integration Tests (Backend BDD)

- Relay event publication verified by subscribing to relay in test harness (covered in Epic 307)

### Mobile Tests

- iOS: Verify `WebSocketService` subscribes to correct kinds (XCTest)
- Android: Verify `parseTypedEvent()` correctly parses all backend event types (JUnit)
- Android: Verify subscribe filter includes all required kinds (JUnit)

## Acceptance Criteria & Test Scenarios

- [ ] `NodeNostrPublisher.publish()` rejects when relay returns OK false
  → `apps/worker/__tests__/unit/nostr-publisher.test.ts: "rejects when relay returns OK false"`
- [ ] `NodeNostrPublisher.publish()` rejects on OK timeout (10s)
  → `apps/worker/__tests__/unit/nostr-publisher.test.ts: "rejects on OK acknowledgment timeout"`
- [ ] `NodeNostrPublisher.publish()` resolves when relay returns OK true
  → `apps/worker/__tests__/unit/nostr-publisher.test.ts: "resolves when relay accepts event"`
- [ ] Pending publishes are rejected on WebSocket close
  → `apps/worker/__tests__/unit/nostr-publisher.test.ts: "rejects pending publishes on close"`
- [ ] iOS subscribes to kinds [1000, 1001, 1002, 1010, 1011, 20000, 20001]
  → `apps/ios/Tests/WebSocketServiceTests.swift: "subscribes to all event kinds"`
- [ ] iOS `HubEventType` enum matches backend type strings
  → `apps/ios/Tests/WebSocketServiceTests.swift: "parses backend event types correctly"`
- [ ] Android subscribes to kinds [1000, 1001, 1002, 1010, 1011, 20000, 20001]
  → `apps/android/app/src/test/java/org/llamenos/hotline/api/WebSocketServiceTest.kt: "subscribes to all event kinds"`
- [ ] Android `parseTypedEvent()` handles `call:ring`, `call:update`, `voicemail:new`, `presence:summary`, `message:new`, `conversation:assigned`, `conversation:closed`
  → `apps/android/app/src/test/java/org/llamenos/hotline/api/WebSocketServiceTest.kt: "parses all backend event types"`
- [ ] `call-router.ts` `withRetry` actually retries on relay rejection (requires Task 1)
  → `packages/test-specs/features/core/relay-event-delivery.feature: "Backend retries failed relay publish"`
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/core/relay-event-delivery.feature` | New (Epic 307) | Scenarios for relay event publication and delivery |
| `apps/worker/__tests__/unit/nostr-publisher.test.ts` | Modified | OK handling, rejection, timeout tests |
| `apps/ios/Tests/WebSocketServiceTests.swift` | New | Kind filter and type parsing tests |
| `apps/android/app/src/test/java/org/llamenos/hotline/api/WebSocketServiceTest.kt` | New | Kind filter and type parsing tests |

## Risk Assessment

- **Low risk**: Mobile kind filter fix (Tasks 2-3) — mechanical constant change, no behavioral risk
- **Medium risk**: NodeNostrPublisher rejection handling (Task 1) — changes publish() contract from fire-and-forget to awaitable. All callers already use `.catch()` so they'll handle rejections correctly, but the retry behavior changes (retries now fire on rejection, not just connection errors)
- **Low risk**: Android type string fix (Task 3) — string constant alignment, covered by unit tests
- **Low risk**: iOS type enum update (Task 4) — enum rename, no logic change

## Execution

Tasks 1-4 are independent (no shared files) and can run in parallel. Task 5 is a verification step after Task 1.
