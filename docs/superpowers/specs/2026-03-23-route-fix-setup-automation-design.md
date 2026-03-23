# Sub-Project C: Route Fix + Setup Automation — Design Spec

**Date:** 2026-03-23
**Parent:** [Provider Auto-Registration Master Spec](2026-03-23-provider-auto-registration-design.md)
**Status:** Draft
**Dependencies:** Sub-Project A (ProviderCapabilities), Sub-Project B (Credential Encryption)

## Problem

1. **Critical bug**: `src/server/routes/provider-setup.ts` defines OAuth, phone number management, and provider status routes but is **never imported or mounted** in `src/server/app.ts`. Line 171 mounts `setupRoutes` but not `providerSetupRoutes`. Every frontend call to `/api/setup/provider/*` returns 404.

2. **Route mismatch**: Frontend API functions (`src/client/lib/api.ts`) expect generic paths (`POST /setup/provider/oauth/start` with provider in body), but the server routes use provider-in-URL (`GET /:provider/oauth/start`).

3. **Duplicated test logic**: Provider credential testing is implemented separately in `settings.ts` (inline switch) and `provider-setup.ts` (per-provider module calls).

4. **No SMS connection test**: WhatsApp and Signal have test buttons in setup, SMS doesn't.

5. **No full automation**: Credentials → numbers → webhooks → SIP → A2P should be an automated pipeline, not manual steps.

## Goal

Mount the provider setup routes, align the API contract, wire everything through the capabilities registry, and build the full automated setup flow.

## Design

### Mount Routes

**File:** `src/server/app.ts` — Add after line 171:

```typescript
import providerSetupRoutes from './routes/provider-setup'
authenticated.route('/setup/provider', providerSetupRoutes)
```

### Rewrite Routes to Match Frontend

**File:** `src/server/routes/provider-setup.ts` — Rewrite to use generic paths:

| Route | Method | Body | Delegates To |
|-------|--------|------|-------------|
| `/oauth/start` | POST | `{ provider }` | `ProviderSetup.oauthStart()` |
| `/oauth/status/:stateToken` | GET | — | `SettingsService.getOAuthState()` |
| `/oauth/callback` | GET | query: `code, state, provider` | `ProviderSetup.oauthCallback()` |
| `/validate` | POST | `{ provider, credentials }` | `TELEPHONY_CAPABILITIES[provider].testConnection()` |
| `/phone-numbers` | POST | `{ provider, credentials }` | `TELEPHONY_CAPABILITIES[provider].listOwnedNumbers()` |
| `/phone-numbers/search` | POST | `{ provider, credentials, query }` | `TELEPHONY_CAPABILITIES[provider].searchAvailableNumbers()` |
| `/phone-numbers/provision` | POST | `{ provider, credentials, number }` | `TELEPHONY_CAPABILITIES[provider].provisionNumber()` |
| `/webhooks` | POST | `{ provider, baseUrl, hubId? }` | `TELEPHONY_CAPABILITIES[provider].getWebhookUrls()` |
| `/configure-webhooks` | POST | `{ provider, credentials, phoneNumber }` | `TELEPHONY_CAPABILITIES[provider].configureWebhooks()` |
| `/configure-sip` | POST | `{ provider, credentials, options }` | `TELEPHONY_CAPABILITIES[provider].configureSipTrunk()` |
| `/status` | GET | query: `provider` | `SettingsService.getProviderConfig()` |

All routes require `settings:manage` permission. All credential-accepting routes validate input through the provider's Zod schema before delegating.

### Hub Scoping

Provider configuration is per-hub (`telephonyConfig.hubId` is the primary key). Routes accept `hubId` from the request body (for POST) or query params (for GET). If omitted, defaults to the user's active hub from the auth context. This allows multi-hub deployments to configure different providers per hub.

### A2P Registration (Twilio-specific)

The existing `ProviderSetup.submitA2pBrand()` and `submitA2pCampaign()` remain as-is — they are Twilio-specific and already implemented. The automation flow includes them as an optional step (step 7) only when the provider is Twilio. A2P is deferred for other providers until they are actively used.

### Request Validation with Zod

Each route that accepts credentials validates them using the capabilities registry:

```typescript
providerSetup.post('/validate', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json()
  const { provider, credentials } = body
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: 'Unknown provider' }, 400)

  // Validate credentials shape via Zod
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: parsed.error.format() }, 400)

  // Test connection
  const result = await capabilities.testConnection(parsed.data)
  return c.json(result)
})
```

### Deduplicate Settings Test Route

**File:** `src/server/routes/settings.ts`

Replace the `POST /telephony-provider/test` inline switch statement with:

```typescript
settings.post('/telephony-provider/test', requirePermission('settings:manage'), async (c) => {
  const config = await c.req.json()
  const capabilities = TELEPHONY_CAPABILITIES[config.type]
  if (!capabilities) return c.json({ error: 'Unknown provider' }, 400)
  const parsed = capabilities.credentialSchema.safeParse(config)
  if (!parsed.success) return c.json({ error: parsed.error.format() }, 400)
  const result = await capabilities.testConnection(parsed.data)
  return c.json(result)
})
```

### SMS Connection Test

**File:** `src/server/routes/settings.ts` — Add:

```typescript
settings.post('/messaging/test', requirePermission('settings:manage-messaging'), async (c) => {
  const { channel } = await c.req.json()
  const capabilities = MESSAGING_CAPABILITIES[channel]
  if (!capabilities) return c.json({ error: 'Unknown channel' }, 400)
  // Build config from stored settings
  const messagingConfig = await services.settings.getMessagingConfig(hubId)
  const channelConfig = messagingConfig[channel]
  if (!channelConfig) return c.json({ error: 'Channel not configured' }, 400)
  const result = await capabilities.testConnection(channelConfig)
  return c.json(result)
})
```

### Full Setup Automation Flow

The setup wizard's `VoiceSmsProviderForm` component orchestrates an automated pipeline. The backend provides individual endpoints; the frontend chains them:

```
1. POST /setup/provider/validate          → credentials valid?
2. POST /setup/provider/phone-numbers     → list owned numbers
3. POST /setup/provider/phone-numbers/search → search available (if no owned)
4. POST /setup/provider/phone-numbers/provision → buy number (user confirms)
5. POST /setup/provider/webhooks          → get webhook URLs to configure
6. POST /setup/provider/configure-webhooks → auto-configure on provider
7. POST /settings/messaging/test          → verify SMS works
8. POST /setup/provider/configure-sip     → auto-configure SIP (if applicable)
9. PATCH /settings/telephony-provider     → save final config (encrypted)
```

Each step reports progress to the UI. Steps that can't be automated (number selection) show picker UI. Steps that can be automated (webhook config) run automatically with a progress indicator.

### Frontend Changes

**File:** `src/client/components/setup/VoiceSmsProviderForm.tsx`

- Add automated setup state machine (idle → validating → listing-numbers → configuring-webhooks → testing-sms → complete)
- Show progress steps with checkmarks
- Wire PhoneNumberSelector to capabilities-based endpoints

**File:** `src/client/components/setup/PhoneNumberSelector.tsx`

- Wire to `/setup/provider/phone-numbers` and `/setup/provider/phone-numbers/search`
- Remove hardcoded provider logic, use generic API

**File:** `src/client/components/admin-settings/telephony-provider-section.tsx`

- Add SMS test button
- Use capabilities for form field rendering (from `/setup/provider/webhooks` endpoint or a new `/setup/provider/capabilities` endpoint)

### Files Changed

- `src/server/app.ts` — Mount provider-setup routes
- `src/server/routes/provider-setup.ts` — Rewrite routes to match frontend API, delegate to capabilities
- `src/server/routes/settings.ts` — Replace test switch with capabilities, add SMS test endpoint
- `src/client/lib/api.ts` — Verify API functions match new routes (may need minor path adjustments)
- `src/client/components/setup/VoiceSmsProviderForm.tsx` — Automated setup flow
- `src/client/components/setup/PhoneNumberSelector.tsx` — Wire to capabilities endpoints
- `src/client/components/admin-settings/telephony-provider-section.tsx` — SMS test, capabilities-driven forms

### Testing

- E2E test: Provider setup routes return 200 (not 404) after mounting
- E2E test: `/validate` with mock credentials returns ConnectionTestResult
- E2E test: `/phone-numbers` with mock API returns PhoneNumberInfo[]
- E2E test: `/phone-numbers/search` with query returns available numbers
- E2E test: `/webhooks` returns correct WebhookUrlSet for each provider
- E2E test: `/messaging/test` for SMS channel returns ChannelStatus
- E2E test: Full automation flow end-to-end with mock provider APIs
- Update `tests/provider-oauth.spec.ts` to use correct mounted paths
