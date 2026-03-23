# Signal Automated Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Automate Signal number registration by intercepting the verification SMS that arrives at the hotline's Twilio number, eliminating the need for manual curl commands during setup.

**Architecture:** When an admin initiates Signal registration from the settings UI, the backend calls the signal-cli-rest-api bridge to start registration and stores a short-lived pending flag in SettingsDO. The inbound SMS webhook (already handling Twilio messages) checks for this flag before normal routing — if it detects a Signal verification SMS pattern, it extracts the code and completes registration automatically. A voice fallback path supports VoIP numbers by presenting a manual code entry field in the UI.

**Tech Stack:** Bun + Hono (backend), PostgreSQL + Drizzle ORM, SettingsDO (in-memory state), TanStack Router + React (frontend), Playwright (E2E tests only).

---

## File Structure

### Create

- `src/worker/messaging/signal/registration.ts` — `isSignalVerificationSMS`, `extractSignalCode`, `completeSignalRegistration` helpers
- `src/worker/api/messaging/signal-registration.ts` — Hono route handlers for `/register`, `/registration-status`, `/verify`
- `tests/signal-auto-registration.spec.ts` — E2E tests (written first — TDD)

### Modify

- `src/shared/types.ts` — add `SignalRegistrationPending` type
- `src/worker/durable-objects/settings-do.ts` — add pending registration state with TTL-aware getter/setter/clear
- `src/worker/messaging/router.ts` — intercept Signal verification SMS before conversation routing
- `src/worker/app.ts` — mount new signal registration routes
- `src/client/components/settings/` — extend Signal settings panel with registration wizard and status polling

---

## Tasks

### Phase 1: Types and Shared Interfaces

- [x] Read `src/shared/types.ts` to understand existing type patterns.
- [x] Add `SignalRegistrationPending` to `src/shared/types.ts`:
  ```typescript
  export interface SignalRegistrationPending {
    number: string
    bridgeUrl: string
    method: 'sms' | 'voice'
    expiresAt: string   // ISO 8601
    status: 'pending' | 'complete' | 'failed'
    error?: string
  }
  ```
- [x] Run `bun run typecheck` — must pass before proceeding.

### Phase 2: SettingsDO Changes

- [x] Read `src/worker/durable-objects/settings-do.ts` in full.
- [x] Add storage key constant `SIGNAL_REGISTRATION_PENDING_KEY = 'signalRegistrationPending'`.
- [x] Implement `getSignalRegistrationPending(): Promise<SignalRegistrationPending | null>`:
  - Read from DO storage.
  - If record exists and `expiresAt` is in the past, delete it and return `null`.
  - Otherwise return the record.
- [x] Implement `setSignalRegistrationPending(pending: SignalRegistrationPending): Promise<void>` — writes to DO storage.
- [x] Implement `clearSignalRegistrationPending(): Promise<void>` — deletes the key from DO storage.
- [x] Expose the three methods via the DO's `DORouter` dispatch (same pattern as existing SettingsDO methods).
- [x] Run `bun run typecheck` — must pass.

### Phase 3: Registration Helper Functions

- [x] Create `src/worker/messaging/signal/registration.ts`.
- [x] Implement `isSignalVerificationSMS(body: string): boolean`:
  - Regex: `/^Your Signal code: \d{6}/`
  - Returns `true` only on match — no side effects.
- [x] Implement `extractSignalCode(body: string): string`:
  - Regex: `/Your Signal code: (\d{6})/`
  - Throws if no match (caller should guard with `isSignalVerificationSMS` first).
- [x] Implement `completeSignalRegistration(pending: SignalRegistrationPending, code: string, settings: SettingsDOClient): Promise<void>`:
  - **SSRF allow-list validation (MUST run before any HTTP call):** Retrieve the live `SignalConfig` from SettingsDO via `settings.getSignalConfig()`. Validate that `pending.bridgeUrl === signalConfig.bridgeUrl` (i.e. the URL in the pending record matches the configured bridge URL). If the configured `signalConfig` is not yet set, fall back to validating against an explicit allow-list stored in settings (e.g. `settings.getAllowedBridgeUrls()`). If validation fails: call `settings.clearSignalRegistrationPending()` and return early with the record left in a cleared state — do NOT proceed to the HTTP call.
  - Only after allow-list validation passes: call `POST /v1/register/{number}/verify/{code}` on `pending.bridgeUrl`.
  - On HTTP 200/201: builds `SignalConfig` from `pending`, persists via `settings.setSignalConfig(...)`, calls `settings.clearSignalRegistrationPending()`.
  - On failure: calls `settings.setSignalRegistrationPending({ ...pending, status: 'failed', error: responseText })`.
  - Never throws — errors are written back to SettingsDO as `status: 'failed'`.
- [x] Run `bun run typecheck` — must pass.

### Phase 4: API Route Handlers

- [x] Read `src/worker/app.ts` and one existing API handler file to understand the Hono routing pattern used in this project.
- [x] Create `src/worker/api/messaging/signal-registration.ts` with three handlers:

  **`POST /api/messaging/signal/register`**
  - Require admin auth (use existing auth middleware pattern).
  - Parse and validate body: `{ bridgeUrl: string, registeredNumber: string, useVoice?: boolean }`.
  - Validate `bridgeUrl` is a well-formed HTTPS URL — return 400 if not.
  - Check `getSignalRegistrationPending()` — return 409 if pending and not expired, or if Signal is already fully configured.
  - **Write `SignalRegistrationPending` to SettingsDO FIRST** (with `status: 'pending'`, `expiresAt = Date.now() + 10 * 60 * 1000`) — before making any bridge call. This prevents a race condition where a fast verification SMS arrives before the pending flag is persisted.
  - Call `POST /v1/register/{registeredNumber}` on the bridge (with `{ use_voice: true }` body if `useVoice`).
  - If bridge returns non-2xx: call `clearSignalRegistrationPending()` to roll back the pending state, then return 502 with the bridge error message.
  - If bridge returns 2xx: return `{ ok: true, method: 'sms' | 'voice' }`.

  **`GET /api/messaging/signal/registration-status`**
  - Require admin auth.
  - Read `getSignalRegistrationPending()` from SettingsDO.
  - If null and Signal is fully configured: return `{ status: 'complete' }`.
  - If null and not configured: return `{ status: 'idle' }`.
  - Otherwise return `{ status: pending.status, method: pending.method, expiresAt: pending.expiresAt, error: pending.error }`.

  **`POST /api/messaging/signal/verify`** (voice path only)
  - Require admin auth.
  - Parse body: `{ code: string }`.
  - Validate code matches `/^\d{6}$/` — return 400 if not.
  - Read `getSignalRegistrationPending()` — return 404 if null or expired.
  - Call `completeSignalRegistration(pending, code, settings)`.
  - Re-read pending state: if `status === 'complete'` return `{ ok: true }`, else return 400 with `error`.

- [x] Mount the new routes in `src/worker/app.ts` under `/api/messaging/signal` alongside existing messaging routes.
- [x] Run `bun run typecheck` — must pass.

### Phase 5: SMS Webhook Interception

- [x] Read `src/worker/messaging/router.ts` (or wherever Twilio SMS webhook is handled) in full.
- [x] Locate the entry point where the SMS body is first available and before any conversation routing logic.
- [x] Add interception block:
  ```typescript
  import { isSignalVerificationSMS, extractSignalCode, completeSignalRegistration } from '../messaging/signal/registration'

  const pending = await settings.getSignalRegistrationPending()
  if (pending && pending.method === 'sms' && isSignalVerificationSMS(smsBody)) {
    const code = extractSignalCode(smsBody)
    await completeSignalRegistration(pending, code, settings)
    // Return empty TwiML — do not route as a conversation
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
      'Content-Type': 'text/xml',
    })
  }
  ```
- [x] Confirm the interception runs before any existing logging or routing that would create a conversation record.
- [x] Run `bun run typecheck` — must pass.

### Phase 6: Frontend — Registration Wizard

- [x] Read the existing Signal settings component(s) in `src/client/components/settings/` to understand current UI structure.
- [x] Extend the Signal channel settings panel to add a registration wizard section. It should only appear when Signal is not yet configured (or after a failed attempt):
  - Form fields: Bridge URL (text input), Registered Number (text input), "Use voice verification" checkbox.
  - "Register Signal" submit button — calls `POST /api/messaging/signal/register`.
  - On `method: 'sms'` response: show "Waiting for verification SMS…" with countdown (expires in 10 minutes) and a spinner. Poll `GET /api/messaging/signal/registration-status` every 3 seconds.
  - On `method: 'voice'` response: show a 6-digit code input field, countdown timer, and "Submit Code" button. On submit, call `POST /api/messaging/signal/verify`.
  - On `status: 'complete'` from polling: dismiss wizard, show "Signal connected" success state.
  - On `status: 'failed'` from polling: show error message and "Try Again" button that resets the form.
  - On 409 from register endpoint: show "Registration already in progress — wait for it to expire or refresh the page."
- [x] After successful registration (when polling returns `status: 'complete'`), render the following two security disclosures in the `SignalRegistrationFlow` or `StepProviderSignal` component. Both strings must be wrapped in `t(...)` with i18n keys:
  1. A channel-level security label: `t('signal.security.transportLabel')` → English value: `"Transport: Signal (E2EE to bridge, strongest available)"`
  2. An infrastructure disclosure notice: `t('signal.security.bridgeDecryptionNotice')` → English value: `"Signal provides strong transport encryption. Messages are decrypted at our self-hosted bridge server (within your infrastructure) for processing, then re-encrypted for storage. The bridge requires ongoing maintenance as Signal updates its protocol."`
  Add both keys to `src/client/locales/en.json`. Copy English values to all other locale files in `src/client/locales/` as placeholders (do not block on translations, but all locale files must have the keys to avoid missing-key warnings).
- [x] All other user-facing strings must use the i18n system (`t(...)` calls with translation keys). Add the English keys to `src/client/locales/en.json` (other locales can be left as copies of English for now — do not block on translations).
- [x] Run `bun run typecheck` — must pass.
- [x] Run `bun run build` — must pass.

### Phase 7: E2E Tests (Write First, Then Verify)

Write the test file before running — fix any issues until all tests pass.

- [x] Create `tests/signal-auto-registration.spec.ts`.

  **Test: SMS auto-registration completes automatically**
  - Mock `POST /v1/register/{number}` on bridge → 200 OK.
  - Mock `POST /v1/register/{number}/verify/{code}` on bridge → 200 OK.
  - Admin navigates to Signal settings, fills in bridge URL + number, submits.
  - Assert registration-status endpoint returns `{ status: 'pending', method: 'sms' }`.
  - Simulate inbound SMS to `/api/messaging/sms/webhook` with body `"Your Signal code: 123456 Do not share this code."`.
  - Assert bridge verify endpoint was called with `code = '123456'`.
  - Assert registration-status endpoint returns `{ status: 'complete' }`.
  - Assert UI shows "Signal connected" state.

  **Test: Voice registration — manual code entry**
  - Mock bridge register endpoint → 200 OK.
  - Mock bridge verify endpoint → 200 OK.
  - Admin checks "Use voice verification", submits form.
  - Assert UI shows code entry field and countdown timer.
  - Admin enters `"654321"` and clicks Submit.
  - Assert bridge verify endpoint was called with `code = '654321'`.
  - Assert registration-status returns `{ status: 'complete' }`.
  - Assert UI shows "Signal connected" state.

  **Test: Non-Signal SMS during pending window is routed normally**
  - Set `signalRegistrationPending` in SettingsDO (directly via API or test helper).
  - POST a normal SMS body to `/api/messaging/sms/webhook`.
  - Assert bridge verify endpoint was NOT called.
  - Assert the SMS was routed to the conversation handler (check conversation created in DB or response TwiML).

  **Test: Pending registration TTL expires — next attempt succeeds**
  - Set a `signalRegistrationPending` record with `expiresAt` in the past.
  - Call `POST /api/messaging/signal/register` — assert 200 OK (not 409).

  **Test: Duplicate registration attempt returns 409**
  - Successfully initiate registration (pending state created).
  - Call `POST /api/messaging/signal/register` again before expiry — assert 409.

  **Test: Bridge returns error — registration fails gracefully**
  - Mock bridge register endpoint → 503.
  - Call `POST /api/messaging/signal/register` — assert 502 returned to client.
  - Assert no pending state written to SettingsDO.

  **Test: Invalid bridge URL rejected**
  - Call `POST /api/messaging/signal/register` with `bridgeUrl: "not-a-url"` — assert 400.

  **Test: Manual verify with expired pending state returns 404**
  - Set expired pending state in SettingsDO.
  - Call `POST /api/messaging/signal/verify` with a valid code — assert 404.

- [x] Run `bunx playwright test tests/signal-auto-registration.spec.ts` — fix until all tests pass.

### Phase 8: Final Checks

- [x] Run `bun run typecheck` — zero errors.
- [x] Run `bun run build` — zero errors.
- [x] Run `bun run lint` — zero warnings/errors (or run `bun run lint:fix` and re-check).
- [x] Run `bunx playwright test` (full suite) — no regressions in existing tests.
- [x] Review `src/worker/messaging/router.ts` diff to confirm the interception block cannot accidentally swallow legitimate inbound SMS (e.g., when `signalRegistrationPending` is null, the guard short-circuits immediately).
- [x] Confirm `SignalRegistrationPending` in `src/shared/types.ts` is the single source of truth — no inline interface definitions duplicated in handler files.
- [x] Confirm no raw string literals used for crypto contexts (not directly applicable here, but verify no new crypto operations were introduced outside `crypto-labels.ts`).
