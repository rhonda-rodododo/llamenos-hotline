# Call Flow & Parallel Ringing Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add E2E tests covering the complete call lifecycle: inbound call routing, volunteer notification, call answering, active call UI, parallel ringing + first-pickup cancellation, and call completion with notes.

**Current state:** Only 20% covered (IVR language selection in live tests, call history rendering). The core volunteer experience of receiving and answering a call has zero automated test coverage.

**Approach:** Use the mock telephony adapter (HTTP webhook injection) — no real phone number needed. Post webhook payloads directly to `/api/telephony/*` routes using Playwright's `request` API.

---

## Phase 1: Test Infrastructure for Mock Calls

### 1.1 Mock telephony webhook helper
- [ ] Add `simulateInboundCall(request, options)` to `tests/helpers.ts`:
  ```typescript
  interface MockCallOptions {
    callSid: string
    from: string   // caller phone (e.g. "+15555550001")
    to: string     // hotline number (from config)
    provider?: 'twilio' | 'vonage' | 'plivo' | 'asterisk'
  }
  async function simulateInboundCall(request: APIRequestContext, options: MockCallOptions): Promise<void>
  ```
  - Posts a provider-appropriate webhook payload to `POST /api/telephony/incoming`
  - For Twilio format: `{ CallSid, From, To, CallStatus: "ringing", Direction: "inbound" }`
  - Must bypass webhook signature validation in test mode (see 1.2)

- [ ] Add `simulateCallAnswered(request, callSid, answeredByPhone)` to `tests/helpers.ts`
  - Posts `POST /api/telephony/answer` webhook with `{ CallSid, To: answeredByPhone, CallStatus: "in-progress" }`

- [ ] Add `simulateCallHungUp(request, callSid)` to `tests/helpers.ts`
  - Posts `POST /api/telephony/hangup` webhook with `{ CallSid, CallStatus: "completed" }`

- [ ] Add `simulateVoicemail(request, callSid, recordingUrl)` to `tests/helpers.ts`
  - Posts `POST /api/telephony/voicemail` webhook with recording data

### 1.2 Test-mode webhook signature bypass
- [ ] In telephony route handlers, when `ENVIRONMENT === 'test'` or `'demo'`, skip webhook signature validation
  - Check that `validateWebhook()` is already bypassed for test env (it may be — check `src/worker/routes/telephony.ts`)
  - If not: add `if (env.ENVIRONMENT === 'test') { return; }` before signature check
  - This is the same pattern used by `POST /api/test-reset`

### 1.3 Call state polling helper
- [ ] Add `waitForCallState(page, callSid, state, timeout)` to `tests/helpers.ts`
  - Polls `GET /api/calls/active` until the call with `callSid` appears in `state`
  - Uses Playwright `waitForFunction` with timeout

---

## Phase 2: Core Call Lifecycle Tests

- [ ] Create `tests/call-flow.spec.ts`

### Test 2.1: Inbound call appears in dashboard
```
Given: Volunteer is logged in, on shift
When: Simulate inbound call (callSid="test-call-001", from="+15555550001")
Then: Dashboard shows incoming call notification within 5 seconds
Then: Call displays caller ID (anonymised), hub name, duration counter
```
- [ ] Implement: `simulateInboundCall()` → `page.waitForSelector('[data-testid="incoming-call"]')`

### Test 2.2: Volunteer answers a call
```
Given: Inbound call ringing
When: Volunteer clicks "Answer" button
Then: POST /api/calls/:callSid/answer called
Then: Call state changes to "active"
Then: Active call UI shows: end call button, mute button, note button
Then: Call timer starts counting up
```

### Test 2.3: Active call — write a note
```
Given: Volunteer is in an active call (callSid="test-call-002")
When: Volunteer clicks "New note" during the call
Then: Note form opens, call ID is pre-filled
When: Volunteer enters note body "Caller distressed, needs referral"
When: Volunteer clicks Save
Then: Note appears in notes list for this call
Then: Note shows "encrypted end-to-end"
```

### Test 2.4: Call ends, note remains
```
Given: Volunteer just wrote a note during a call
When: Call ends (simulateCallHungUp)
Then: Call moves from active to call history
Then: Note remains in /notes, associated with the completed call
Then: Note is decryptable by the volunteer
```

### Test 2.5: Volunteer ends call manually
```
Given: Active call
When: Volunteer clicks "End call"
Then: POST /api/calls/:callSid/hangup called
Then: Call removed from active calls list
Then: Call appears in call history with duration
```

### Test 2.6: Voicemail when no volunteers answer
```
Given: No volunteers on shift (or all busy)
When: Simulate inbound call
Then: After ring timeout, voicemail route triggered
When: simulateVoicemail(request, callSid, "https://test-recording-url")
Then: Call history shows voicemail badge for this call
Then: Admin can see the voicemail entry
```

---

## Phase 3: Parallel Ringing Tests

- [ ] Create `tests/parallel-ringing.spec.ts`

### Test 3.1: Multiple volunteers ring simultaneously
```
Given: Two volunteers (Volunteer A, Volunteer B) both on shift
When: Simulate inbound call
Then: Both Volunteer A's dashboard AND Volunteer B's dashboard show incoming call
      (Use two separate Playwright page contexts for two simultaneous sessions)
```
- [ ] Implement using Playwright's `browser.newContext()` for second volunteer session

### Test 3.2: First answer cancels other ringing
```
Given: Two volunteers seeing incoming call (test 3.1 setup)
When: Volunteer A clicks Answer
Then: Volunteer A's UI shows active call
Then: Volunteer B's incoming call notification disappears within 5 seconds
Then: GET /api/calls/active shows call answered by Volunteer A (not B)
```

### Test 3.3: Ring group respects shift assignment
```
Given: Volunteer A on shift, Volunteer B NOT on shift
When: Simulate inbound call
Then: Volunteer A's dashboard shows incoming call
Then: Volunteer B's dashboard does NOT show incoming call
```
- [ ] May require checking that /api/shifts or similar respects current time — use test shift with wide time window or mock time

### Test 3.4: Fallback group when no one on shift
```
Given: No volunteers on any regular shift
Given: A fallback ring group is configured with Volunteer C
When: Simulate inbound call
Then: Volunteer C's dashboard shows incoming call
```

---

<!-- Ban and rate-limit tests are in spam-mitigation-tests-plan.md — do not duplicate here. -->

## Phase 4: Call Recording Tests

- [ ] Add to `tests/call-recording.spec.ts` or new `tests/call-recording-flow.spec.ts`

### Test 5.1: Recording attached to call
```
Given: A completed call in history
When: simulateVoicemail with recording URL and duration
Then: Call history shows recording indicator
Then: Recording player component renders in notes view for this call
```

### Test 5.2: Recording download requires permission
```
Given: A completed call with recording
When: Volunteer (non-admin) attempts to download recording
Then: Access granted (volunteer answered this call)
When: Different volunteer (did not answer) attempts to access
Then: Access denied (403)
```

---

## Completion Checklist

- [ ] `simulateInboundCall()` helper works against test server
- [ ] Webhook signature bypass active in test mode
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] Test 2.1: Inbound call notification visible within 5 seconds
- [ ] Test 2.2: Answer call → active call UI with controls
- [ ] Test 2.3: Note created during active call
- [ ] Test 2.4: Note persists after call ends
- [ ] Test 3.1: Two simultaneous volunteer sessions both see incoming call
- [ ] Test 3.2: First answer cancels ringing for the other volunteer
- [ ] `bunx playwright test tests/call-flow.spec.ts` passes
- [ ] `bunx playwright test tests/parallel-ringing.spec.ts` passes
