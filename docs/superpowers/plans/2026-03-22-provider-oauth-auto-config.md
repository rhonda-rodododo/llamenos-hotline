# Provider OAuth & Auto-Configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `ProviderSetup` Worker module so that telephony provider credentials, webhook URLs, and SIP trunk configuration can be fully automated via REST endpoints — callable by the admin wizard, CLI scripts, and Ansible.

**Architecture:** A new `src/worker/provider-setup/` module exposes a unified `ProviderSetup` class with per-provider implementations (Twilio, Telnyx, SignalWire, Vonage, Plivo). Hono route handlers in `src/worker/routes/provider-setup.ts` mount these under `/api/setup/provider/*` and delegate all logic to the module. SettingsDO stores OAuth state (with TTL) and encrypted provider credentials using the existing ECIES pattern.

**Tech Stack:** Bun + Hono, SettingsDO (Durable Object), `@noble/curves` + `@noble/ciphers` for ECIES envelope encryption, Playwright for E2E tests.

---

## File Structure

```
src/worker/provider-setup/
  index.ts          — ProviderSetup class, provider dispatch
  twilio.ts         — Twilio OAuth + webhook config + SIP trunk + A2P 10DLC
  telnyx.ts         — Telnyx OAuth + webhook config + SIP connection
  signalwire.ts     — SignalWire credential validation + webhook config
  vonage.ts         — Vonage credential validation + webhook config
  plivo.ts          — Plivo credential validation + webhook config
  types.ts          — shared provider-setup types

src/worker/routes/provider-setup.ts   — Hono route handlers

tests/provider-oauth.spec.ts          — E2E tests (mocked provider APIs)
```

---

## Task 1: Shared Types and SettingsDO Changes

### 1.0 Add crypto-labels constant to `src/shared/crypto-labels.ts`
- [ ] Open `src/shared/crypto-labels.ts`
- [ ] Add the following constant for provider credential envelope encryption:
  ```typescript
  export const LABEL_PROVIDER_CREDENTIAL_WRAP = 'llamenos:provider-credential-wrap:v1'
  ```
- [ ] Run `bun run typecheck` — should pass with no new errors

### 1.1 Add shared types to `src/shared/types.ts`
- [ ] Add `OAuthState` type:
  ```typescript
  export interface OAuthState {
    state: string          // 32-byte hex CSRF token
    provider: 'twilio' | 'telnyx'
    expiresAt: number      // Unix ms — 10-minute TTL
  }
  ```
- [ ] Add `NumberInfo` type:
  ```typescript
  export interface NumberInfo {
    phoneNumber: string    // E.164
    friendlyName: string
    capabilities: { voice: boolean; sms: boolean; mms: boolean }
    sid?: string           // provider-specific ID (Twilio SID, Telnyx ID, etc.)
  }
  ```
- [ ] Add `ProviderConfig` type:
  ```typescript
  export type SupportedProvider = 'twilio' | 'telnyx' | 'signalwire' | 'vonage' | 'plivo'

  export interface ProviderConfig {
    provider: SupportedProvider
    connected: boolean
    phoneNumber?: string
    webhooksConfigured: boolean
    sipConfigured: boolean
    a2pStatus?: 'not_started' | 'pending' | 'approved' | 'failed' | 'skipped'
    // Encrypted credential fields are stored in SettingsDO, not in this type
  }
  ```
- [ ] Add `SipTrunkConfig` type:
  ```typescript
  export interface SipTrunkConfig {
    sipProvider: string    // e.g. 'sip.twilio.com'
    sipUsername: string
    sipPassword: string
    trunkSid?: string      // Twilio Trunk SID
    connectionId?: string  // Telnyx Connection ID
  }
  ```
- [ ] Run `bun run typecheck` — should pass with no new errors

### 1.2 Extend SettingsDO for OAuth state and provider config
- [ ] Open `src/worker/durable-objects/settings-do.ts`
- [ ] Add `oauthState` field to the DO storage schema — stored as JSON, TTL checked on read
- [ ] Add `setOAuthState(state: OAuthState): Promise<void>` — writes to storage, overwrites any existing state for that provider
- [ ] Add `getOAuthState(provider: string): Promise<OAuthState | null>` — returns null if not found or expired
- [ ] Add `clearOAuthState(provider: string): Promise<void>` — called after successful callback or on error
- [ ] Add `providerConfig` field to SettingsDO storage schema — encrypted at rest using ECIES with `LABEL_PROVIDER_CREDENTIAL_WRAP`
- [ ] Add `setProviderConfig(config: ProviderConfig, encryptedCredentials: string): Promise<void>` — stores both together
- [ ] Add `getProviderConfig(): Promise<ProviderConfig | null>` — returns config without decrypted credentials
- [ ] Add `getEncryptedCredentials(): Promise<string | null>` — returns opaque ciphertext (for use in provider calls)
- [ ] Run `bun run typecheck`

---

## Task 2: Provider-Setup Types Module

- [ ] Create `src/worker/provider-setup/types.ts`:
  ```typescript
  export interface OAuthStartResult {
    authUrl: string
  }

  export interface ConfigureResult {
    ok: true
  }

  export interface SelectNumberResult {
    ok: true
    webhooksConfigured: true
    sipTrunk?: SipTrunkConfig
  }

  export interface ProvisionNumberResult {
    phoneNumber: string
    sid?: string
  }

  export interface A2pBrandResult {
    brandSid: string
    status: 'pending'
  }

  export interface A2pStatusResult {
    brandStatus: 'pending' | 'approved' | 'failed'
    campaignStatus?: 'pending' | 'approved' | 'failed'
  }

  // Credentials shapes per provider (plaintext — only live in memory, never persisted)
  export interface TwilioCredentials {
    accountSid: string
    accessToken: string
    refreshToken: string
    subAccountSid?: string
  }

  export interface ApiKeyCredentials {
    [key: string]: string   // provider-specific key names
  }
  ```
- [ ] Run `bun run typecheck`

---

## Task 3: Twilio Provider Module

### 3.1 Create `src/worker/provider-setup/twilio.ts`
- [ ] Define `TwilioProvider` class with constructor accepting `(domain: string, oauthClientId: string, oauthClientSecret: string)`
- [ ] Implement `oauthStart(state: string): OAuthStartResult`:
  - Build `authUrl` pointing to `https://www.twilio.com/authorize/...`
  - Include `client_id`, `redirect_uri` (`https://{domain}/api/setup/provider/twilio/oauth/callback`), `scope` (`account:read phone-number:read phone-number:write`), `state`
- [ ] Implement `oauthCallback(code: string): Promise<TwilioCredentials>`:
  - `POST https://login.twilio.com/v1/oauth2/token` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret`
  - Parse response: `access_token`, `refresh_token`, `account_sid`
  - If the response includes a `sub_account_sid` field, capture it as `subAccountSid`; otherwise leave `subAccountSid` undefined
  - Return `TwilioCredentials` with all four fields set (including `subAccountSid` when present) — this ensures downstream API calls use the correct account scope
- [ ] Implement `refreshAccessToken(refreshToken: string): Promise<TwilioCredentials>`:
  - `POST https://login.twilio.com/v1/oauth2/token` with `grant_type=refresh_token`
  - Return updated `TwilioCredentials`
- [ ] Implement `listNumbers(credentials: TwilioCredentials): Promise<NumberInfo[]>`:
  - `GET /2010-04-01/Accounts/{sid}/IncomingPhoneNumbers.json` with Basic auth
  - Map response to `NumberInfo[]`
- [ ] Implement `configureWebhooks(credentials: TwilioCredentials, numberSid: string, domain: string, enableSms: boolean): Promise<void>`:
  - `POST /2010-04-01/Accounts/{sid}/IncomingPhoneNumbers/{numberSid}.json`
  - Set `VoiceUrl`, `StatusCallback`, optionally `SmsUrl`
- [ ] Implement `provisionNumber(credentials: TwilioCredentials, areaCode?: string, country?: string): Promise<ProvisionNumberResult>`:
  - `POST /2010-04-01/Accounts/{sid}/IncomingPhoneNumbers.json` with `AreaCode` or `PhoneNumber`
- [ ] Implement `createSipTrunk(credentials: TwilioCredentials, domain: string): Promise<SipTrunkConfig>`:
  - `POST /2010-04-01/Accounts/{sid}/SIP/Trunks.json`
  - Configure origination URI, termination settings
  - Return `SipTrunkConfig`
- [ ] Implement `submitA2pBrand(credentials: TwilioCredentials, brandInfo: Record<string, string>): Promise<A2pBrandResult>`:
  - `POST https://messaging.twilio.com/v1/Brands` with business fields
- [ ] Implement `getA2pStatus(credentials: TwilioCredentials, brandSid: string): Promise<A2pStatusResult>`:
  - `GET https://messaging.twilio.com/v1/Brands/{brandSid}`
  - If brand approved and campaignSid present, also fetch campaign status
- [ ] All methods that make provider API calls: throw a typed `ProviderApiError` on 4xx/5xx responses (include status + body)
- [ ] Run `bun run typecheck`

---

## Task 4: Telnyx Provider Module

### 4.1 Create `src/worker/provider-setup/telnyx.ts`
- [ ] Define `TelnyxProvider` class with constructor accepting `(domain: string, oauthClientId: string, oauthClientSecret: string)`
- [ ] Implement `oauthStart(state: string): OAuthStartResult`:
  - Build `authUrl` pointing to `https://sso.telnyx.com/oauth2/auth`
  - Scopes: `phone_numbers messaging call_control`
- [ ] Implement `oauthCallback(code: string): Promise<{ accessToken: string }>`:
  - `POST https://sso.telnyx.com/oauth2/token`
  - Return access token
- [ ] Implement `listNumbers(accessToken: string): Promise<NumberInfo[]>`:
  - `GET https://api.telnyx.com/v2/phone_numbers` with Bearer auth
  - Map response to `NumberInfo[]`
- [ ] Implement `configureWebhooks(accessToken: string, numberId: string, domain: string, enableSms: boolean): Promise<void>`:
  - Create or update a Telnyx Call Control Application via `POST https://api.telnyx.com/v2/applications` with webhook URLs
  - `PATCH https://api.telnyx.com/v2/phone_numbers/{numberId}` to associate with the application
- [ ] Implement `provisionNumber(accessToken: string, areaCode?: string): Promise<ProvisionNumberResult>`:
  - `POST https://api.telnyx.com/v2/number_orders` to purchase a number
- [ ] Implement `createSipConnection(accessToken: string, domain: string): Promise<SipTrunkConfig>`:
  - `POST https://api.telnyx.com/v2/ip_connections`
  - Return `SipTrunkConfig` with `sipProvider: 'sip.telnyx.com'`
- [ ] Run `bun run typecheck`

---

## Task 5: API-Key Providers (SignalWire, Vonage, Plivo)

### 5.1 Create `src/worker/provider-setup/signalwire.ts`
- [ ] Define `SignalWireProvider` class
- [ ] Implement `validateCredentials(projectId: string, apiToken: string, spaceUrl: string): Promise<void>`:
  - `GET https://{spaceUrl}/api/relay/rest/phone_numbers` with Basic auth (`projectId:apiToken`)
  - Throw `ProviderApiError` on failure
- [ ] Implement `listNumbers(projectId: string, apiToken: string, spaceUrl: string): Promise<NumberInfo[]>`
- [ ] Implement `configureWebhooks(projectId: string, apiToken: string, spaceUrl: string, numberId: string, domain: string, enableSms: boolean): Promise<void>`:
  - `PUT https://{spaceUrl}/api/relay/rest/phone_numbers/{numberId}` with call and message handler URLs
- [ ] Implement `provisionNumber(projectId: string, apiToken: string, spaceUrl: string, areaCode?: string): Promise<ProvisionNumberResult>`
- [ ] Run `bun run typecheck`

### 5.2 Create `src/worker/provider-setup/vonage.ts`
- [ ] Define `VonageProvider` class
- [ ] Implement `validateCredentials(apiKey: string, apiSecret: string): Promise<void>`:
  - `GET https://api.nexmo.com/v2/applications` with Basic auth
- [ ] Implement `listNumbers(apiKey: string, apiSecret: string): Promise<NumberInfo[]>`:
  - `GET https://rest.nexmo.com/account/numbers` with `api_key` and `api_secret` query params
- [ ] Implement `configureWebhooks(apiKey: string, apiSecret: string, number: string, domain: string, enableSms: boolean): Promise<void>`:
  - Create or update Vonage Application with `voice.webhooks.answer_url`, `voice.webhooks.event_url`, `messages.webhooks.inbound_url`
  - Link number to application via `POST https://rest.nexmo.com/number/update`
- [ ] Implement `provisionNumber(apiKey: string, apiSecret: string, country?: string): Promise<ProvisionNumberResult>`
- [ ] Run `bun run typecheck`

### 5.3 Create `src/worker/provider-setup/plivo.ts`
- [ ] Define `PlivoProvider` class
- [ ] Implement `validateCredentials(authId: string, authToken: string): Promise<void>`:
  - `GET https://api.plivo.com/v1/Account/{authId}/` with Basic auth
- [ ] Implement `listNumbers(authId: string, authToken: string): Promise<NumberInfo[]>`:
  - `GET https://api.plivo.com/v1/Account/{authId}/Number/`
- [ ] Implement `configureWebhooks(authId: string, authToken: string, number: string, domain: string, enableSms: boolean): Promise<void>`:
  - Create Plivo Application via `POST https://api.plivo.com/v1/Account/{authId}/Application/`
  - Associate number: `POST https://api.plivo.com/v1/Account/{authId}/Number/{number}/`
- [ ] Implement `provisionNumber(authId: string, authToken: string, country?: string): Promise<ProvisionNumberResult>`
- [ ] Run `bun run typecheck`

---

## Task 6: ProviderSetup Unified Interface

### 6.1 Create `src/worker/provider-setup/index.ts`
- [ ] Define `ProviderSetup` class with constructor accepting `(env: Env)` — reads OAuth client IDs/secrets and domain from `env`
- [ ] Implement `oauthStart(provider: 'twilio' | 'telnyx'): Promise<OAuthStartResult>`:
  - Generate `state` via `crypto.getRandomValues` (32 bytes → hex)
  - Store `OAuthState` in SettingsDO via `setOAuthState()`
  - Delegate to `TwilioProvider.oauthStart(state)` or `TelnyxProvider.oauthStart(state)`
- [ ] Implement `oauthCallback(provider: 'twilio' | 'telnyx', code: string, state: string): Promise<void>`:
  - Load `OAuthState` from SettingsDO via `getOAuthState(provider)`
  - Validate `state` matches and has not expired — throw `OAuthStateError` on mismatch/expiry
  - Exchange code for credentials via provider module
  - For Twilio: ensure the returned `TwilioCredentials` includes `subAccountSid` if provided by the token exchange; persist it alongside `accountSid`, `accessToken`, and `refreshToken`
  - Encrypt credentials using ECIES with domain separation constant `LABEL_PROVIDER_CREDENTIAL_WRAP` (from `src/shared/crypto-labels.ts`) — never use a raw string literal
  - Store via `setProviderConfig()`
  - Clear `OAuthState` via `clearOAuthState()`
- [ ] Implement `configure(provider: SupportedProvider, credentials: ApiKeyCredentials): Promise<ConfigureResult>`:
  - For API-key providers: validate credentials via provider module
  - Encrypt credentials using ECIES with `LABEL_PROVIDER_CREDENTIAL_WRAP` and store in SettingsDO
  - Update `ProviderConfig` with `connected: true`
- [ ] Implement `listNumbers(provider: SupportedProvider): Promise<NumberInfo[]>`:
  - Decrypt credentials from SettingsDO
  - Delegate to provider module
- [ ] Implement `selectNumber(provider: SupportedProvider, phoneNumber: string, options: { enableSms?: boolean; createSipTrunk?: boolean }): Promise<SelectNumberResult>`:
  - Decrypt credentials
  - Call `configureWebhooks()` on provider module with domain from `env`
  - Optionally call `createSipTrunk()` / `createSipConnection()`
  - Update `ProviderConfig` with `phoneNumber`, `webhooksConfigured: true`, `sipConfigured`
- [ ] Implement `provisionNumber(provider: SupportedProvider, options: { areaCode?: string; country?: string }): Promise<ProvisionNumberResult>`
- [ ] Implement `getStatus(provider: SupportedProvider): Promise<ProviderConfig>`
- [ ] Implement `submitA2pBrand(brandInfo: Record<string, string>): Promise<A2pBrandResult>` — Twilio only
- [ ] Implement `getA2pStatus(): Promise<A2pStatusResult>` — Twilio only, reads `brandSid` from stored config
- [ ] Run `bun run typecheck`

---

## Task 7: Route Handlers

### 7.1 Create `src/worker/routes/provider-setup.ts`
- [ ] Create Hono app, export as default
- [ ] All routes guarded by admin auth middleware
- [ ] `GET /twilio/oauth/start` — call `providerSetup.oauthStart('twilio')`, return `{ authUrl }`
- [ ] `GET /twilio/oauth/callback` — call `providerSetup.oauthCallback('twilio', code, state)`, redirect to `/admin/setup?provider=twilio&status=success` on success, `/admin/setup?provider=twilio&status=error&message=...` on failure
- [ ] `GET /telnyx/oauth/start` — same as above for Telnyx
- [ ] `GET /telnyx/oauth/callback` — same as above for Telnyx
- [ ] `POST /:provider/configure` — parse body `{ credentials }`, call `providerSetup.configure(provider, credentials)`, return `{ ok: true }`
- [ ] `GET /:provider/numbers` — call `providerSetup.listNumbers(provider)`, return `{ numbers: NumberInfo[] }`
- [ ] `POST /:provider/select-number` — parse body `{ phoneNumber, enableSms?, createSipTrunk? }`, call `providerSetup.selectNumber(...)`, return result
- [ ] `POST /:provider/provision-number` — parse body `{ areaCode?, country? }`, call `providerSetup.provisionNumber(...)`, return `{ phoneNumber }`
- [ ] `GET /:provider/status` — call `providerSetup.getStatus(provider)`, return `ProviderConfig`
- [ ] `POST /twilio/a2p/brand` — parse body, call `providerSetup.submitA2pBrand(...)`, return result
- [ ] `GET /twilio/a2p/status` — call `providerSetup.getA2pStatus()`, return result
- [ ] Error handling: catch `ProviderApiError` → return 400 with `{ error: message, providerStatus: statusCode }`; catch `OAuthStateError` → return 400 with `{ error: 'invalid_state' }`
- [ ] Run `bun run typecheck`

### 7.2 Mount routes in `src/worker/app.ts`
- [ ] Import `providerSetupRoutes` from `./routes/provider-setup`
- [ ] Mount: `app.route('/api/setup/provider', providerSetupRoutes)`
- [ ] Run `bun run typecheck` and `bun run build`

---

## Task 8: A2P Campaign Registration, Status Polling, and Activation

### 8.1 Add `submitA2pCampaign()` to `src/worker/provider-setup/twilio.ts`
- [ ] Implement `submitA2pCampaign(credentials: TwilioCredentials, brandSid: string, messagingServiceSid: string): Promise<{ campaignSid: string; status: 'pending' }>`:
  - `POST https://messaging.twilio.com/v1/Services/{messagingServiceSid}/Campaigns`
  - Body: `{ BrandRegistrationSid: brandSid, Description: '...', MessageSamples: [...], UsecaseId: 'MIXED' }` (caller supplies full body as `Record<string, unknown>`)
  - Parse response: extract `sid` as `campaignSid` and `status`
  - Return `{ campaignSid, status: 'pending' }`
  - Throw `ProviderApiError` on 4xx/5xx
- [ ] Extend `getA2pStatus(credentials: TwilioCredentials, brandSid: string, campaignSid?: string): Promise<A2pStatusResult>`:
  - `GET https://messaging.twilio.com/v1/Brands/{brandSid}` to fetch brand status
  - If `campaignSid` is provided, also `GET https://messaging.twilio.com/v1/Services/{messagingServiceSid}/Campaigns/{campaignSid}` to fetch campaign status
  - Return `{ brandStatus, campaignStatus? }` — SMS is only considered fully active when **both** statuses are `'approved'`
- [ ] Update `A2pStatusResult` in `src/worker/provider-setup/types.ts` to include `campaignSid?: string`
- [ ] Run `bun run typecheck`

### 8.2 Add `submitA2pCampaign()` to `ProviderSetup` (`src/worker/provider-setup/index.ts`)
- [ ] Implement `submitA2pCampaign(campaignBody: Record<string, unknown>): Promise<{ campaignSid: string; status: 'pending' }>`:
  - Decrypt Twilio credentials from SettingsDO (using `LABEL_PROVIDER_CREDENTIAL_WRAP`)
  - Read stored `brandSid` and `messagingServiceSid` from `ProviderConfig`
  - Delegate to `TwilioProvider.submitA2pCampaign(credentials, brandSid, messagingServiceSid, campaignBody)`
  - Persist the returned `campaignSid` into `ProviderConfig` in SettingsDO
- [ ] Update `getA2pStatus()`: pass stored `campaignSid` (if present) to `TwilioProvider.getA2pStatus()`; only update `ProviderConfig.a2pStatus` to `'approved'` when **both** brand and campaign are approved
- [ ] Add `skipA2p(): Promise<void>` — sets `a2pStatus: 'skipped'` in ProviderConfig, does not affect voice configuration
- [ ] Run `bun run typecheck`

### 8.3 Add campaign route to `src/worker/routes/provider-setup.ts`
- [ ] Add `POST /twilio/a2p/campaign` route handler:
  - Parse body as `Record<string, unknown>` (campaign fields)
  - Call `providerSetup.submitA2pCampaign(body)`
  - Return `{ campaignSid, status: 'pending' }`
- [ ] Add `POST /twilio/a2p/skip` route handler: calls `providerSetup.skipA2p()`, returns `{ ok: true }`
- [ ] Run `bun run typecheck`

---

## Task 9: E2E Tests

### 9.1 Create `tests/provider-oauth.spec.ts`
- [ ] Set up `page.route()` mocks for all provider API endpoints used in the tests — no real credentials needed
- [ ] **Twilio OAuth happy path:**
  - `GET /api/setup/provider/twilio/oauth/start` → assert response contains `authUrl`
  - Mock Twilio token endpoint to return a fake access token and refresh token
  - Simulate callback: `GET /api/setup/provider/twilio/oauth/callback?code=test&state={state}`
  - Assert redirect to `/admin/setup?provider=twilio&status=success`
  - `GET /api/setup/provider/twilio/status` → assert `{ connected: true }`
- [ ] **Twilio OAuth CSRF rejection:**
  - `GET /oauth/start` to get a valid state
  - Call callback with a different state value
  - Assert 400 response with `{ error: 'invalid_state' }`
- [ ] **Twilio OAuth expired state:**
  - Manipulate stored state TTL to past timestamp (or mock time)
  - Call callback → assert 400
- [ ] **SignalWire credential entry — valid:**
  - Mock `GET https://{spaceUrl}/api/relay/rest/phone_numbers` → 200
  - `POST /api/setup/provider/signalwire/configure` with `{ credentials: { projectId, apiToken, spaceUrl } }`
  - Assert `{ ok: true }` and `GET /status` returns `connected: true`
- [ ] **SignalWire credential entry — invalid:**
  - Mock validation endpoint → 401
  - Assert 400 with error
- [ ] **Number discovery:**
  - Mock provider numbers endpoint to return 2 numbers
  - `GET /api/setup/provider/twilio/numbers` → assert response contains both numbers with correct `NumberInfo` shape
- [ ] **Webhook auto-configuration:**
  - Set up request capture mock for Twilio `POST /IncomingPhoneNumbers/{sid}.json`
  - `POST /api/setup/provider/twilio/select-number` with `{ phoneNumber: '+15555550100', enableSms: true }`
  - Assert captured request body contains correct `VoiceUrl`, `StatusCallback`, `SmsUrl` values matching `https://{domain}/api/telephony/incoming` etc.
  - Call again (idempotency): assert same request made, no error
- [ ] **Number provisioning:**
  - Mock Twilio `POST /IncomingPhoneNumbers.json` → return new number
  - `POST /api/setup/provider/twilio/provision-number` with `{ areaCode: '415' }`
  - Assert response contains E.164 number
- [ ] **A2P brand submission:**
  - Mock `POST https://messaging.twilio.com/v1/Brands` → return `{ sid: 'BN...', status: 'pending' }`
  - `POST /api/setup/provider/twilio/a2p/brand` with brand info
  - Assert `{ brandSid: 'BN...', status: 'pending' }`
- [ ] **A2P status polling — brand pending (campaign not yet submitted):**
  - Mock brand status endpoint → `{ status: 'PENDING_REVIEW' }`
  - `GET /api/setup/provider/twilio/a2p/status` → assert `{ brandStatus: 'pending' }` with no `campaignStatus`
  - `GET /api/setup/provider/twilio/status` → assert `a2pStatus: 'pending'` (not yet `'approved'`)
- [ ] **A2P campaign submission (after brand approved):**
  - Mock brand status endpoint → `{ status: 'APPROVED' }`
  - Mock `POST https://messaging.twilio.com/v1/Services/{messagingServiceSid}/Campaigns` → return `{ sid: 'CM...', status: 'pending' }`
  - `POST /api/setup/provider/twilio/a2p/campaign` with campaign fields
  - Assert `{ campaignSid: 'CM...', status: 'pending' }`
- [ ] **A2P status polling — campaign pending (brand approved, campaign not yet approved):**
  - Mock brand status → `{ status: 'APPROVED' }` and campaign status → `{ status: 'PENDING_REVIEW' }`
  - `GET /api/setup/provider/twilio/a2p/status` → assert `{ brandStatus: 'approved', campaignStatus: 'pending' }`
  - `GET /api/setup/provider/twilio/status` → assert `a2pStatus: 'pending'` (not yet `'approved'` — both must be approved)
- [ ] **A2P status polling — both approved → SMS active:**
  - Mock brand status → `{ status: 'APPROVED' }` and campaign status → `{ status: 'APPROVED' }`
  - `GET /api/setup/provider/twilio/a2p/status` → assert `{ brandStatus: 'approved', campaignStatus: 'approved' }`
  - `GET /api/setup/provider/twilio/status` → assert `a2pStatus: 'approved'`
- [ ] **A2P skip:**
  - `POST /api/setup/provider/twilio/a2p/skip`
  - `GET /api/setup/provider/twilio/status` → assert `a2pStatus: 'skipped'`
- [ ] **SIP trunk provisioning (Twilio):**
  - Mock Twilio SIP Trunks API
  - `POST /api/setup/provider/twilio/select-number` with `{ phoneNumber: '...', createSipTrunk: true }`
  - Assert response contains `sipTrunk: { sipProvider: 'sip.twilio.com', sipUsername: ..., sipPassword: ... }`
- [ ] Run `bunx playwright test tests/provider-oauth.spec.ts`

---

## Completion Checklist

- [ ] `LABEL_PROVIDER_CREDENTIAL_WRAP` constant added to `src/shared/crypto-labels.ts`
- [ ] `OAuthState`, `NumberInfo`, `ProviderConfig`, `SipTrunkConfig` types in `src/shared/types.ts`
- [ ] SettingsDO stores and retrieves `OAuthState` with TTL enforcement
- [ ] SettingsDO stores provider credentials encrypted using ECIES with `LABEL_PROVIDER_CREDENTIAL_WRAP` — no raw string literals used for crypto context
- [ ] Twilio OAuth flow: start → callback → credential storage (including `subAccountSid` when returned) → status reflects connected
- [ ] Telnyx OAuth flow: start → callback → credential storage → status reflects connected
- [ ] SignalWire/Vonage/Plivo: credential validation + storage on `POST /configure`
- [ ] All providers: number listing works
- [ ] Webhook auto-config sends correct URLs to provider API (`/api/telephony/incoming`, `/api/telephony/status`, `/api/messaging/sms/webhook`)
- [ ] Webhook config is idempotent (safe to re-run)
- [ ] Number provisioning works for at least Twilio and Telnyx
- [ ] Twilio SIP trunk provisioning returns `SipTrunkConfig`
- [ ] Telnyx SIP connection provisioning returns `SipTrunkConfig`
- [ ] A2P brand submission works; returns `brandSid` and `pending` status
- [ ] A2P campaign submission (`POST /twilio/a2p/campaign`) works after brand approval; persists `campaignSid`
- [ ] A2P status polling checks both brand AND campaign status; `a2pStatus: 'approved'` only when both are approved
- [ ] A2P skip sets `a2pStatus: 'skipped'` without affecting voice
- [ ] `POST /twilio/a2p/campaign` route mounted and delegates to `ProviderSetup.submitA2pCampaign()`
- [ ] Routes mounted under `/api/setup/provider` in `app.ts`
- [ ] All routes require admin auth
- [ ] `ProviderApiError` returns 400 with provider status; `OAuthStateError` returns 400 with `invalid_state`
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] `bunx playwright test tests/provider-oauth.spec.ts` passes
