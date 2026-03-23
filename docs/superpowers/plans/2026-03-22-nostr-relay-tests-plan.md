# Nostr Relay Event Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add E2E tests that verify the real-time Nostr relay architecture: events published from server reach the client, event content is encrypted, and client-side decryption works correctly.

**Current state:** 0% coverage. The Nostr relay (strfry) runs in Docker Compose for local dev. Tests need to interact with it.

---

## Background

- Server publishes ephemeral Nostr **kind 20001** events (call ring, answer, update, voicemail; conversation message, assignment)
- Events are signed with the server's Nostr keypair (derived from `SERVER_NOSTR_SECRET`)
- Event content is encrypted with the hub key (random 32 bytes, ECIES-wrapped per member)
- Relay: strfry self-hosted, running on port 7778 in test/local Docker Compose
- Client subscribes via `useNostrSubscription()` hook using `NOSTR_RELAY_URL`
- Client decrypts event content using hub key (unwrapped with their nsec)

---

## Phase 1: Test Infrastructure

### 1.1 Nostr relay availability check
- [x] Add `isNostrRelayAvailable(): Promise<boolean>` to `tests/helpers.ts`
  - Attempts WebSocket connection to `process.env.NOSTR_RELAY_URL || 'ws://localhost:7778'`
  - Returns true if connected within 2 seconds
  - Used to skip relay tests if relay not running

### 1.2 Direct relay subscription helper
- [x] Add `subscribeToRelay(relayUrl, filter)` test helper using `nostr-tools` (already a dependency):
  - Opens a WebSocket to the relay
  - Sends NIP-01 `["REQ", subId, filter]`
  - Returns an async iterator of received events
  - Closes subscription after test

### 1.3 Hub key extraction for tests
- [x] Add `getHubKeyForVolunteer(request, page)` helper:
  - Calls `GET /api/config` to get hub info
  - Uses the logged-in volunteer's nsec (from test keyManager) to unwrap the hub key envelope
  - Returns raw hub key bytes for use in decryption assertions
  - Uses `window.__llamenos_test_crypto` (from e2ee test plan) to unwrap

### 1.4 Event decryption helper
- [x] Add `decryptRelayEvent(event, hubKey)` helper:
  - Takes a raw Nostr event with encrypted `content` field
  - Calls `decryptHubEvent(event.content, hubKey)` from `src/worker/lib/hub-event-crypto.ts`
  - Returns parsed event data
  - Import decrypt function via test page context or direct Node.js import

---

## Phase 2: Event Publishing Tests

- [x] Create `tests/nostr-relay.spec.ts`
- [x] Add `test.skip(!await isNostrRelayAvailable(), 'Nostr relay not available')` at top

### Test 2.1: Server publishes event on inbound call
```
Given: Volunteer logged in, relay subscription active
Given: Direct relay subscription for kind 20001 events with tag ["t", "llamenos:event"]
When: Simulate inbound call (POST /api/telephony/incoming)
Then: Within 3 seconds, a kind 20001 event appears in relay subscription
Then: Event has tag ["t", "llamenos:event"]
Then: Event content is a non-empty string (encrypted — not plaintext JSON)
```

### Test 2.2: Event content is encrypted
```
Given: A kind 20001 event received from relay (test 2.1)
Then: event.content does NOT contain "ring" or "callSid" as plaintext
Then: event.content is a base64/hex string (XChaCha20 ciphertext)
```

### Test 2.3: Client decrypts event correctly
```
Given: A kind 20001 event received (test 2.1)
When: Decrypt event.content using hub key
Then: Decrypted content contains expected call event type (e.g. "type": "call:ring")
Then: Decrypted content contains the callSid from the simulated call
```

### Test 2.4: Client receives call notification via Nostr
```
Given: Volunteer's dashboard is open (page loaded)
Given: Real-time subscriptions active (Nostr hook connected)
When: Simulate inbound call
Then: Incoming call UI appears on the dashboard within 5 seconds
     (This confirms the full chain: server → relay → client → UI update)
```
- Note: This test combines relay + UI. Use it to verify the end-to-end chain.

### Test 2.5: Answer event cancels ringing on other clients
```
Given: Two volunteer sessions (two browser contexts)
Given: Both see incoming call notification (from test 2.4)
When: Volunteer A answers the call
Then: Volunteer B's incoming call notification disappears within 5 seconds
     (This verifies: server publishes "answered" event → relay distributes → B's client removes ring UI)
```

---

## Phase 3: Message Events Tests

### Test 3.1: New message event published
```
Given: Volunteer subscribed to relay
When: Simulate inbound SMS to POST /api/messaging/sms/inbound
Then: Kind 20001 event appears on relay with conversation type
When: Decrypt event
Then: Contains conversation ID and "message:new" event type
```

### Test 3.2: Assignment event published
```
Given: Admin assigns conversation to Volunteer A
Then: Kind 20001 event appears with "conversation:assigned" type and Volunteer A's pubkey
```

---

## Phase 4: Relay Security Tests

### Test 4.1: Unauthenticated relay client cannot distinguish event types
```
Given: A Nostr client with no hub key
When: Subscribes to relay and receives events
Then: All event content is encrypted ciphertext (cannot determine event type from content)
Then: All events have the same generic tag (["t", "llamenos:event"]) — no semantic info in tags
```

### Test 4.2: Events from different hubs are not cross-decryptable
```
Given: Two hubs (Hub A, Hub B) each with their own hub key
When: Hub A publishes an event
When: Volunteer B (only member of Hub B) attempts to decrypt Hub A's event with Hub B's key
Then: Decryption fails
```

---

## Phase 5: REST Polling Fallback Tests

- [x] Add to `tests/call-flow.spec.ts`:

### Test 5.1: UI updates via REST polling when relay is down
```
Given: NOSTR_RELAY_URL set to an unreachable URL (test-only override)
When: Simulate inbound call
Then: Within 15 seconds, incoming call notification appears
      (Confirms useCalls() REST polling fallback works)
```
- Use Playwright route interception to block WebSocket connections to relay URL

---

## Completion Checklist

- [x] `nostr-tools` websocket subscription helper working in test context
- [x] Hub key extraction working via test crypto helpers
- [x] Test 2.1: Event published to relay on inbound call
- [x] Test 2.2: Event content is ciphertext (not plaintext)
- [x] Test 2.3: Event decrypts to expected call event shape
- [x] Test 2.4: Dashboard UI updates via Nostr (end-to-end)
- [x] Test 2.5: Answer cancels ringing on second session
- [x] Test 4.1: Event tags are generic (no semantic info)
- [x] Test 5.1: REST polling fallback works when relay unreachable
- [x] All relay tests skipped gracefully when relay not running
- [x] `bunx playwright test tests/nostr-relay.spec.ts` passes (with relay running)
