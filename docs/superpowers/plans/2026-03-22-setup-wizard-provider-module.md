# Setup Wizard Provider Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the admin setup wizard's provider configuration steps to use automated OAuth flows, webhook auto-configuration, and animated Signal registration instead of manual credential entry and curl commands.

**Architecture:** New React components (`OAuthConnectButton`, `PhoneNumberSelector`, `SignalRegistrationFlow`, `WebhookConfirmation`) wrap the REST endpoints exposed by the ProviderSetup Module (Epic 48) and the Signal registration worker. The wizard step components (`StepProviderVoice`, `StepProviderSignal`) are updated to use these components. The same components are reused on the Settings > Channels page for re-entrant channel management without duplicating logic.

**Tech Stack:** React + TanStack Router (query param state for OAuth callback), shadcn/ui components, Playwright E2E tests. Backend endpoints come from Epic 48 and the signal registration epic — this plan is frontend-only plus the settings re-entrant page.

---

## Dependencies

**This plan MUST NOT be started until the following are implemented:**

- **Epic 48 (Provider OAuth + Auto-Config)** — provides all `/api/setup/provider/:provider/oauth/*`, `/api/setup/provider/:provider/numbers`, and `/api/setup/provider/:provider/configure-webhooks` endpoints
- **Signal Registration Epic** (`docs/superpowers/plans/2026-03-22-signal-automated-registration.md`) — provides `/api/messaging/signal/register`, `/api/messaging/signal/registration-status`, and `/api/messaging/signal/verify` endpoints

Verify both are deployed and the endpoint contracts are stable before proceeding with Tasks 1-8.

---

## File Structure

```
src/client/components/setup/
  OAuthConnectButton.tsx         # new — OAuth redirect + polling, provider logo + status
  PhoneNumberSelector.tsx        # new — number list from provider, selection + provisioning
  SignalRegistrationFlow.tsx     # new — animated state machine, voice fallback, manual entry
  WebhookConfirmation.tsx        # new — read-only webhook URL display post-auto-config
  StepProviderVoice.tsx          # modify — add OAuth path, PhoneNumberSelector, WebhookConfirmation
  StepProviderSignal.tsx         # modify — replace curl block with SignalRegistrationFlow

src/client/components/settings/
  ChannelSettings.tsx            # new — re-entrant channel management page reusing wizard steps

tests/
  setup-wizard-provider.spec.ts  # new — E2E tests for OAuth flows + signal registration in wizard
```

---

## Tasks

### Task 1: OAuthConnectButton component

- [ ] Create `src/client/components/setup/OAuthConnectButton.tsx`
- [ ] Props: `provider: 'twilio' | 'telnyx'`, `onConnected: (provider: string) => void`, `onError: (error: string) => void`
- [ ] On click: call `GET /api/setup/provider/:provider/oauth/start`, navigate to returned `authUrl`
- [ ] On mount: read TanStack Router search params; if `?provider=:provider&status=connected` is present, check that the `provider` query param matches this component's own `provider` prop before calling `onConnected` — do NOT fire if the provider differs (handles the case where multiple `OAuthConnectButton` instances are on the same page, e.g. Twilio + Telnyx cards both rendered):
  ```typescript
  // On mount, check query params
  const searchParams = new URLSearchParams(window.location.search)
  const callbackProvider = searchParams.get('provider')
  const callbackStatus = searchParams.get('status')
  if (callbackStatus === 'connected' && callbackProvider === props.provider) {
    onConnected()
    // Clear query params to prevent re-firing on re-render
  }
  ```
- [ ] Display: provider logo (Twilio wordmark, Telnyx wordmark via shadcn/ui `Avatar` or inline SVG), connection status badge (idle / connecting / connected / error)
- [ ] Error state: display `onError` message inline, offer retry
- [ ] Write Playwright mock test: intercept `GET /api/setup/provider/twilio/oauth/start`, return mock `authUrl`, assert redirect; then navigate back with `?status=connected&provider=twilio`, assert `onConnected` fires
- [ ] Write Playwright mock test: navigate back with `?status=connected&provider=telnyx` while a Twilio `OAuthConnectButton` is mounted — assert `onConnected` does NOT fire (provider mismatch guard)
- [ ] Run `bun run typecheck` — fix any errors

### Task 2: PhoneNumberSelector component

- [ ] Create `src/client/components/setup/PhoneNumberSelector.tsx`
- [ ] Props: `provider: string`, `onSelected: (number: string) => void`, `onWebhooksConfigured: (urls: Record<string, string>) => void`
- [ ] On mount: call `GET /api/setup/provider/:provider/numbers`, display list of phone numbers as radio cards
- [ ] Each card: shows E.164 number, friendly name, country flag emoji, current assignment status
- [ ] "Provision a new number" option: shows country/area code selection fields, then calls `POST /api/setup/provider/:provider/provision-number` (this is a **separate endpoint** from the numbers listing — do NOT call the GET numbers endpoint with `?provision=true`):
  - Body: `{ country: string, areaCode?: string }`
  - This endpoint is defined in Epic 48 — verify it exists before implementing this UI path
- [ ] On number selection: call `POST /api/setup/provider/:provider/configure-webhooks` with selected number, then call `onWebhooksConfigured` with returned URL map
- [ ] Loading state: skeleton cards while fetching numbers
- [ ] Empty state: "No numbers found on this account. Provision a new one."
- [ ] Error state: inline error with retry
- [ ] Write Playwright mock test: intercept numbers endpoint, assert cards render; select a number, assert webhooks endpoint called, assert `onWebhooksConfigured` fired with expected URLs
- [ ] Run `bun run typecheck` — fix any errors

### Task 3: SignalRegistrationFlow component

- [ ] Create `src/client/components/setup/SignalRegistrationFlow.tsx`
- [ ] Internal state machine: `'idle' | 'registering' | 'pending' | 'complete' | 'error'`
- [ ] Props: `bridgeUrl: string`, `apiKey: string`, `phoneNumber: string`, `onComplete: () => void`, `onError: (error: string) => void`
- [ ] "Register Signal Number" button (only enabled when `bridgeUrl`, `apiKey`, and `phoneNumber` are set)
- [ ] On click: `POST /api/messaging/signal/register` → transition to `registering` state (spinner + "Registering...")
- [ ] Poll `GET /api/messaging/signal/registration-status` every 2 seconds using `setInterval` in a `useEffect` (clear on unmount or on terminal state)
- [ ] When status = `pending`: transition to `pending` state — animated pulsing indicator + "Waiting for verification SMS..."
- [ ] When status = `complete`: transition to `complete` state — green checkmark + "Signal connected" — call `onComplete`
- [ ] When status = `error`: transition to `error` state — show error message, offer retry from `idle`
- [ ] Voice fallback: "Didn't receive SMS? Use voice verification" button appears in `pending` state after 30 seconds
  - [ ] On click: `POST /api/messaging/signal/register?method=voice` to trigger voice call
  - [ ] Show manual code entry form (6-digit input)
  - [ ] On submit: `POST /api/messaging/signal/verify` with code — on success transition to `complete`
- [ ] All status transitions use shadcn/ui `Badge` + `Progress` or custom animated elements — no raw CSS animations without Tailwind classes
- [ ] Write Playwright mock test: mock register + status polling endpoints through full state sequence (idle → registering → pending → complete), assert each UI state renders
- [ ] Write Playwright mock test for voice fallback: advance to pending, click voice fallback, enter code, assert verify endpoint called, assert complete state
- [ ] Run `bun run typecheck` — fix any errors

### Task 4: WebhookConfirmation component

- [ ] Create `src/client/components/setup/WebhookConfirmation.tsx`
- [ ] Props: `urls: Record<string, string>` (e.g. `{ voice: '...', sms: '...', status: '...' }`)
- [ ] Render: shadcn/ui `Card` with a list of label → URL pairs, all displayed as read-only `Input` elements (no copy button, no editable state — these are confirmation only, not for admin to use)
- [ ] Include a brief callout: "These webhooks have been configured automatically. No action needed."
- [ ] Write Playwright mock test: pass mock URL map, assert all URLs render as read-only inputs, assert no clipboard button present
- [ ] Run `bun run typecheck` — fix any errors

### Task 5: StepProviderVoice update

- [ ] Read `src/client/components/setup/StepProviderVoice.tsx` (may not exist yet if Epic 43 wizard isn't fully built — create if absent, following the existing Epic 43 spec for this step's overall structure)
- [ ] Add Telnyx to the provider comparison table displayed in this step (Epic 43 Step 3a currently only lists Twilio, SignalWire, Vonage, Plivo, Asterisk — Telnyx must be added so the OAuth button has a card to attach to):
  - [ ] Insert a Telnyx provider card into the comparison table with these values:
    | Provider | Type | Ease of setup | SMS support | WebRTC | Cost | Auth |
    |----------|------|---------------|-------------|--------|------|------|
    | Telnyx   | Cloud | Easy         | Yes         | Yes    | $    | OAuth |
  - [ ] The Telnyx card renders an `OAuthConnectButton provider="telnyx"` (same as the Twilio card)
- [ ] Add OAuth path for Twilio:
  - [ ] Show `OAuthConnectButton provider="twilio"` alongside "Twilio" provider card
  - [ ] When `onConnected` fires: hide credential fields, show `PhoneNumberSelector provider="twilio"`
  - [ ] When `onWebhooksConfigured` fires: show `WebhookConfirmation` and enable "Next" button
- [ ] Add OAuth path for Telnyx (same structure as Twilio above, `provider="telnyx"`):
  - [ ] Show `OAuthConnectButton provider="telnyx"` on the Telnyx card added above
  - [ ] When `onConnected` fires: hide credential fields, show `PhoneNumberSelector provider="telnyx"`
  - [ ] When `onWebhooksConfigured` fires: show `WebhookConfirmation` and enable "Next" button
- [ ] Credential-entry providers (SignalWire, Vonage, Plivo, Asterisk): keep credential fields, but after "Test Connection" succeeds show `PhoneNumberSelector` for the relevant provider, then `WebhookConfirmation`
- [ ] Remove the existing "Webhook URL display with copy-to-clipboard" block — replace with `WebhookConfirmation` (read-only, no copy buttons)
- [ ] Asterisk: no number selection needed (self-hosted); skip `PhoneNumberSelector`, go straight to `WebhookConfirmation` after test
- [ ] Add the Asterisk recommendation callout (visible when deployment type is `docker` per `SettingsDO` or env hint): shadcn/ui `Alert` with info icon — "Running our Docker stack? Use Asterisk + a SIP provider — free, no lock-in, fully automated."
- [ ] Run `bun run typecheck && bun run build` — fix any errors

### Task 6: StepProviderSignal update

- [ ] Read `src/client/components/setup/StepProviderSignal.tsx` (create if absent per Epic 43 spec)
- [ ] Keep: prerequisites checklist, Docker run command with copy-to-clipboard
- [ ] Keep: Bridge URL + API Key fields + "Test Connection" button
- [ ] Keep: registered phone number field (needed as input to `SignalRegistrationFlow`)
- [ ] Remove: all curl command examples for registration and verification
- [ ] Remove: manual registration steps (step-by-step with manual curl)
- [ ] Add: `SignalRegistrationFlow` component — appears after "Test Connection" passes, receives `bridgeUrl`, `apiKey`, `phoneNumber` as props
- [ ] When `SignalRegistrationFlow.onComplete` fires: mark step complete, enable "Next" button
- [ ] Keep: "Skip — I'll do this later" option that marks Signal as "pending setup"
- [ ] Run `bun run typecheck && bun run build` — fix any errors

### Task 7: Settings re-entrant channel management

- [ ] Create `src/client/components/settings/ChannelSettings.tsx`
- [ ] Layout: list of channel cards (Voice, SMS, WhatsApp, Signal, Reports), each showing status badge (Configured / Pending / Error)
- [ ] "Configure" / "Reconfigure" button per channel opens the corresponding wizard step component in a shadcn/ui `Sheet` or `Dialog` (not the full wizard container)
  - [ ] Voice/SMS: opens `StepProviderVoice` inside a sheet — same OAuth and credential flows work identically
  - [ ] Signal: opens `StepProviderSignal` inside a sheet — same `SignalRegistrationFlow` works identically
  - [ ] WhatsApp: opens `StepProviderWhatsApp` inside a sheet
- [ ] "Remove" button per configured channel: removes channel from `SettingsDO.selectedChannels`, shows confirmation dialog first
- [ ] "Add channel" button: opens channel selection (subset of wizard Step 2) for channels not yet enabled
- [ ] Wire to settings route — confirm the route file for Settings > Channels and update it to render `ChannelSettings`
- [ ] Run `bun run typecheck && bun run build` — fix any errors

### Task 8: E2E tests — full wizard OAuth flow

- [ ] Create `tests/setup-wizard-provider.spec.ts`
- [ ] Test: OAuth flow (Twilio)
  - [ ] Navigate to `/setup` as fresh admin (no channels configured)
  - [ ] Complete Step 1 (identity) and Step 2 (select Voice)
  - [ ] On Step 3a: intercept `GET /api/setup/provider/twilio/oauth/start`, return mock auth URL
  - [ ] Assert page navigates to mock auth URL (or verify the request was made if navigation is mocked)
  - [ ] Navigate back to `/setup?step=3a&provider=twilio&status=connected`
  - [ ] Intercept `GET /api/setup/provider/twilio/numbers`, return two mock numbers
  - [ ] Assert `PhoneNumberSelector` shows the two numbers
  - [ ] Select the first number
  - [ ] Intercept `POST /api/setup/provider/twilio/configure-webhooks`, return mock webhook URLs
  - [ ] Assert `WebhookConfirmation` appears with the mock URLs as read-only inputs
  - [ ] Assert no copy-to-clipboard buttons present on `WebhookConfirmation`
  - [ ] Assert "Next" button is enabled; click it to advance
- [ ] Test: credential-entry provider (Vonage)
  - [ ] Reach Step 3a with Vonage selected
  - [ ] Enter mock credentials, click "Test Connection"
  - [ ] Intercept test endpoint, return success
  - [ ] Assert `PhoneNumberSelector` appears
  - [ ] Select number, assert webhooks configured, assert `WebhookConfirmation` shown read-only
- [ ] Test: Asterisk recommendation callout
  - [ ] Mock `SettingsDO` to indicate Docker deployment
  - [ ] Assert the Asterisk recommendation `Alert` is visible on Step 3a
- [ ] Run `bunx playwright test tests/setup-wizard-provider.spec.ts`
- [ ] Fix any failures

### Task 9: E2E tests — Signal auto-registration in wizard

- [ ] Add to `tests/setup-wizard-provider.spec.ts`
- [ ] Test: Signal auto-registration (happy path)
  - [ ] Reach Step 3c with Signal selected
  - [ ] Enter bridge URL, API key, phone number; click "Test Connection" (mock success)
  - [ ] Assert `SignalRegistrationFlow` in `idle` state, button enabled
  - [ ] Click "Register Signal Number"
  - [ ] Intercept `POST /api/messaging/signal/register`, return `{ status: 'registering' }`
  - [ ] Assert UI shows "Registering..." spinner
  - [ ] Intercept polling `GET /api/messaging/signal/registration-status`, first return `{ status: 'pending' }`, then `{ status: 'complete' }` on second poll
  - [ ] Assert "Waiting for verification SMS..." state renders with animated indicator
  - [ ] Assert "Signal connected" complete state renders with green checkmark
  - [ ] Assert "Next" button enabled; wizard advances
- [ ] Test: Signal voice verification fallback
  - [ ] Advance `SignalRegistrationFlow` to `pending` state using mocks
  - [ ] Wait 30 seconds (or fast-forward using `page.clock.tick` if clock is controlled) for voice fallback button to appear
  - [ ] Click "Didn't receive SMS? Use voice verification"
  - [ ] Intercept voice trigger endpoint, return success
  - [ ] Assert manual code entry form appears
  - [ ] Fill in 6-digit code
  - [ ] Intercept `POST /api/messaging/signal/verify`, return `{ status: 'complete' }`
  - [ ] Assert complete state renders
- [ ] Test: re-entrant channel management (Settings > Channels)
  - [ ] Start from a completed setup (Voice configured, Signal not configured)
  - [ ] Navigate to Settings > Channels
  - [ ] Assert Signal card shows "Pending" status
  - [ ] Click "Configure" on Signal card
  - [ ] Assert `StepProviderSignal` opens in a sheet
  - [ ] Complete `SignalRegistrationFlow` with mocks
  - [ ] Assert Signal card now shows "Configured" status after sheet closes
- [ ] Run `bunx playwright test tests/setup-wizard-provider.spec.ts`
- [ ] Fix any failures
- [ ] Run `bun run typecheck && bun run build` — confirm clean
