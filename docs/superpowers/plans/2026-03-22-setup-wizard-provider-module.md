# Setup Wizard Provider Module Plan

## Overview
Enhance the setup wizard's provider configuration step (Step 3) with OAuth-style
credential validation, phone number selection from provider accounts, webhook URL
confirmation, and Signal bridge setup improvements. Add a re-entrant Channel Settings
component to the admin settings page.

## Tasks

### Backend
- [x] Add provider OAuth start endpoint (`POST /setup/provider/oauth/start`)
- [x] Add provider OAuth status polling endpoint (`GET /setup/provider/oauth/status/:stateToken`)
- [x] Add provider credential validation endpoint (`POST /setup/provider/validate`)
- [x] Add phone number listing endpoint (`POST /setup/provider/phone-numbers`)
- [x] Add phone number search endpoint (`POST /setup/provider/phone-numbers/search`)
- [x] Add phone number provisioning endpoint (`POST /setup/provider/phone-numbers/provision`)
- [x] Add webhook URL endpoint (`GET /setup/provider/webhooks`)
- [x] Provider validation for all 5 providers (Twilio, SignalWire, Vonage, Plivo, Asterisk)

### Frontend Components
- [x] `OAuthConnectButton` — credential validation with provider branding, status indicators, signup links
- [x] `PhoneNumberSelector` — existing number list, manual entry, search available, provision new
- [x] `WebhookConfirmation` — read-only webhook URL display with copy buttons
- [x] Update `VoiceSmsProviderForm` to use OAuthConnectButton + PhoneNumberSelector + WebhookConfirmation
- [x] Update `SignalProviderForm` with E2EE note, prerequisites checklist, Docker command, WebhookConfirmation
- [x] `ChannelSettings` — re-entrant channel management section on admin settings page

### API Client
- [x] Add `startProviderOAuth()` API function
- [x] Add `getProviderOAuthStatus()` API function
- [x] Add `validateProviderCredentials()` API function
- [x] Add `listProviderPhoneNumbers()` API function
- [x] Add `searchAvailablePhoneNumbers()` API function
- [x] Add `provisionPhoneNumber()` API function
- [x] Add `getWebhookUrls()` API function

### i18n
- [x] Add setup.oauth.* keys to en.json
- [x] Add setup.phoneNumbers.* keys to en.json
- [x] Add setup.webhooks.* keys to en.json
- [x] Add setup.signal* (E2EE note, prerequisites, Docker command) keys to en.json
- [x] Add channelSettings.* keys to en.json
- [x] Add keys to all 12 non-English locale files

### Integration
- [x] Wire ChannelSettings into admin settings page (`/admin/settings`)
- [x] Import TelephonyProviderType properly in api.ts

### E2E Tests
- [x] Voice provider step shows validate button
- [x] Provider selection changes credential fields
- [x] Phone number input is available
- [x] Signal provider step shows bridge configuration
- [x] Signal test connection button enables with URL
- [x] Webhook confirmation renders
- [x] Multiple channels show multiple provider forms
- [x] Complete setup flow through provider step
- [x] Channel settings section on admin settings page

### Build Verification
- [x] `bun run typecheck` passes
- [x] `bun run build` passes
