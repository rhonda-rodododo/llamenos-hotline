# Spam Mitigation Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add E2E tests for all spam mitigation features: ban list enforcement, rate limiting, and voice CAPTCHA. Some tests overlap with `call-flow-tests-plan.md` — coordinate to avoid duplication.

**Note:** This plan covers ban list enforcement, rate limiting, and voice CAPTCHA tests, plus integration of all three in a combined spam scenario. CAPTCHA test cases are included here — do not create a separate voice-captcha-plan.md for them.

---

## Phase 1: Ban List Enforcement Tests

`tests/ban-management.spec.ts` already has CRUD tests. This plan adds **enforcement** tests.

- [ ] Add to `tests/ban-management.spec.ts` or create `tests/call-spam.spec.ts`:

### Test 1.1: Call from banned number is rejected at the telephony route
```
Given: Admin adds "+15555559999" to ban list
When: POST /api/telephony/incoming with From="+15555559999"
Then: Response contains reject TwiML/NCCO/PXML (e.g., <Response><Reject/></Response> for Twilio)
Then: No call entry created in active calls
Then: Audit log entry created: event="callRejected", reason="banned"
```
- [ ] Use `request.post('/api/telephony/incoming', { data: mockTwilioInboundPayload('+15555559999') })`
- [ ] Verify response body contains rejection marker

### Test 1.2: Call from non-banned number is NOT rejected
```
Given: "+15555559999" is banned, "+15555550001" is not banned
When: POST /api/telephony/incoming with From="+15555550001"
Then: Response is NOT a rejection (contains enqueue/ring response)
```

### Test 1.3: Ban list is checked in real-time (not cached)
```
Given: A number is NOT banned
When: Simulate call → call routes normally
When: Admin adds number to ban list (POST /api/bans)
When: Simulate another call from same number immediately
Then: Second call is rejected (ban list checked on every call, no stale cache)
```

### Test 1.4: Bulk import bans + enforcement
```
Given: Admin uses bulk import to add 3 numbers including "+15555558888"
When: Simulate call from "+15555558888"
Then: Call rejected
```

---

## Phase 2: Rate Limiting Tests

- [ ] Add rate limiting tests to `tests/call-spam.spec.ts`:

### Test 2.1: Rate limit enforced after threshold
```
Setup: Set rate limit to 3 calls/minute in admin spam settings
Given: Simulate 3 calls from "+15555556666" within 10 seconds
Then: All 3 calls are routed (not rejected)
When: Simulate 4th call from "+15555556666" within same minute
Then: 4th call rejected with rate-limit response
```
- [ ] May need `PUT /api/settings/spam { rateLimitPerMinute: 3 }` before test
- [ ] May need test-mode rate limit override (smaller time window)

### Test 2.2: Rate limit resets after window
```
Given: Rate limit hit for "+15555556666"
When: Wait for rate limit window to expire (mock time or short window in test)
When: Simulate new call from "+15555556666"
Then: Call accepted (rate counter reset)
```
- [ ] For test feasibility: set rate limit to very short window (1 second) in test setup, or mock time

### Test 2.3: Rate limit is per-caller (not global)
```
Given: Rate limit hit for "+15555556666"
When: Simulate call from "+15555550001" (different number)
Then: Call from "+15555550001" is NOT rate-limited
```

### Test 2.4: Rate limit setting changes take immediate effect
```
Given: Rate limit = 10 (high, effectively unlimited)
When: Admin changes rate limit to 1 call/minute
When: Simulate 2 calls from same number
Then: Second call rejected
```

---

## Phase 3: Voice CAPTCHA Tests

- [ ] Add CAPTCHA tests to `tests/call-spam.spec.ts`:

### Test 3.1: CAPTCHA toggled on — next call requires digit input
```
Given: Admin enables CAPTCHA in spam settings (PUT /api/settings/spam { captchaEnabled: true })
When: Simulate inbound call
Then: Response contains CAPTCHA prompt TwiML/NCCO (plays digit challenge, awaits input)
Then: Call does NOT route to volunteers until correct digits entered
```

### Test 3.2: Wrong digits — call rejected
```
Given: CAPTCHA is enabled, caller receives digit challenge
When: Simulate digit input response with wrong digits
Then: Call rejected (no routing to volunteers)
Then: Audit log records captcha-failed rejection event
```

### Test 3.3: Correct digits — call routes normally
```
Given: CAPTCHA is enabled, caller receives digit challenge
When: Simulate digit input response with correct digits
Then: Call routes to on-shift volunteers as normal
Then: Active call appears in volunteer dashboard
```

### Test 3.4: CAPTCHA toggled off — calls route without challenge
```
Given: Admin disables CAPTCHA (PUT /api/settings/spam { captchaEnabled: false })
When: Simulate inbound call
Then: Call routes directly to volunteers (no digit prompt)
```

---

## Phase 4: Combined Spam Scenario Tests

### Test 4.1: Priority order (ban > rate limit > CAPTCHA)
```
Given: Number "+15555559999" is BOTH banned AND over rate limit AND CAPTCHA is enabled
When: Simulate call from "+15555559999"
Then: Call rejected immediately (ban check first, before rate limit or CAPTCHA)
```

### Test 4.2: Rate limit + CAPTCHA interaction
```
Given: CAPTCHA enabled, rate limit = 5/min
When: Caller fails CAPTCHA twice → rejected
When: Same caller calls again (below rate limit)
Then: New CAPTCHA challenge presented (not rate-limited by failed CAPTCHA attempts)
```

### Test 4.3: Admin view of spam events in audit log
```
Given: A call was rejected due to ban, another due to rate limit
When: Admin views audit log
Then: Both rejections appear with appropriate event types and reasons
```

---

## Phase 5: Admin Spam Settings UI Tests

- [ ] Add to existing `tests/admin-flow.spec.ts` or spam-specific test:

### Test 5.1: Admin can toggle ban list on/off
```
Given: Ban list is enabled (default)
When: Admin disables ban list check in settings
Then: PUT /api/settings/spam called with banListEnabled=false
Then: Call from banned number is NO LONGER rejected
When: Admin re-enables
Then: Banned calls rejected again
```

### Test 5.2: Admin can set rate limit value
```
Given: Spam settings page loaded
When: Admin changes rate limit slider to 5
When: Saves settings
Then: PUT /api/settings/spam called with rateLimitPerMinute=5
Then: Value persists after page reload
```

### Test 5.3: Admin can toggle CAPTCHA on/off
```
Given: CAPTCHA is disabled (default)
When: Admin enables CAPTCHA in spam settings
Then: PUT /api/settings/spam called with captchaEnabled=true
Then: Next inbound call receives digit challenge
When: Admin disables CAPTCHA
Then: Calls route directly (no challenge)
```

---

## Completion Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] Ban list enforcement: banned number rejected on telephony webhook
- [ ] Ban list enforcement: non-banned number not rejected
- [ ] Real-time ban: new ban enforced on next call (no caching)
- [ ] Rate limit: exceeding threshold rejects calls
- [ ] Rate limit: different callers have independent counters
- [ ] CAPTCHA: enabled → next call receives digit challenge
- [ ] CAPTCHA: wrong digits → call rejected
- [ ] CAPTCHA: correct digits → call routes normally
- [ ] CAPTCHA: disabled → calls route without challenge
- [ ] Combined scenario: ban takes priority over rate limit and CAPTCHA
- [ ] Admin settings: ban list toggle, rate limit change, and CAPTCHA toggle tested
- [ ] Audit log: rejection events logged with reason
- [ ] `bunx playwright test tests/call-spam.spec.ts` passes
