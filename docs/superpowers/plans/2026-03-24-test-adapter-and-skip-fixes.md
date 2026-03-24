# TestAdapter & Skip Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable 26 telephony-dependent UI tests and 7 conditionally-skipping UI tests to run without a real telephony provider, by implementing a TestAdapter and fixing state setup.

**Architecture:** Create a `TestAdapter` class that implements `TelephonyAdapter` with Twilio-compatible TwiML responses and form-body parsing. Register it as a fallback in `getTelephony()` when `USE_TEST_ADAPTER=true`. Update test files to remove skip conditions. Fix state setup for conditional skips.

**Tech Stack:** Bun, Hono, TwiML XML, Playwright

**Spec:** `docs/superpowers/specs/2026-03-24-ui-test-parallel-isolation-design.md`

---

### Task 1: Create TestAdapter

**Files:**
- Create: `src/server/telephony/test.ts`

- [ ] **Step 1: Write a unit test for TestAdapter**

Create `src/server/telephony/test-adapter.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { TestAdapter } from './test'

describe('TestAdapter', () => {
  const adapter = new TestAdapter()

  test('handleLanguageMenu returns valid TwiML with Gather', async () => {
    const res = await adapter.handleLanguageMenu({
      callSid: 'CA_test_123',
      callerNumber: '+15551234567',
      hotlineName: 'Test Hotline',
      enabledLanguages: ['en', 'es'],
    })
    expect(res.contentType).toBe('text/xml')
    expect(res.body).toContain('<Response>')
    expect(res.body).toContain('<Gather')
    expect(res.body).toContain('numDigits="1"')
  })

  test('handleIncomingCall returns Enqueue when not rate-limited', async () => {
    const res = await adapter.handleIncomingCall({
      callSid: 'CA_test_123',
      callerNumber: '+15551234567',
      voiceCaptchaEnabled: false,
      rateLimited: false,
      callerLanguage: 'en',
      hotlineName: 'Test Hotline',
    })
    expect(res.body).toContain('<Enqueue')
  })

  test('handleIncomingCall returns Reject when rate-limited', async () => {
    const res = await adapter.handleIncomingCall({
      callSid: 'CA_test_123',
      callerNumber: '+15551234567',
      voiceCaptchaEnabled: false,
      rateLimited: true,
      callerLanguage: 'en',
      hotlineName: 'Test Hotline',
    })
    expect(res.body).toContain('<Reject')
  })

  test('handleIncomingCall returns Gather when CAPTCHA enabled', async () => {
    const res = await adapter.handleIncomingCall({
      callSid: 'CA_test_123',
      callerNumber: '+15551234567',
      voiceCaptchaEnabled: true,
      rateLimited: false,
      callerLanguage: 'en',
      hotlineName: 'Test Hotline',
      captchaDigits: '1234',
    })
    expect(res.body).toContain('<Gather')
    expect(res.body).toContain('captcha')
  })

  test('rejectCall returns Reject TwiML', () => {
    const res = adapter.rejectCall()
    expect(res.body).toContain('<Reject')
  })

  test('emptyResponse returns empty TwiML', () => {
    const res = adapter.emptyResponse()
    expect(res.body).toContain('<Response/>')
  })

  test('validateWebhook always returns true', async () => {
    const req = new Request('http://localhost/telephony/incoming', { method: 'POST' })
    expect(await adapter.validateWebhook(req)).toBe(true)
  })

  test('parseIncomingWebhook extracts form fields', async () => {
    const body = new URLSearchParams({ CallSid: 'CA_abc', From: '+15551111111', To: '+15552222222' })
    const req = new Request('http://localhost/telephony/incoming', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const result = await adapter.parseIncomingWebhook(req)
    expect(result.callSid).toBe('CA_abc')
    expect(result.callerNumber).toBe('+15551111111')
    expect(result.calledNumber).toBe('+15552222222')
  })

  test('testConnection returns connected', async () => {
    const result = await adapter.testConnection()
    expect(result.connected).toBe(true)
  })

  test('ringVolunteers returns empty array (no real calls)', async () => {
    const sids = await adapter.ringVolunteers({
      callSid: 'CA_test',
      callerNumber: '+15551111111',
      volunteers: [{ pubkey: 'pk1', phone: '+15553333333' }],
      callbackUrl: 'http://localhost:3000',
    })
    expect(sids).toEqual([])
  })
})
```

- [ ] **Step 2: Run unit test to verify it fails**

```bash
bun test src/server/telephony/test-adapter.test.ts
```

Expected: FAIL — `./test` module not found.

- [ ] **Step 3: Implement TestAdapter**

Create `src/server/telephony/test.ts`:

```typescript
import type { ConnectionTestResult } from '@shared/types'
import type {
  AudioUrlMap,
  CallAnsweredParams,
  CaptchaResponseParams,
  IncomingCallParams,
  LanguageMenuParams,
  RingVolunteersParams,
  TelephonyAdapter,
  TelephonyResponse,
  VoicemailParams,
  WebhookCallInfo,
  WebhookCallStatus,
  WebhookDigits,
  WebhookQueueResult,
  WebhookQueueWait,
  WebhookRecordingStatus,
} from './adapter'

/**
 * TestAdapter — a telephony adapter for E2E testing.
 * Returns valid TwiML responses without making real API calls.
 * Parses Twilio-format form-encoded webhook bodies.
 */
export class TestAdapter implements TelephonyAdapter {
  private twiml(xml: string): TelephonyResponse {
    return { contentType: 'text/xml', body: xml.trim() }
  }

  // --- TwiML Response Methods ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `?hub=${encodeURIComponent(params.hubId)}` : ''
    const langOptions = (params.enabledLanguages ?? ['en'])
      .map((lang, i) => `<Say>For ${lang}, press ${i + 1}</Say>`)
      .join('\n      ')
    return this.twiml(`
      <Response>
        <Gather numDigits="1" action="/api/telephony/language-selected${hp}" method="POST" timeout="8">
          ${langOptions}
        </Gather>
        <Redirect method="POST">/api/telephony/language-selected?auto=1${hp ? `&amp;${hp.slice(1)}` : ''}</Redirect>
      </Response>
    `)
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const lang = params.callerLanguage || 'en'
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''

    if (params.rateLimited) {
      return this.rejectCall()
    }

    if (params.voiceCaptchaEnabled && params.captchaDigits) {
      return this.twiml(`
        <Response>
          <Gather numDigits="${params.captchaDigits.length}" action="/api/telephony/captcha?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST" timeout="10">
            <Say>Please enter the digits: ${params.captchaDigits.split('').join(', ')}</Say>
          </Gather>
          <Hangup/>
        </Response>
      `)
    }

    return this.twiml(`
      <Response>
        <Say>Welcome to ${params.hotlineName}.</Say>
        <Enqueue waitUrl="/api/telephony/wait-music?lang=${lang}${hp}" action="/api/telephony/queue-exit?callSid=${params.callSid}&amp;lang=${lang}${hp}" method="POST">${params.callSid}</Enqueue>
      </Response>
    `)
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''
    if (params.digits === params.expectedDigits) {
      return this.twiml(`
        <Response>
          <Enqueue waitUrl="/api/telephony/wait-music?lang=${params.callerLanguage}${hp}" method="POST">${params.callSid}</Enqueue>
        </Response>
      `)
    }
    return this.twiml('<Response><Hangup/></Response>')
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''
    return this.twiml(`
      <Response>
        <Dial record="record-from-answer" recordingStatusCallback="${params.callbackUrl}/api/telephony/call-recording?parentCallSid=${params.parentCallSid}&amp;pubkey=${params.volunteerPubkey}${hp}" recordingStatusCallbackEvent="completed">
          <Queue>${params.parentCallSid}</Queue>
        </Dial>
      </Response>
    `)
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const hp = params.hubId ? `&amp;hub=${encodeURIComponent(params.hubId)}` : ''
    return this.twiml(`
      <Response>
        <Say>Please leave a message after the beep.</Say>
        <Record maxLength="${params.maxRecordingSeconds ?? 120}" action="/api/telephony/voicemail-complete?callSid=${params.callSid}&amp;lang=${params.callerLanguage}${hp}" recordingStatusCallback="${params.callbackUrl}/api/telephony/voicemail-recording?callSid=${params.callSid}${hp}" recordingStatusCallbackEvent="completed" />
        <Hangup/>
      </Response>
    `)
  }

  async handleWaitMusic(
    lang: string,
    _audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number,
  ): Promise<TelephonyResponse> {
    if (queueTime && queueTimeout && queueTime >= queueTimeout) {
      return this.twiml('<Response><Leave/></Response>')
    }
    return this.twiml(`
      <Response>
        <Say>Please hold. A volunteer will be with you shortly.</Say>
        <Pause length="10"/>
      </Response>
    `)
  }

  handleVoicemailComplete(lang: string): TelephonyResponse {
    return this.twiml(`
      <Response>
        <Say>Thank you for your message. Goodbye.</Say>
        <Hangup/>
      </Response>
    `)
  }

  rejectCall(): TelephonyResponse {
    return this.twiml('<Response><Reject reason="rejected"/></Response>')
  }

  emptyResponse(): TelephonyResponse {
    return this.twiml('<Response/>')
  }

  // --- Call Control (no-ops for test) ---

  async hangupCall(_callSid: string): Promise<void> { /* no-op */ }
  async ringVolunteers(_params: RingVolunteersParams): Promise<string[]> { return [] }
  async cancelRinging(_callSids: string[], _exceptSid?: string): Promise<void> { /* no-op */ }

  // --- Webhook Validation (always passes) ---

  async validateWebhook(_request: Request): Promise<boolean> { return true }

  // --- Recording (not available in test) ---

  async getCallRecording(_callSid: string): Promise<ArrayBuffer | null> { return null }
  async getRecordingAudio(_recordingSid: string): Promise<ArrayBuffer | null> { return null }

  // --- Webhook Parsing (Twilio form-body format) ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const form = await request.clone().formData()
    return {
      callSid: form.get('CallSid') as string,
      callerNumber: form.get('From') as string,
      calledNumber: (form.get('To') as string) || undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const form = await request.clone().formData()
    return {
      callSid: form.get('CallSid') as string,
      callerNumber: form.get('From') as string,
      digits: (form.get('Digits') as string) || '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const form = await request.clone().formData()
    return {
      digits: (form.get('Digits') as string) || '',
      callerNumber: (form.get('From') as string) || '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const form = await request.clone().formData()
    const raw = form.get('CallStatus') as string
    const STATUS_MAP: Record<string, WebhookCallStatus['status']> = {
      initiated: 'initiated', ringing: 'ringing', 'in-progress': 'answered',
      completed: 'completed', busy: 'busy', 'no-answer': 'no-answer',
      failed: 'failed', canceled: 'failed',
    }
    return { status: STATUS_MAP[raw] ?? 'failed' }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const form = await request.clone().formData()
    return { queueTime: Number.parseInt((form.get('QueueTime') as string) || '0', 10) }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const form = await request.clone().formData()
    const raw = form.get('QueueResult') as string
    const RESULT_MAP: Record<string, WebhookQueueResult['result']> = {
      leave: 'leave', 'queue-full': 'queue-full', error: 'error', bridged: 'bridged', hangup: 'hangup',
    }
    return { result: RESULT_MAP[raw] ?? 'error' }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const form = await request.clone().formData()
    const raw = form.get('RecordingStatus') as string
    return {
      status: raw === 'completed' ? 'completed' : 'failed',
      recordingSid: (form.get('RecordingSid') as string) || undefined,
      callSid: (form.get('CallSid') as string) || undefined,
    }
  }

  // --- Health ---

  async testConnection(): Promise<ConnectionTestResult> {
    return { connected: true, latencyMs: 0 }
  }
}
```

- [ ] **Step 4: Run unit test to verify it passes**

```bash
bun test src/server/telephony/test-adapter.test.ts
```

Expected: All 10 tests pass.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: Pass — TestAdapter implements all 22 interface methods.

- [ ] **Step 6: Commit**

```bash
git add src/server/telephony/test.ts src/server/telephony/test-adapter.test.ts
git commit -m "feat: add TestAdapter for E2E telephony testing"
```

---

### Task 2: Register TestAdapter in getTelephony

**Files:**
- Modify: `src/server/lib/adapters.ts`

- [ ] **Step 1: Read the current file**

Read `src/server/lib/adapters.ts` to find the exact `return null` line at the end of `getTelephony()`.

- [ ] **Step 2: Add TestAdapter fallback before `return null`**

Add this before the final `return null`:

```typescript
// Test adapter fallback — only in dev/test environments
if (Bun.env.USE_TEST_ADAPTER === 'true') {
  const { TestAdapter } = await import('../telephony/test')
  return new TestAdapter()
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/server/lib/adapters.ts
git commit -m "feat: register TestAdapter as fallback in getTelephony"
```

---

### Task 3: Configure Playwright to use TestAdapter

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Add env to webServer config**

Add `env` to the webServer block. Read the current config first, then add:

```typescript
webServer: process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: "bun run build && bun run start",
      url: "http://localhost:3000/api/health/ready",
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        USE_TEST_ADAPTER: 'true',
      },
    },
```

Note: Spread `process.env` to inherit all existing env vars (DATABASE_URL, etc.), then override `USE_TEST_ADAPTER`.

- [ ] **Step 2: Verify config is valid**

```bash
bunx playwright test --list --project=api | head -5
```

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "feat: enable TestAdapter in Playwright webServer env"
```

---

### Task 4: Remove telephony skip conditions from call-flow.spec.ts

**Files:**
- Modify: `tests/ui/call-flow.spec.ts`

- [ ] **Step 1: Read the file and identify all skip conditions**

Look for every `test.skip`, `if (status === 503)`, and `if (status === 404)` pattern.

- [ ] **Step 2: Remove skip conditions**

For each `if (incomingRes.status() === 503) { test.skip(...); return }` block, remove it entirely. The test should now expect 200 because TestAdapter is active.

Also check for `if (incomingRes.status() === 404)` patterns — same treatment.

Also check for `if (hangupRes.status() !== 503)` guard conditions — remove the guard, keep the assertion.

- [ ] **Step 3: Verify the file passes**

```bash
bunx playwright test --project=ui tests/ui/call-flow.spec.ts --reporter=list
```

Expected: All 5 tests pass (no skips).

- [ ] **Step 4: Commit**

```bash
git add tests/ui/call-flow.spec.ts
git commit -m "test: remove telephony skip conditions from call-flow tests"
```

---

### Task 5: Remove telephony skip conditions from call-spam.spec.ts

**Files:**
- Modify: `tests/ui/call-spam.spec.ts`

- [ ] **Step 1: Read and remove all skip conditions**

Same pattern as Task 4 — remove all `if (res.status() === 503) { test.skip() }` blocks.

- [ ] **Step 2: Verify**

```bash
bunx playwright test --project=ui tests/ui/call-spam.spec.ts --reporter=list
```

Expected: All 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/ui/call-spam.spec.ts
git commit -m "test: remove telephony skip conditions from call-spam tests"
```

---

### Task 6: Remove telephony skip conditions from remaining files

**Files:**
- Modify: `tests/ui/voice-captcha.spec.ts`
- Modify: `tests/ui/nostr-relay.spec.ts`
- Modify: `tests/ui/voicemail-webhook.spec.ts`

- [ ] **Step 1: Fix voice-captcha.spec.ts**

Read the file. Remove all skip conditions related to telephony 503/404. These tests call `/api/telephony/language-selected` and `/api/telephony/captcha` — verify these routes use the same `getTelephony()` adapter lookup.

- [ ] **Step 2: Fix nostr-relay.spec.ts**

Read the file. Remove telephony 503 skip conditions. Keep the relay-availability skip (legitimate — relay must be running). Keep the `SERVER_NOSTR_SECRET` skip (legitimate — needs env var).

- [ ] **Step 3: Fix voicemail-webhook.spec.ts**

Read the file. Remove the `if (incomingRes.status() === 503 || incomingRes.status() === 404)` skip block.

- [ ] **Step 4: Verify each file individually**

```bash
bunx playwright test --project=ui tests/ui/voice-captcha.spec.ts --reporter=list
bunx playwright test --project=ui tests/ui/nostr-relay.spec.ts --reporter=list
bunx playwright test --project=ui tests/ui/voicemail-webhook.spec.ts --reporter=list
```

Note: nostr-relay tests may still skip if the relay isn't running. This is expected.

- [ ] **Step 5: Commit**

```bash
git add tests/ui/voice-captcha.spec.ts tests/ui/nostr-relay.spec.ts tests/ui/voicemail-webhook.spec.ts
git commit -m "test: remove telephony skip conditions from voice-captcha, nostr-relay, voicemail"
```

---

### Task 7: Fix conditional skips — pin-challenge.spec.ts

**Files:**
- Modify: `tests/ui/pin-challenge.spec.ts`

- [ ] **Step 1: Read the file and understand the skip condition**

The 3 tests skip when no volunteers with phone numbers exist. The `hasToggle` check looks for a "Show Phone" toggle that only appears when a volunteer has a phone.

- [ ] **Step 2: Create a volunteer with phone in beforeAll**

In `beforeAll`, use the admin API to create a volunteer with a phone number:

```typescript
test.beforeAll(async ({ request }) => {
  await resetTestState(request)
  // Create a volunteer with a phone number for unmasking tests
  const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  await adminApi.post('/api/volunteers', {
    pubkey: pk,
    name: 'Test Volunteer',
    phone: '+15559876543',
    roles: ['volunteer'],
  })
})
```

Remove the skip conditions — the volunteer should now always exist.

- [ ] **Step 3: Verify**

```bash
bunx playwright test --project=ui tests/ui/pin-challenge.spec.ts --reporter=list
```

- [ ] **Step 4: Commit**

```bash
git add tests/ui/pin-challenge.spec.ts
git commit -m "test: fix pin-challenge skips by creating volunteer with phone in setup"
```

---

### Task 8: Fix conditional skips — help.spec.ts and conversations.spec.ts

**Files:**
- Modify: `tests/ui/help.spec.ts`
- Modify: `tests/ui/conversations.spec.ts`

- [ ] **Step 1: Fix help.spec.ts**

Read the file. The 2 tests skip when "Getting Started" checklist is invisible (all items completed). After `resetTestState`, the app should be in fresh state with incomplete setup. If the checklist still hides:
- Check what determines completion (is it server-side or localStorage?)
- Ensure `resetTestState` resets the relevant flags
- If the skip is based on server state that `resetTestState` already clears, remove the skip and expect the checklist to always be visible after reset

- [ ] **Step 2: Fix conversations.spec.ts**

Read the file. The 2 tests skip when messaging channels are enabled. After `resetTestState`, messaging should be unconfigured. If it persists:
- Check if `resetTestState` clears messaging config
- If so, remove the skip — it should always pass after reset
- If not, the skip is legitimate (depends on other tests not having run)

- [ ] **Step 3: Verify**

```bash
bunx playwright test --project=ui tests/ui/help.spec.ts --reporter=list
bunx playwright test --project=ui tests/ui/conversations.spec.ts --reporter=list
```

- [ ] **Step 4: Commit**

```bash
git add tests/ui/help.spec.ts tests/ui/conversations.spec.ts
git commit -m "test: fix conditional skips in help and conversations tests"
```

---

### Task 9: Full verification with 3 workers

- [ ] **Step 1: Run all unit tests**

```bash
bun test src/
```

Expected: All pass (including new TestAdapter tests).

- [ ] **Step 2: Run UI tests with 3 workers**

```bash
PLAYWRIGHT_WORKERS=3 bunx playwright test --project=ui --reporter=list
```

Expected: ~430+ pass, ≤9 skip (webauthn + screenshots only).

- [ ] **Step 3: Run API tests**

```bash
bunx playwright test --project=api --reporter=list
```

Expected: 122+ pass, 1 skip.

- [ ] **Step 4: Typecheck and build**

```bash
bun run typecheck && bun run build
```

Expected: Both pass.

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address verification issues from parallel test run"
```
