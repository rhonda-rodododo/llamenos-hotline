# Epic 43: Admin Setup Wizard

## Problem

Deploying Llamenos currently requires following a multi-step technical guide: cloning the repo, generating Nostr keys via CLI, manually editing `.dev.vars`, configuring telephony provider webhooks, and knowing which provider to choose. This creates a high barrier to entry for non-technical organizers who want to run a crisis hotline. The current first-login experience drops the admin into a mostly-empty dashboard with no guidance.

Additionally, telephony is currently a hard requirement — the app assumes voice calls are the primary channel. With the addition of messaging channels (SMS, WhatsApp, Signal) in Epics 44-46, an admin should be able to deploy a text-only hotline, a voice-only hotline, or a multi-channel hotline. Telephony should be optional.

## Solution

Build a first-run setup wizard that activates automatically when an admin logs in and the system has no channels configured. The wizard walks through hotline identity, channel selection, provider configuration, and basic settings in a guided step-by-step flow. Each step validates before proceeding. The wizard is re-accessible from settings at any time.

## Design Principles

- **Progressive disclosure.** Don't show WhatsApp Business Account IDs on step 1. Start with "What channels do you want?" and only show provider-specific fields when relevant.
- **Opinionated defaults.** Pre-select sensible defaults (e.g., Twilio for voice+SMS, queue timeout 3 minutes, voicemail enabled). Admin can change later.
- **Non-blocking.** Every step should be skippable. An admin can set up voice now and add Signal later. The wizard tracks what's configured and what's pending.
- **Threat model transparency.** When selecting channels, show the honest security assessment for each (transport encryption level, metadata exposure, third-party trust).
- **Testable.** Each provider configuration includes a "Test Connection" button that validates credentials and connectivity before proceeding.

## ProviderSetup Module

The wizard's provider configuration steps (Step 3a, 3b, 3c) are backed by a unified worker module at `src/worker/provider-setup/` (see **Epic 48: Provider OAuth + Auto-Config** for full details). This module exposes REST endpoints the wizard UI calls rather than having the admin manually configure webhooks or registration commands.

Key endpoints consumed by the wizard:

| Endpoint | Purpose |
|---|---|
| `GET /api/setup/provider/:provider/oauth/start` | Returns provider OAuth authorization URL |
| `GET /api/setup/provider/:provider/oauth/callback` | Exchanges auth code, stores token, redirects to wizard |
| `GET /api/setup/provider/:provider/numbers` | Lists phone numbers available on the connected account |
| `POST /api/setup/provider/:provider/configure-webhooks` | Auto-configures webhooks for the selected number |
| `POST /api/setup/provider/:provider/test` | Validates credentials and connectivity |
| `POST /api/messaging/signal/register` | Initiates signal-cli registration for a phone number |
| `GET /api/messaging/signal/registration-status` | Polls registration state (idle / registering / pending / complete) |
| `POST /api/messaging/signal/verify` | Submits voice verification code manually |

The wizard treats these endpoints as a thin API layer — the UI handles all state transitions and UX feedback, while the worker handles all provider-side side effects. See Epic 48 for endpoint contracts and signal registration for the signal-cli bridge integration.

## Wizard Steps

### Step 1: Hotline Identity

Fields:
- **Hotline name** (pre-filled from `HOTLINE_NAME` env var or "Hotline")
- **Primary language** (dropdown from supported locales)
- **Additional IVR languages** (multi-select, only relevant if voice is enabled)
- **Organization name** (optional, for branding in WhatsApp Business profile / RCS agent)

Stored in: `SettingsDO`

### Step 2: Channel Selection

Visual card-based selection (multi-select). Each card shows:

**Voice Calls (Phone)**
- Icon: phone
- Description: "Callers dial your number. Volunteers answer in-browser or on their phones."
- Security: "Calls traverse your telephony provider. Notes are E2E encrypted."
- Requires: "A telephony provider account (Twilio, SignalWire, Vonage, Plivo, or self-hosted Asterisk)"

**SMS / Text Messages**
- Icon: message-square
- Description: "Callers text your number. Volunteers respond in the web app."
- Security: "SMS is not encrypted in transit. Carriers and your provider can read messages. Stored messages are E2E encrypted."
- Requires: "Same telephony provider as voice (uses the same number)"
- Note: "Can be enabled alongside or instead of voice calls"

**WhatsApp**
- Icon: whatsapp logo
- Description: "Callers message your WhatsApp Business number. Supports text, media, and voice calls."
- Security: "Meta decrypts messages at their servers. Meta retains metadata (phone numbers, timestamps, IP). Stored messages are E2E encrypted."
- Requires: "Meta Business Account + WhatsApp Business Account, or Twilio WhatsApp sender"
- Warning badge: "Meta can access message content"

**Signal**
- Icon: signal logo
- Description: "Callers message your Signal number. Strongest transport encryption available."
- Security: "E2E encrypted from caller to your self-hosted bridge. Bridge server sees plaintext briefly during processing. Stored messages are E2E encrypted."
- Requires: "A self-hosted signal-cli-rest-api bridge (Linux server + Docker)"
- Warning badge: "Requires technical maintenance — bridge can break when Signal updates"

**Reports** (always available, no provider needed)
- Icon: file-text
- Description: "Invite reporters to submit encrypted reports with file attachments via the web app."
- Security: "Fully E2E encrypted. Files encrypted client-side before upload."
- Requires: "Nothing — built into the platform"

At least one channel must be selected to proceed. If no voice/SMS provider is selected, telephony-related UI elements (call dashboard, shift scheduling for ring groups) are hidden throughout the app.

### Step 3: Provider Configuration (conditional)

Only shown for selected channels that require external providers. Rendered as sub-steps:

**3a: Voice/SMS Provider** (if voice or SMS selected)

Provider selection cards with comparison:

| | Twilio | SignalWire | Vonage | Plivo | Asterisk |
|---|---|---|---|---|---|
| Type | Cloud | Cloud | Cloud | Cloud | Self-hosted |
| Ease of setup | Easiest | Easy | Moderate | Moderate | Advanced |
| SMS support | Yes | Yes | Yes | Yes | Limited |
| WebRTC calling | Yes | Yes | Yes | Yes | Yes |
| Cost | $$ | $ | $$ | $ | Free (self-hosted) |

> **Recommended for self-hosted deployments:** Running our Docker stack? Use Asterisk + a SIP provider — free, no lock-in, and webhooks are configured automatically. See the card comparison above. Asterisk requires no per-minute fees and keeps all call routing on your own infrastructure.

**OAuth-enabled providers (Twilio, Telnyx):**

An `OAuthConnectButton` component replaces manual credential entry for supported providers. The flow:

1. Admin clicks "Connect with Twilio" (or "Connect with Telnyx")
2. Worker returns `{ authUrl }` from `GET /api/setup/provider/twilio/oauth/start`
3. Client navigates to `authUrl` in the same tab
4. Provider redirects to `/api/setup/provider/twilio/oauth/callback`
5. Worker exchanges the auth code, stores the token, and redirects to `/setup?step=3a&provider=twilio&status=connected`
6. TanStack Router reads query params; wizard renders `PhoneNumberSelector` showing numbers on the connected account
7. Admin picks an existing number or provisions a new one
8. Worker auto-configures all webhooks for that number via `POST /api/setup/provider/twilio/configure-webhooks`
9. Wizard shows `WebhookConfirmation` (read-only — admin does not copy or paste anything) and advances to Step 4

**Credential-entry providers (SignalWire, Vonage, Plivo, Asterisk):**

Show provider-specific credential fields:
- **SignalWire:** Project ID, API Token, Space URL
- **Vonage:** API Key, API Secret, Application ID, Private Key
- **Plivo:** Auth ID, Auth Token
- **Asterisk:** ARI URL, ARI Username, ARI Password, SIP Trunk details

After credentials are entered and validated via `POST /api/setup/provider/:provider/test`:
- `PhoneNumberSelector` appears, populated from the provider's number list
- Admin picks a number
- Worker auto-configures webhooks (same as OAuth path — no manual webhook URL copying)
- `WebhookConfirmation` shows the configured URLs as a read-only confirmation

Webhook URLs are shown as confirmation only — they are never presented with copy-to-clipboard for the admin to configure manually. The worker owns that configuration step entirely.

**3b: WhatsApp Configuration** (if WhatsApp selected)

Two paths:
- **Via Twilio** (recommended if already using Twilio for voice): Just enable WhatsApp sender in Twilio console. Show instructions + test.
- **Direct Meta API:** Guide through Meta Business Manager setup. Fields: Phone Number ID, Business Account ID, Access Token, Verify Token, App Secret. Test with a test message to the admin's WhatsApp.

**3c: Signal Bridge Configuration** (if Signal selected)

This step uses the `SignalRegistrationFlow` component to automate the registration process that previously required manual curl commands.

Flow:

1. **Prerequisites checklist** — Linux server, Docker, phone number for the bridge
2. **Docker run command** (copy-to-clipboard) to start the signal-cli-rest-api bridge
3. **Fields:** Bridge URL, Bridge API Key — admin enters these, then clicks "Test Connection" to validate the bridge is reachable
4. **"Register Signal Number" button** — initiates automated registration:
   - `POST /api/messaging/signal/register` triggers signal-cli register on the bridge
   - UI transitions to "Registering..." state (spinner)
   - UI polls `GET /api/messaging/signal/registration-status` every 2 seconds
   - When status = `pending`: shows "Waiting for verification SMS..." with animated indicator
   - When status = `complete`: shows green checkmark "Signal connected" — wizard advances automatically
5. **Voice verification fallback** — if SMS is not received, admin clicks "Didn't receive SMS? Use voice verification":
   - Worker triggers voice verification call via the bridge
   - Manual code entry form appears
   - `POST /api/messaging/signal/verify` submits the code
   - On success, same completion state as SMS path

`SignalRegistrationFlow` status states: `idle` → `registering` → `pending` → `complete` (or `error`)

If the admin doesn't have infrastructure ready, allow them to skip and come back later. Mark Signal as "pending setup" in the channel list.

### Step 4: Quick Settings

Shown based on selected channels:

**If voice enabled:**
- Queue timeout (default: 3 minutes)
- Voicemail: on/off (default: on)
- Voicemail max duration (default: 120 seconds)
- CAPTCHA bot detection: on/off (default: off)

**If SMS/WhatsApp/Signal enabled:**
- Auto-response on first contact (editable template)
- After-hours auto-response (editable template)
- Conversation inactivity timeout (default: 60 minutes)
- Max concurrent conversations per volunteer (default: 3)

**If reports enabled:**
- Default report categories (editable list)

### Step 5: Invite Volunteers

- Generate one or more invite links/codes
- Option to set role: volunteer or reporter
- Copy-to-clipboard for sharing
- "Skip — I'll do this later" option

### Step 6: Summary & Launch

Show a summary card:
- Hotline name and language
- Enabled channels with status indicators (configured / pending)
- Provider(s) configured
- Number of invite codes generated
- "Go to Dashboard" button

Mark setup as complete in `SettingsDO` (`setupCompleted: true`).

## Re-Entrant Channel Management

The Settings > Channels page reuses the same React components as the wizard steps (`StepProviderVoice`, `StepProviderSignal`, etc.) but wrapped in a `ChannelSettings` layout instead of the wizard container. This means:

- Admin can add a new channel after initial setup by navigating to Settings > Channels
- Each channel card shows its current status (configured / pending / error)
- "Add Signal" launches the same `SignalRegistrationFlow` outside the wizard
- "Reconfigure Twilio" launches the same `OAuthConnectButton` → `PhoneNumberSelector` flow
- Removing a channel de-activates it in `SettingsDO` without deleting historical data

## Making Telephony Optional

Currently, the app assumes telephony exists. Changes needed:

### Backend
- `getTelephony()` in `do-access.ts` should return `null` if no telephony provider is configured (instead of throwing)
- All telephony routes (`/api/telephony/*`) should return 404 or a helpful error if no provider is configured
- `CallRouterDO` should handle the case where no telephony provider exists (conversations-only mode)
- `ShiftManagerDO` shifts should work for messaging assignment even without voice

### Frontend
- Sidebar navigation should conditionally show/hide based on enabled channels:
  - "Calls" tab — only if voice is enabled
  - "Conversations" tab — only if any messaging channel is enabled
  - "Reports" tab — only if reports are enabled
  - "Shifts" tab — always (needed for both call routing and conversation assignment)
- Dashboard stats should adapt: show conversation metrics instead of/alongside call metrics
- Settings pages should only show relevant sections

### PWA manifest
- Already uses generic name "Hotline" — no changes needed

## Wizard State Machine

```
INCOMPLETE → step1 → step2 → step3a? → step3b? → step3c? → step4 → step5 → step6 → COMPLETE
                                                                                        ↓
                                                                              Dashboard (normal use)
```

State stored in `SettingsDO`:
```typescript
interface SetupState {
  setupCompleted: boolean
  completedSteps: string[]          // ['identity', 'channels', 'provider-voice', ...]
  pendingChannels: string[]         // channels selected but not yet configured
  selectedChannels: MessagingChannelType[] | 'voice'[]
}
```

The wizard is re-enterable: accessible from Settings > "Setup Wizard" to reconfigure or add channels. When re-entered, previously completed steps show their current values and can be modified.

## Files

**Setup wizard (existing plan):**
- **Create:** `src/client/routes/setup.tsx` — setup wizard page (redirects here on first login if !setupCompleted)
- **Create:** `src/client/components/setup/SetupWizard.tsx` — wizard container with step navigation
- **Create:** `src/client/components/setup/StepIdentity.tsx` — hotline identity form
- **Create:** `src/client/components/setup/StepChannels.tsx` — channel selection cards
- **Create:** `src/client/components/setup/StepSettings.tsx` — quick settings
- **Create:** `src/client/components/setup/StepInvite.tsx` — volunteer/reporter invite
- **Create:** `src/client/components/setup/StepSummary.tsx` — summary & launch
- **Create:** `src/client/components/setup/ChannelCard.tsx` — reusable channel selection card
- **Create:** `src/client/components/setup/ProviderCard.tsx` — reusable provider selection card
- **Create:** `src/client/components/setup/ConnectionTest.tsx` — test connection button + result display
- **Create:** `src/worker/routes/setup.ts` — setup API (get/update setup state, test connections)
- **Modify:** `src/worker/durable-objects/settings-do.ts` — SetupState, setupCompleted flag
- **Modify:** `src/worker/lib/do-access.ts` — getTelephony() returns null if unconfigured
- **Modify:** `src/client/routes/__root.tsx` — redirect to /setup if !setupCompleted, conditional nav
- **Modify:** `src/client/components/Sidebar.tsx` or equivalent — channel-aware nav items
- **Modify:** `src/worker/app.ts` — mount setup routes
- **Modify:** `src/shared/types.ts` — SetupState type

**New components added by ProviderSetup Module integration (this update):**
- **Create:** `src/client/components/setup/OAuthConnectButton.tsx` — OAuth redirect + callback polling, provider logo + connection status
- **Create:** `src/client/components/setup/PhoneNumberSelector.tsx` — lists numbers from provider, allows selection or new provisioning
- **Create:** `src/client/components/setup/SignalRegistrationFlow.tsx` — animated registration state machine (idle → registering → pending → complete), voice fallback, manual code entry
- **Create:** `src/client/components/setup/WebhookConfirmation.tsx` — read-only display of auto-configured webhook URLs
- **Modify:** `src/client/components/setup/StepProviderVoice.tsx` — add OAuth buttons for Twilio/Telnyx, `PhoneNumberSelector`, `WebhookConfirmation`
- **Modify:** `src/client/components/setup/StepProviderSignal.tsx` — replace curl examples with `SignalRegistrationFlow`
- **Create:** `src/client/components/settings/ChannelSettings.tsx` — re-entrant channel management using wizard step components

## Dependencies

- Epic 42 (Messaging Architecture — for MessagingConfig types and channel type definitions)
- **Epic 48 (Provider OAuth + Auto-Config)** — must be implemented before ProviderSetup Module integration; provides all `/api/setup/provider/*` endpoints
- **Signal Registration Epic** — must be implemented before Step 3c automated flow; provides `/api/messaging/signal/register` and `/api/messaging/signal/registration-status` endpoints

## Blocks

- Epic 44 (SMS), Epic 45 (WhatsApp), Epic 46 (Signal) — each channel hooks into the wizard's provider configuration step

## Testing

- E2E: First login → automatically redirected to setup wizard
- E2E: Complete voice-only setup → dashboard shows calls tab, no conversations tab
- E2E: Complete SMS-only setup → dashboard shows conversations tab, no calls tab
- E2E: Complete multi-channel setup → dashboard shows all relevant tabs
- E2E: Skip optional steps → wizard completes with pending items shown
- E2E: Re-enter wizard from settings → previous values preserved, can modify
- E2E: Provider connection test → success and failure states
- E2E: No provider configured → telephony routes return helpful errors, not crashes
- E2E: OAuth flow (Twilio) — mock provider OAuth callback, verify `PhoneNumberSelector` shown, verify webhooks auto-configured after number selection
- E2E: OAuth flow (Telnyx) — same as Twilio path
- E2E: Credential-entry provider (Vonage) — enter credentials, test connection, select number, webhooks auto-configured, `WebhookConfirmation` shown read-only
- E2E: Signal auto-registration — mock signal-cli bridge + mock SMS verification intercept, verify `SignalRegistrationFlow` transitions through all states and auto-completes
- E2E: Signal voice verification fallback — SMS not received, admin clicks voice fallback, enters code manually, registration completes
- E2E: Re-entrant channel management — navigate to Settings > Channels after initial setup, add Signal channel, complete `SignalRegistrationFlow` outside wizard
- E2E: Recommended path display — Docker-detected deployment shows Asterisk recommendation callout in Step 3a
