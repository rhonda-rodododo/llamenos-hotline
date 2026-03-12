# Epic 310: Nostr Publisher Reliability & Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 11 reliability gaps in the Nostr event publishing pipeline, including a security fix for unencrypted messaging events.

**Architecture:** All changes are in the backend worker (`apps/worker/`) and infrastructure configs. The core change is making `publishNostrEvent()` async so callers can handle errors, then consolidating all publishing through that single function (eliminating duplicated encryption logic in `call-router.ts` and fixing the unencrypted events in `messaging/router.ts`). Secondary changes: publisher reliability (flush OK tracking, reconnect cap), cleanup (orphaned constants, skill docs, strfry configs).

**Tech Stack:** TypeScript (Hono worker), WebSocket (nostr-publisher), strfry relay config, vitest

---

### Task 1: Make `publishNostrEvent()` return `Promise<void>`

**Files:**
- Modify: `apps/worker/lib/nostr-events.ts`
- Create: `apps/worker/__tests__/unit/nostr-events.test.ts`

**Step 1: Write failing tests for the new async signature**

Create `apps/worker/__tests__/unit/nostr-events.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We need to mock the dependencies before importing
vi.mock('../../../lib/do-access', () => ({
  getNostrPublisher: vi.fn(),
}))
vi.mock('../../../lib/hub-event-crypto', () => ({
  deriveServerEventKey: vi.fn(() => new Uint8Array(32)),
  encryptHubEvent: vi.fn((_content, _key) => 'encrypted-hex-content'),
}))

import { publishNostrEvent } from '@worker/lib/nostr-events'
import { getNostrPublisher } from '@worker/lib/do-access'

describe('publishNostrEvent', () => {
  const mockEnv = {
    SERVER_NOSTR_SECRET: 'a'.repeat(64),
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves when publisher resolves', async () => {
    const mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
      serverPubkey: 'test',
      close: vi.fn(),
    }
    vi.mocked(getNostrPublisher).mockReturnValue(mockPublisher)

    await expect(publishNostrEvent(mockEnv, 1000, { type: 'test' }))
      .resolves.toBeUndefined()
    expect(mockPublisher.publish).toHaveBeenCalledOnce()
  })

  it('rejects when publisher rejects', async () => {
    const mockPublisher = {
      publish: vi.fn().mockRejectedValue(new Error('Relay rejected')),
      serverPubkey: 'test',
      close: vi.fn(),
    }
    vi.mocked(getNostrPublisher).mockReturnValue(mockPublisher)

    await expect(publishNostrEvent(mockEnv, 1000, { type: 'test' }))
      .rejects.toThrow('Relay rejected')
  })

  it('encrypts content when SERVER_NOSTR_SECRET is set', async () => {
    const mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
      serverPubkey: 'test',
      close: vi.fn(),
    }
    vi.mocked(getNostrPublisher).mockReturnValue(mockPublisher)

    await publishNostrEvent(mockEnv, 1000, { type: 'test' })

    const publishCall = mockPublisher.publish.mock.calls[0][0]
    expect(publishCall.content).toBe('encrypted-hex-content')
    expect(publishCall.kind).toBe(1000)
    expect(publishCall.tags).toEqual([['d', 'global'], ['t', 'llamenos:event']])
  })

  it('sends plaintext JSON when no SERVER_NOSTR_SECRET', async () => {
    const mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
      serverPubkey: 'test',
      close: vi.fn(),
    }
    vi.mocked(getNostrPublisher).mockReturnValue(mockPublisher)

    await publishNostrEvent({} as any, 1000, { type: 'test' })

    const publishCall = mockPublisher.publish.mock.calls[0][0]
    expect(JSON.parse(publishCall.content)).toEqual({ type: 'test' })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun run test:worker:unit -- nostr-events`
Expected: FAIL — `publishNostrEvent` is void, not async

**Step 3: Implement the async signature**

Modify `apps/worker/lib/nostr-events.ts` — change the function from void fire-and-forget to async:

```typescript
import type { AppEnv } from '../types'
import { getNostrPublisher } from './do-access'
import { deriveServerEventKey, encryptHubEvent } from './hub-event-crypto'

/** Cached event key — derived once per isolate lifetime */
let cachedEventKey: Uint8Array | null = null

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

**Step 4: Run tests to verify they pass**

Run: `bun run test:worker:unit -- nostr-events`
Expected: PASS — all 4 tests pass

**Step 5: Commit**

```bash
git add apps/worker/lib/nostr-events.ts apps/worker/__tests__/unit/nostr-events.test.ts
git commit -m "feat(E310): make publishNostrEvent async with error propagation"
```

---

### Task 2: Add `.catch()` to route-level callers

**Files:**
- Modify: `apps/worker/routes/conversations.ts` (3 calls)
- Modify: `apps/worker/routes/reports.ts` (3 calls)

**Step 1: Update conversations.ts callers**

Find all 3 `publishNostrEvent` calls in `conversations.ts` and add `.catch()`:

Each bare `publishNostrEvent(c.env, ...)` becomes:
```typescript
publishNostrEvent(c.env, KIND_MESSAGE_NEW, {
  type: 'message:new',
  conversationId: id,
  // ... existing fields
}).catch((e) => {
  console.error(`[conversations] Failed to publish event:`, e)
})
```

**Step 2: Update reports.ts callers**

Same pattern for all 3 calls in `reports.ts`:
```typescript
publishNostrEvent(c.env, KIND_MESSAGE_NEW, {
  // ... existing fields
}).catch((e) => {
  console.error(`[reports] Failed to publish event:`, e)
})
```

**Step 3: Run type check**

Run: `bun run typecheck`
Expected: PASS — `.catch()` is valid on `Promise<void>`

**Step 4: Commit**

```bash
git add apps/worker/routes/conversations.ts apps/worker/routes/reports.ts
git commit -m "fix(E310): add explicit error handling to route publishNostrEvent callers"
```

---

### Task 3: Migrate messaging/router.ts to publishNostrEvent() (SECURITY FIX)

**Files:**
- Modify: `apps/worker/messaging/router.ts`

**Step 1: Read the current code**

Read `apps/worker/messaging/router.ts` lines 105-140 and 340-375 to understand the two direct publisher calls.

**Step 2: Replace first call (lines ~110-136) with publishNostrEvent()**

The current code at ~line 110 does:
```typescript
const publisher = getNostrPublisher(c.env)
withRetry(() => publisher.publish({ kind: KIND_MESSAGE_NEW, ..., content: JSON.stringify({...}) }), ...)
```

Replace with:
```typescript
publishNostrEvent(c.env, KIND_MESSAGE_NEW, {
  type: 'message:status',
  conversationId: result.conversationId,
  messageId: result.messageId,
  status: statusUpdate.status,
  timestamp: statusUpdate.timestamp,
}).catch((e) => {
  console.error('[messaging] Failed to publish status update:', e)
})
```

Remove the `try-catch` wrapper, `withRetry`, and direct `getNostrPublisher` call for this block.

**Step 3: Replace second call (lines ~343-371) with publishNostrEvent()**

Replace:
```typescript
const publisher = getNostrPublisher(env)
withRetry(() => publisher.publish({ kind: KIND_CONVERSATION_ASSIGNED, ..., content: JSON.stringify({...}) }), ...)
```

With:
```typescript
publishNostrEvent(env, KIND_CONVERSATION_ASSIGNED, {
  type: 'conversation:assigned',
  conversationId,
  assignedTo: bestCandidate,
  autoAssigned: true,
}).catch((e) => {
  console.error('[messaging] Failed to publish auto-assignment:', e)
})
```

**Step 4: Clean up imports**

Remove `getNostrPublisher` import if no longer used in this file. Add `publishNostrEvent` import from `../lib/nostr-events`. Remove `withRetry` and `isRetryableError` imports if no longer used.

**Step 5: Run type check**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/worker/messaging/router.ts
git commit -m "fix(E310): encrypt messaging router events via publishNostrEvent (security fix)"
```

---

### Task 4: Consolidate CallRouterDO encryption into shared publishNostrEvent()

**Files:**
- Modify: `apps/worker/durable-objects/call-router.ts`

**Step 1: Read the current private publishNostrEvent method**

Read `apps/worker/durable-objects/call-router.ts` lines 515-560 to understand the current implementation.

**Step 2: Replace the private method**

Replace the existing `private publishNostrEvent(kind, content)` with:

```typescript
private publishEvent(kind: number, content: Record<string, unknown>): void {
  withRetry(
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

**Step 3: Update all call sites within CallRouterDO**

Replace `this.publishNostrEvent(KIND_*, ...)` with `this.publishEvent(KIND_*, ...)` at all ~7 locations.

**Step 4: Clean up imports**

Remove `deriveServerEventKey`, `encryptHubEvent` imports and the `eventKey` instance variable since encryption is now handled by the shared function.

Add import: `import { publishNostrEvent } from '../lib/nostr-events'`

**Step 5: Run type check + unit tests**

Run: `bun run typecheck && bun run test:worker:unit`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/worker/durable-objects/call-router.ts
git commit -m "refactor(E310): consolidate CallRouterDO encryption into shared publishNostrEvent"
```

---

### Task 5: Fix flushPendingEvents() to use sendAndAwaitOk()

**Files:**
- Modify: `apps/worker/lib/nostr-publisher.ts`
- Modify: `apps/worker/__tests__/unit/nostr-publisher.test.ts`

**Step 1: Write failing test**

Add to `apps/worker/__tests__/unit/nostr-publisher.test.ts` in the "NodeNostrPublisher OK handling" describe block:

```typescript
it('flushPendingEvents sends events through sendAndAwaitOk', async () => {
  const receivedEvents: string[] = []

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg[0] === 'EVENT') {
        receivedEvents.push(msg[1].id)
        // Send OK true for each event
        ws.send(JSON.stringify(['OK', msg[1].id, true, '']))
      }
    })
  })

  publisher = new NodeNostrPublisher(`ws://localhost:${port}`, TEST_SECRET)

  // Publish before connecting — event gets queued
  const publishPromise = publisher.publish({
    kind: 1000,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', 'llamenos:event']],
    content: '{"type":"test"}',
  })

  // Now connect — should flush queued events and track OK
  await publisher.connect()
  await new Promise(r => setTimeout(r, 2500)) // Wait for auth timeout + flush

  // Verify the event was sent and acknowledged
  expect(receivedEvents.length).toBeGreaterThanOrEqual(1)
}, 10_000)
```

**Step 2: Run test to verify current behavior**

Run: `bun run test:worker:unit -- nostr-publisher`
Expected: Current test may pass or fail depending on flush timing

**Step 3: Update flushPendingEvents**

In `apps/worker/lib/nostr-publisher.ts`, replace `flushPendingEvents()`:

```typescript
private flushPendingEvents(): void {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

  while (this.pendingEvents.length > 0) {
    const event = this.pendingEvents.shift()!
    this.sendAndAwaitOk(event).catch((err) => {
      console.error(`[nostr-publisher] Flushed event ${event.id} rejected:`, err)
    })
  }
}
```

**Step 4: Run tests**

Run: `bun run test:worker:unit -- nostr-publisher`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/lib/nostr-publisher.ts apps/worker/__tests__/unit/nostr-publisher.test.ts
git commit -m "fix(E310): flushPendingEvents uses sendAndAwaitOk for relay acknowledgment"
```

---

### Task 6: Cap reconnect attempts at 10

**Files:**
- Modify: `apps/worker/lib/nostr-publisher.ts`
- Modify: `apps/worker/__tests__/unit/nostr-publisher.test.ts`

**Step 1: Write failing test**

```typescript
it('stops reconnecting after MAX_RECONNECT_ATTEMPTS', async () => {
  // Create publisher pointing to a port with nothing listening
  publisher = new NodeNostrPublisher(`ws://localhost:1`, TEST_SECRET)

  // Force reconnectAttempts to max
  ;(publisher as any).reconnectAttempts = 10
  ;(publisher as any).closed = false

  // Call scheduleReconnect — should NOT schedule a timer
  ;(publisher as any).scheduleReconnect()

  expect((publisher as any).reconnectTimer).toBeNull()
})
```

**Step 2: Run test to verify it fails**

Run: `bun run test:worker:unit -- nostr-publisher`
Expected: FAIL — currently no cap, timer would be scheduled

**Step 3: Add MAX_RECONNECT_ATTEMPTS to NodeNostrPublisher**

In `apps/worker/lib/nostr-publisher.ts`, update `scheduleReconnect()`:

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

**Step 4: Run tests**

Run: `bun run test:worker:unit -- nostr-publisher`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/lib/nostr-publisher.ts apps/worker/__tests__/unit/nostr-publisher.test.ts
git commit -m "fix(E310): cap NodeNostrPublisher reconnect attempts at 10"
```

---

### Task 7: Import KIND_NIP42_AUTH instead of magic number

**Files:**
- Modify: `apps/worker/lib/nostr-publisher.ts`

**Step 1: Add import and replace literal**

Add to imports:
```typescript
import { KIND_NIP42_AUTH } from '@shared/nostr-events'
```

In `handleNIP42Auth()`, change:
```typescript
kind: 22242,
```
to:
```typescript
kind: KIND_NIP42_AUTH,
```

**Step 2: Run type check**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/worker/lib/nostr-publisher.ts
git commit -m "refactor(E310): import KIND_NIP42_AUTH instead of magic number 22242"
```

---

### Task 8: Remove orphaned kind constants + update mobile filters

**Files:**
- Modify: `packages/shared/nostr-events.ts`
- Modify: `apps/ios/Sources/Services/WebSocketService.swift`
- Modify: `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt`

**Step 1: Remove orphaned constants from nostr-events.ts**

Remove these three exports:
```typescript
export const KIND_SHIFT_UPDATE = 1020
export const KIND_SETTINGS_CHANGED = 1030
export const KIND_CALL_SIGNAL = 20001
```

Keep all comments but remove the constant + its JSDoc comment.

**Step 2: Verify no imports break**

Run: `bun run typecheck`
Expected: PASS — these constants are never imported

**Step 3: Update iOS kind filter**

In `apps/ios/Sources/Services/WebSocketService.swift`, find the kind filter and change:
```swift
"kinds":[1000,1001,1002,1010,1011,20000,20001]
```
to:
```swift
"kinds":[1000,1001,1002,1010,1011,20000]
```

**Step 4: Update Android kind filter**

In `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt`, find the kind filter and change:
```kotlin
"kinds":[1000,1001,1002,1010,1011,20000,20001]
```
to:
```kotlin
"kinds":[1000,1001,1002,1010,1011,20000]
```

**Step 5: Commit**

```bash
git add packages/shared/nostr-events.ts apps/ios/Sources/Services/WebSocketService.swift apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt
git commit -m "cleanup(E310): remove orphaned kind constants and 20001 from mobile filters"
```

---

### Task 9: Update skill documentation

**Files:**
- Modify: `.claude/skills/nostr-realtime-events/SKILL.md`

**Step 1: Read the current skill file**

Read `.claude/skills/nostr-realtime-events/SKILL.md` to understand the full content.

**Step 2: Replace the fake event kinds table (around lines 147-160)**

Replace the table listing `KIND_CALL_EVENT = 20001`, `KIND_NOTE_EVENT = 20002`, etc. with:

```markdown
## Existing Event Kinds

All constants defined in `packages/shared/nostr-events.ts`:

| Constant | Value | Published By | Content Type | Trigger |
|----------|-------|-------------|--------------|---------|
| `KIND_CALL_RING` | 1000 | CallRouterDO | `call:ring` | Incoming call |
| `KIND_CALL_UPDATE` | 1001 | CallRouterDO | `call:update` | Call answered, completed, etc. |
| `KIND_CALL_VOICEMAIL` | 1002 | CallRouterDO | `voicemail:new` | Voicemail received |
| `KIND_MESSAGE_NEW` | 1010 | Routes + messaging/router | `message:new` | Inbound message or status update |
| `KIND_CONVERSATION_ASSIGNED` | 1011 | Routes + messaging/router | `conversation:assigned` / `conversation:closed` | Assignment change |
| `KIND_PRESENCE_UPDATE` | 20000 | CallRouterDO | `presence:summary` | Volunteer availability changed |
| `KIND_NIP42_AUTH` | 22242 | NodeNostrPublisher | NIP-42 auth | Relay authentication |

Kinds 1000-1011 are regular (persisted by relay). Kind 20000 is ephemeral (broadcast only, 5-min TTL).
```

**Step 3: Update "Adding a New Event Type" section**

Make sure it references `publishNostrEvent()` from `apps/worker/lib/nostr-events.ts` (not direct publisher calls), and uses the actual function signature.

**Step 4: Fix any other stale references**

Check for mentions of `20001`, `KIND_CALL_EVENT`, etc. and update them.

**Step 5: Commit**

```bash
git add .claude/skills/nostr-realtime-events/SKILL.md
git commit -m "docs(E310): update nostr-realtime-events skill with actual event kinds"
```

---

### Task 10: Fix strfry-test.conf write policy

**Files:**
- Modify: `deploy/docker/strfry-test.conf`

**Step 1: Fix the write policy reference**

In `deploy/docker/strfry-test.conf`, change line 50:
```
plugin = "/app/write-policy.py"
```
to:
```
plugin = ""
```

**Step 2: Commit**

```bash
git add deploy/docker/strfry-test.conf
git commit -m "fix(E310): remove nonexistent write-policy.py reference from strfry-test.conf"
```

---

### Task 11: Add strfry production config

**Files:**
- Create: `deploy/docker/strfry-prod.conf`

**Step 1: Create the production config**

Create `deploy/docker/strfry-prod.conf` based on the dev config but with hardened settings:
- `rejectEventsOlderThanSeconds = 86400` (1 day, not 3 years)
- `rejectEventsNewerThanSeconds = 60` (1 minute, not 15)
- `maxNumTags = 50` (not 2000)
- `maxTagValSize = 256` (not 1024)
- `maxWebsocketPayloadSize = 65536` (not 131072)
- `maxReqFilterSize = 50` (not 200)
- `autoPingSeconds = 30` (not 55)
- `enableTcpKeepalive = true` (not false)
- `maxFilterLimit = 100` (not 500)
- `maxSubsPerConnection = 10` (not 20)
- `realIpHeader = "X-Forwarded-For"` (for reverse proxy)

See the full config in Epic 310 Task 11.

**Step 2: Commit**

```bash
git add deploy/docker/strfry-prod.conf
git commit -m "feat(E310): add production-hardened strfry relay configuration"
```

---

### Task 12: Final verification

**Step 1: Run type check**

Run: `bun run typecheck`
Expected: PASS

**Step 2: Run all worker unit tests**

Run: `bun run test:worker:unit`
Expected: PASS — all existing + new tests pass

**Step 3: Verify no orphaned imports**

Run: `grep -r 'KIND_SHIFT_UPDATE\|KIND_SETTINGS_CHANGED\|KIND_CALL_SIGNAL' apps/ packages/ src/ --include='*.ts' --include='*.swift' --include='*.kt'`
Expected: No matches (only in docs/epics which is fine)

**Step 4: Commit any remaining changes**

If any files needed adjustment, commit them.
