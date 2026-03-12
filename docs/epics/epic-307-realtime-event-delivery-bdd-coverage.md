# Epic 307: Real-Time Event Delivery BDD Coverage

**Status**: COMPLETE
**Priority**: High
**Depends on**: Epic 306 (Nostr Relay Event Delivery Fixes)
**Blocks**: None
**Branch**: `desktop`

## Summary

Add BDD test coverage for real-time Nostr relay event delivery across all platforms. Currently zero tests verify that events published by the backend reach relay subscribers. The entire real-time notification system (call ringing, presence updates, message delivery, conversation assignment) ships untested. This epic adds a relay event capture mechanism to the backend BDD test harness and writes scenarios for all 7 event types across 3 client platforms.

## Problem Statement

The Nostr relay was silently rejecting all events for an unknown duration (see Epic 306), and **no test caught it**. The root cause is that all existing tests verify REST API responses only — no scenario subscribes to the relay or verifies event delivery.

**Current test coverage of real-time features:**

| Event Kind | Backend BDD | Desktop E2E | iOS | Android |
|------------|-------------|-------------|-----|---------|
| `KIND_CALL_RING` (1000) | REST only | REST poll only | None | None |
| `KIND_CALL_UPDATE` (1001) | REST only | REST poll only | None | None |
| `KIND_CALL_VOICEMAIL` (1002) | REST only | REST poll only | None | None |
| `KIND_MESSAGE_NEW` (1010) | REST only | REST poll only | None | None |
| `KIND_CONVERSATION_ASSIGNED` (1011) | REST only | REST poll only | None | None |
| `KIND_PRESENCE_UPDATE` (20000) | REST only | REST poll only | None | None |
| `KIND_CALL_SIGNAL` (20001) | None | None | None | None |

**Target**: Every cell above should have at least one BDD scenario.

## Implementation

### Phase 1: Test Infrastructure + Backend BDD Scenarios

#### Task 1: Relay Event Capture Helper

Create a test utility that subscribes to the strfry relay and captures published events for assertion in BDD steps.

**File**: `tests/helpers/relay-capture.ts`

```typescript
import { WebSocket } from 'ws'

interface CapturedEvent {
  id: string
  kind: number
  content: string
  tags: string[][]
  created_at: number
  pubkey: string
}

/**
 * Subscribes to the Nostr relay and captures events for test assertions.
 *
 * Usage:
 *   const capture = await RelayCapture.connect('ws://localhost:7777')
 *   // ... trigger action that publishes an event ...
 *   const events = await capture.waitForEvents({ kind: 1000, count: 1, timeoutMs: 5000 })
 *   expect(events[0].content).toContain('call:ring')
 *   capture.close()
 */
export class RelayCapture {
  private ws: WebSocket
  private events: CapturedEvent[] = []
  private waiters: Array<{
    filter: { kind?: number; count: number }
    resolve: (events: CapturedEvent[]) => void
    reject: (err: Error) => void
  }> = []

  static async connect(relayUrl: string): Promise<RelayCapture> { ... }

  /** Wait for N events matching a filter, with timeout */
  async waitForEvents(opts: {
    kind?: number
    count?: number
    timeoutMs?: number
  }): Promise<CapturedEvent[]> { ... }

  /** Get all captured events (no waiting) */
  getEvents(kind?: number): CapturedEvent[] { ... }

  /** Clear captured events */
  clear(): void { ... }

  close(): void { ... }
}
```

#### Task 2: Shared BDD Feature File

**File**: `packages/test-specs/features/core/relay-event-delivery.feature`

```gherkin
@backend
Feature: Real-Time Relay Event Delivery
  The Nostr relay must deliver server-published events to subscribers.
  Every state mutation that publishes a Nostr event must result in
  the event arriving at the relay within 5 seconds.

  Background:
    Given the test relay is connected and capturing events
    And a registered admin "admin1"
    And a registered volunteer "vol1" on the current shift

  # --- Call Events ---

  @relay @calls
  Scenario: Incoming call publishes KIND_CALL_RING to relay
    When an incoming call arrives from "+15551234567"
    Then the relay should receive a kind 1000 event within 5 seconds
    And the decrypted event content type should be "call:ring"
    And the event should contain a "callId" field

  @relay @calls
  Scenario: Answering a call publishes KIND_CALL_UPDATE to relay
    Given an incoming call is ringing
    When volunteer "vol1" answers the call
    Then the relay should receive a kind 1001 event within 5 seconds
    And the decrypted event content type should be "call:update"
    And the event content "status" should be "in-progress"

  @relay @calls
  Scenario: Ending a call publishes KIND_CALL_UPDATE with completed status
    Given volunteer "vol1" is on an active call
    When volunteer "vol1" hangs up
    Then the relay should receive a kind 1001 event within 5 seconds
    And the decrypted event content type should be "call:update"
    And the event content "status" should be "completed"

  @relay @calls
  Scenario: Voicemail publishes KIND_CALL_VOICEMAIL to relay
    Given an incoming call is ringing
    When the call goes to voicemail
    Then the relay should receive a kind 1002 event within 5 seconds
    And the decrypted event content type should be "voicemail:new"

  # --- Presence Events ---

  @relay @presence
  Scenario: Answering a call publishes presence update to relay
    Given an incoming call is ringing
    When volunteer "vol1" answers the call
    Then the relay should receive a kind 20000 event within 5 seconds
    And the decrypted event content type should be "presence:summary"

  @relay @presence
  Scenario: Ending a call publishes presence update to relay
    Given volunteer "vol1" is on an active call
    When volunteer "vol1" hangs up
    Then the relay should receive a kind 20000 event within 5 seconds
    And the decrypted event content type should be "presence:summary"

  # --- Messaging Events ---

  @relay @messaging
  Scenario: Inbound message publishes KIND_MESSAGE_NEW to relay
    Given an active conversation with a caller
    When a new inbound message arrives in the conversation
    Then the relay should receive a kind 1010 event within 5 seconds
    And the decrypted event content type should be "message:new"
    And the event should contain a "conversationId" field

  @relay @messaging
  Scenario: Conversation assignment publishes KIND_CONVERSATION_ASSIGNED to relay
    Given an unassigned conversation exists
    When admin "admin1" assigns the conversation to volunteer "vol1"
    Then the relay should receive a kind 1011 event within 5 seconds
    And the decrypted event content type should be "conversation:assigned"
    And the event should contain an "assignedTo" field

  @relay @messaging
  Scenario: Closing a conversation publishes conversation closed event
    Given volunteer "vol1" has an active conversation
    When admin "admin1" closes the conversation
    Then the relay should receive a kind 1011 event within 5 seconds
    And the decrypted event content type should be "conversation:closed"

  # --- Event Encryption ---

  @relay @security
  Scenario: All relay events are encrypted with the server event key
    When an incoming call arrives from "+15551234567"
    Then the relay should receive a kind 1000 event within 5 seconds
    And the raw event content should NOT be valid JSON
    And the decrypted event content should be valid JSON

  # --- Event Structure ---

  @relay
  Scenario: All relay events have the llamenos:event tag
    When an incoming call arrives from "+15551234567"
    Then the relay should receive a kind 1000 event within 5 seconds
    And the event should have tag "t" with value "llamenos:event"
    And the event should have tag "d" with value "global"

  @relay
  Scenario: All relay events are signed by the server pubkey
    When an incoming call arrives from "+15551234567"
    Then the relay should receive a kind 1000 event within 5 seconds
    And the event signature should be valid
    And the event pubkey should match the server's configured pubkey

  # --- Rejection Handling ---

  @relay @error-handling
  Scenario: Backend retries failed relay publish
    Given the relay is temporarily unreachable
    When an incoming call arrives
    And the relay becomes reachable again
    Then the relay should eventually receive the call ring event
```

#### Task 3: Backend Step Definitions

**File**: `tests/steps/backend/relay.steps.ts`

Step definitions using the `RelayCapture` helper:

- `Given the test relay is connected and capturing events` — instantiate `RelayCapture` connected to `ws://localhost:7777`
- `Then the relay should receive a kind {int} event within {int} seconds` — `capture.waitForEvents({ kind, count: 1, timeoutMs })`
- `And the decrypted event content type should be {string}` — decrypt with server event key, parse JSON, assert `type` field
- `And the event should contain a {string} field` — assert field exists in decrypted content
- `And the event content {string} should be {string}` — assert field value in decrypted content
- `And the raw event content should NOT be valid JSON` — verify content is encrypted (hex, not JSON)
- `And the decrypted event content should be valid JSON` — verify decryption produces valid JSON
- `And the event should have tag {string} with value {string}` — assert tag exists in event
- `And the event signature should be valid` — `verifyEvent(event)` from nostr-tools
- `And the event pubkey should match the server's configured pubkey` — compare with `/api/config` response

### Phase 2: Client Subscription Tests (parallel agents)

#### Desktop (Playwright)

**File**: `tests/relay-subscription.spec.ts`

Test that the desktop UI updates via relay events (not just polling):

```typescript
// Disable REST polling for these tests to prove relay subscription works
test('incoming call appears via relay subscription without polling', async ({ page }) => {
  // Set polling interval to 999999ms to effectively disable it
  await page.evaluate(() => { /* monkey-patch setInterval */ })

  // Simulate incoming call
  await simulateIncomingCall(request, { callerNumber: '+15551234567' })

  // Call should appear within 3s (relay), not 15s (polling)
  await expect(page.getByTestId('incoming-call-banner')).toBeVisible({ timeout: 5_000 })
})
```

Scenarios:
- Call ring notification appears via relay (not polling)
- Call state update (answered) reflected via relay
- New message notification via relay
- Conversation assignment reflected via relay
- Presence card updates via relay

#### iOS (XCUITest)

**File**: `apps/ios/Tests/RelaySubscriptionTests.swift`

- Verify `WebSocketService` subscribes to correct kinds on connect
- Verify `parseRelayMessage` correctly parses all backend event types
- Verify events are emitted via `AsyncStream`
- Verify reconnection attempts on disconnect

#### Android (Compose UI Test)

**File**: `apps/android/app/src/androidTest/java/org/llamenos/hotline/relay/RelaySubscriptionTest.kt`

- Verify `WebSocketService` subscribes to correct kinds on connect
- Verify `parseTypedEvent` handles all backend event type strings
- Verify events flow through `typedEvents` SharedFlow
- Verify reconnection with exponential backoff

### Phase 3: Integration Gate

`bun run test:all` — all platforms pass.

## Files to Create

| File | Purpose |
|------|---------|
| `tests/helpers/relay-capture.ts` | Relay event capture utility for BDD tests |
| `tests/steps/backend/relay.steps.ts` | Backend step definitions for relay scenarios |
| `packages/test-specs/features/core/relay-event-delivery.feature` | Shared BDD scenarios for event delivery |
| `tests/relay-subscription.spec.ts` | Desktop Playwright tests for relay subscription |
| `apps/ios/Tests/RelaySubscriptionTests.swift` | iOS relay subscription tests |
| `apps/android/app/src/androidTest/java/org/llamenos/hotline/relay/RelaySubscriptionTest.kt` | Android relay subscription tests |

## Files to Modify

| File | Change |
|------|--------|
| `tests/steps/backend/common.steps.ts` | Add relay capture setup/teardown in Before/After hooks |

## Dependencies

| Package | Version | Why |
|---------|---------|-----|
| `ws` | Already in devDependencies | WebSocket client for relay capture in Node.js test process |

## Testing

All tests in this epic ARE the tests. The deliverable is the test infrastructure and scenarios themselves.

**Verification**: After implementation, run:
```bash
# Backend BDD relay scenarios
bun run test:backend:bdd --grep "relay"

# All platforms
bun run test:all
```

## Acceptance Criteria & Test Scenarios

- [ ] `RelayCapture` helper can connect to strfry and receive events
  → `tests/helpers/relay-capture.ts` used by all relay step definitions
- [ ] Backend BDD verifies `KIND_CALL_RING` (1000) published on incoming call
  → `packages/test-specs/features/core/relay-event-delivery.feature: "Incoming call publishes KIND_CALL_RING to relay"`
- [ ] Backend BDD verifies `KIND_CALL_UPDATE` (1001) published on call answer
  → `packages/test-specs/features/core/relay-event-delivery.feature: "Answering a call publishes KIND_CALL_UPDATE to relay"`
- [ ] Backend BDD verifies `KIND_CALL_UPDATE` (1001) published on call end
  → `packages/test-specs/features/core/relay-event-delivery.feature: "Ending a call publishes KIND_CALL_UPDATE with completed status"`
- [ ] Backend BDD verifies `KIND_CALL_VOICEMAIL` (1002) published on voicemail
  → `packages/test-specs/features/core/relay-event-delivery.feature: "Voicemail publishes KIND_CALL_VOICEMAIL to relay"`
- [ ] Backend BDD verifies `KIND_PRESENCE_UPDATE` (20000) published on call state change
  → `packages/test-specs/features/core/relay-event-delivery.feature: "Answering a call publishes presence update to relay"`
- [ ] Backend BDD verifies `KIND_MESSAGE_NEW` (1010) published on inbound message
  → `packages/test-specs/features/core/relay-event-delivery.feature: "Inbound message publishes KIND_MESSAGE_NEW to relay"`
- [ ] Backend BDD verifies `KIND_CONVERSATION_ASSIGNED` (1011) published on assignment
  → `packages/test-specs/features/core/relay-event-delivery.feature: "Conversation assignment publishes KIND_CONVERSATION_ASSIGNED to relay"`
- [ ] Backend BDD verifies events are encrypted (not plaintext JSON)
  → `packages/test-specs/features/core/relay-event-delivery.feature: "All relay events are encrypted with the server event key"`
- [ ] Backend BDD verifies events have correct tags and server signature
  → `packages/test-specs/features/core/relay-event-delivery.feature: "All relay events have the llamenos:event tag"`
- [ ] Desktop E2E verifies UI updates via relay (not polling)
  → `tests/relay-subscription.spec.ts: "incoming call appears via relay subscription without polling"`
- [ ] iOS tests verify correct kind subscription and event parsing
  → `apps/ios/Tests/RelaySubscriptionTests.swift`
- [ ] Android tests verify correct kind subscription and event type parsing
  → `apps/android/app/src/androidTest/java/org/llamenos/hotline/relay/RelaySubscriptionTest.kt`
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/core/relay-event-delivery.feature` | New | 13 scenarios covering all event kinds + security + error handling |
| `tests/steps/backend/relay.steps.ts` | New | Backend step definitions with RelayCapture |
| `tests/relay-subscription.spec.ts` | New | Desktop Playwright relay subscription tests |
| `apps/ios/Tests/RelaySubscriptionTests.swift` | New | iOS relay client tests |
| `apps/android/app/src/androidTest/java/org/llamenos/hotline/relay/RelaySubscriptionTest.kt` | New | Android relay client tests |

## Risk Assessment

- **Low risk**: Backend BDD scenarios (Phase 1) — straightforward WebSocket subscription + assertion; strfry is already running in dev compose
- **Medium risk**: Desktop Playwright relay tests — need to disable polling to prove relay-only delivery; may require mock/override of `setInterval` in test context
- **Low risk**: iOS/Android unit tests for kind filter and type parsing — pure function tests, no network dependency
- **Medium risk**: `RelayCapture` helper reliability — WebSocket timing in tests can be flaky; mitigated by generous timeouts (5s) and retry in `waitForEvents`

## Execution

- **Phase 1 is sequential**: Task 1 (RelayCapture) → Task 2 (feature file) → Task 3 (step definitions) → gate: `bun run test:backend:bdd` passes
- **Phase 2 is parallel**: Desktop / iOS / Android agents work on non-overlapping directories
- **Phase 3**: `bun run test:all`
