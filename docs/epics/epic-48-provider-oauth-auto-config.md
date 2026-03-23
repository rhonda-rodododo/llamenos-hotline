# Epic 48: Provider OAuth & Auto-Configuration

## Problem

Provider setup currently requires administrators to manually:

1. Create an account with Twilio, Telnyx, or another VoIP provider
2. Copy credentials (Account SID, Auth Token, API keys) into the admin settings UI
3. Navigate the provider dashboard and manually configure webhook URLs for voice, voice status, and SMS
4. Repeat this process for every hub

At small scale this is tedious; at hundreds or thousands of hubs it is operationally unmanageable. Webhook misconfiguration is the number one support issue for VoIP platforms — an incorrect URL silently breaks all inbound calls with no feedback to the operator. Automated deployments (Ansible, CI pipelines) have no path to configure telephony at all today.

## Solution

A `ProviderSetup` module in the Worker that handles the full provider onboarding lifecycle:

- **OAuth flow** for Twilio and Telnyx (which support OAuth 2.0 "Connect Apps"): admin authorizes once in browser, Worker exchanges the code, stores encrypted credentials in SettingsDO
- **Credential entry + immediate validation** for SignalWire, Vonage, and Plivo (API-key only): admin enters credentials, Worker makes a live test call to the provider API to confirm they work
- **Phone number discovery**: list numbers on the authenticated account so admin can select one
- **Webhook auto-configuration**: update voice, voice status, and SMS webhook URLs on the selected number via provider API — one HTTP call per URL, no manual dashboard navigation
- **Number provisioning**: optionally purchase a new number if the account has none
- **SIP trunk provisioning**: for Asterisk deployments, create a Twilio SIP Trunk or Telnyx SIP Connection and return credentials for the Asterisk bridge
- **A2P 10DLC registration**: for US outbound SMS via Twilio, submit brand and campaign registration and poll approval status
- **REST API surface**: all functionality exposed as endpoints callable by the setup wizard, CLI scripts, and Ansible playbooks equally

## Architecture

```
Setup Wizard (browser)  ──┐
                           ├──→  Worker /api/setup/provider/*  ──→  Provider APIs
CLI scripts (bash/curl) ──┤
Ansible playbooks       ──┘

SettingsDO
  └─ providerConfig: ProviderConfig   ← encrypted at rest (ECIES)
  └─ oauthState: OAuthState           ← CSRF token, TTL-bound

src/worker/provider-setup/
  index.ts          ← ProviderSetup class, unified interface
  twilio.ts         ← OAuth + webhook config + number discovery + SIP trunk
  telnyx.ts         ← OAuth + webhook config + number discovery + SIP connection
  signalwire.ts     ← credential validation + webhook config
  vonage.ts         ← credential validation + webhook config
  plivo.ts          ← credential validation + webhook config
  types.ts          ← OAuthState, NumberInfo, WebhookConfig, SipTrunkConfig

src/worker/routes/provider-setup.ts   ← Hono route handlers
```

The wizard is one consumer. Ansible calls the same endpoints via curl. The module has no browser dependency.

## Provider Details

### Twilio

**Auth:** OAuth 2.0 Connect Apps.

1. Worker generates `state` (32 random bytes, stored in SettingsDO with 10-minute TTL)
2. `GET /api/setup/provider/twilio/oauth/start` → returns `{ authUrl }` pointing to `https://www.twilio.com/authorize/...` with `client_id`, `redirect_uri`, `scope`, `state`
3. Admin authorizes in browser; Twilio redirects to `GET /api/setup/provider/twilio/oauth/callback?code=...&state=...`
4. Worker validates `state` (CSRF check), exchanges `code` for SubAccount SID + access token + refresh token via `POST https://login.twilio.com/v1/oauth2/token`
5. Credentials encrypted and stored in SettingsDO

**Scopes required:** `account:read`, `phone-number:read`, `phone-number:write`

**Webhook URLs configured on selected number:**

```
Voice URL:          https://{domain}/api/telephony/incoming   (POST)
Voice Status URL:   https://{domain}/api/telephony/status     (POST)
SMS URL:            https://{domain}/api/messaging/sms/webhook (POST, if SMS enabled)
```

Done via `POST /2010-04-01/Accounts/{sid}/IncomingPhoneNumbers/{sid}.json` with `VoiceUrl`, `StatusCallback`, `SmsUrl` fields.

**SIP Trunk provisioning:**

- `POST /2010-04-01/Accounts/{sid}/SIP/Trunks.json` to create trunk
- Configure origination URI: `sip:{domain}:5060`
- Configure termination: set credentials list and allowed origination ACL
- Return `{ sipProvider: "sip.twilio.com", sipUsername, sipPassword }` for Asterisk bridge

**A2P 10DLC (US SMS, optional):**

- Brand registration: `POST https://messaging.twilio.com/v1/Brands` with business name, EIN, website, address, contact info
- Approval takes 1–3 weeks (asynchronous)
- Campaign registration: after brand approval, `POST https://messaging.twilio.com/v1/Services/{sid}/Campaigns` with use-case code
- Worker polls `GET https://messaging.twilio.com/v1/Brands/{sid}` to track approval status
- When approved, sets SMS channel active in SettingsDO
- Admin may choose "Skip A2P — voice only" to bypass entirely

### Telnyx

**Auth:** OAuth 2.0.

1. `GET /api/setup/provider/telnyx/oauth/start` → redirect URL pointing to `https://sso.telnyx.com/oauth2/auth` with `client_id`, `redirect_uri`, `scope`, `state`
2. Callback: `GET /api/setup/provider/telnyx/oauth/callback?code=...&state=...`
3. Exchange code at `POST https://sso.telnyx.com/oauth2/token` for access token
4. Store encrypted in SettingsDO

**Scopes:** `phone_numbers`, `messaging`, `call_control`

**Webhook auto-config:** `PATCH https://api.telnyx.com/v2/phone_numbers/{id}` with `connection_id` pointing to a Call Control Application configured with the hotline webhook URLs.

**SIP Connection provisioning:**

- `POST https://api.telnyx.com/v2/ip_connections` to create SIP connection
- Return `{ sipProvider: "sip.telnyx.com", sipUsername, sipPassword }`

### SignalWire

**Auth:** API key only. No OAuth.

Admin enters `projectId`, `apiToken`, and `spaceUrl` (e.g. `example.signalwire.com`). Worker validates by calling `GET https://{spaceUrl}/api/relay/rest/phone_numbers` — 200 OK confirms credentials are valid.

**Webhook config:** `PUT https://{spaceUrl}/api/relay/rest/phone_numbers/{id}` with `call_handler` and `message_handler` pointing to hotline URLs.

### Vonage

**Auth:** API key + secret. No OAuth.

Admin enters `apiKey` and `apiSecret`. Worker validates by calling `GET https://api.nexmo.com/v2/applications` — 200 OK confirms credentials.

**Webhook config:** `PUT https://api.nexmo.com/v1/buy-number` is not needed if number already owned; webhook is set at the Vonage Application level via `PUT https://api.nexmo.com/v2/applications/{id}` with `voice.webhooks.answer_url` and `voice.webhooks.event_url`. Worker creates or updates a Vonage Application for the hotline.

### Plivo

**Auth:** Auth ID + Auth Token. No OAuth.

Admin enters `authId` and `authToken`. Validation: `GET https://api.plivo.com/v1/Account/{authId}/` — 200 OK confirms credentials.

**Webhook config:** `POST https://api.plivo.com/v1/Account/{authId}/Application/` to create or update a Plivo Application with `answer_url` and `message_url`. Associate selected number with application via `POST https://api.plivo.com/v1/Account/{authId}/Number/{number}/`.

## API Endpoints

```
GET  /api/setup/provider/twilio/oauth/start
     → { authUrl: string }

GET  /api/setup/provider/twilio/oauth/callback?code=...&state=...
     → redirect to /admin/setup?provider=twilio&status=success|error

GET  /api/setup/provider/telnyx/oauth/start
     → { authUrl: string }

GET  /api/setup/provider/telnyx/oauth/callback?code=...&state=...
     → redirect to /admin/setup?provider=telnyx&status=success|error

POST /api/setup/provider/{provider}/configure
     Body: { credentials: Record<string, string> }   — for API-key providers
     → { ok: true }

GET  /api/setup/provider/{provider}/numbers
     → { numbers: NumberInfo[] }

POST /api/setup/provider/{provider}/select-number
     Body: { phoneNumber: string }
     → { ok: true, webhooksConfigured: true }

POST /api/setup/provider/{provider}/provision-number
     Body: { areaCode?: string; country?: string }
     → { phoneNumber: string }

GET  /api/setup/provider/{provider}/status
     → { connected: boolean; provider: string; phoneNumber?: string;
         webhooksConfigured: boolean; sipConfigured: boolean; a2pStatus?: string }

POST /api/setup/provider/twilio/a2p/brand
     Body: { businessName, ein, website, address, ... }
     → { brandSid: string; status: 'pending' }

GET  /api/setup/provider/twilio/a2p/status
     → { brandStatus: string; campaignStatus?: string }
```

All endpoints require admin authentication. The `{provider}` path parameter accepts `twilio`, `telnyx`, `signalwire`, `vonage`, `plivo`.

## Security

**OAuth CSRF protection:** `state` parameter is 32 random bytes generated by `crypto.getRandomValues`, stored in SettingsDO with a 10-minute TTL. Callback handler rejects any request where `state` does not match or has expired.

**Encrypted credential storage:** Provider credentials (tokens, API keys, SIDs) are stored encrypted in SettingsDO using the existing ECIES encryption pattern. Plaintext credentials are never persisted — they are decrypted in memory only when making provider API calls.

**Webhook auto-config is idempotent:** The configure and select-number flows overwrite webhook URLs unconditionally. Re-running on an already-configured number is safe and produces the same result.

**Minimal OAuth scopes:** Twilio and Telnyx OAuth requests only the scopes needed for number management and webhook configuration. No billing or account-deletion scopes are requested.

**Token refresh:** Twilio access tokens expire. The module stores the refresh token encrypted in SettingsDO and exchanges it transparently when a call fails with 401.

## Files

### Create

| File | Purpose |
|------|---------|
| `src/worker/provider-setup/index.ts` | `ProviderSetup` class — unified interface, dispatches to per-provider modules |
| `src/worker/provider-setup/twilio.ts` | Twilio OAuth, webhook config, number discovery, SIP trunk, A2P |
| `src/worker/provider-setup/telnyx.ts` | Telnyx OAuth, webhook config, number discovery, SIP connection |
| `src/worker/provider-setup/signalwire.ts` | SignalWire credential validation, webhook config |
| `src/worker/provider-setup/vonage.ts` | Vonage credential validation, webhook config |
| `src/worker/provider-setup/plivo.ts` | Plivo credential validation, webhook config |
| `src/worker/provider-setup/types.ts` | `OAuthState`, `NumberInfo`, `WebhookConfig`, `SipTrunkConfig`, `ProviderSetupResult` |
| `src/worker/routes/provider-setup.ts` | Hono route handlers, mounts all endpoints |
| `tests/provider-oauth.spec.ts` | E2E tests — OAuth flows, credential entry, webhook config, number selection |

### Modify

| File | Change |
|------|--------|
| `src/worker/app.ts` | Mount provider-setup routes under `/api/setup/provider` |
| `src/worker/durable-objects/settings-do.ts` | Add `OAuthState` storage with TTL, `providerConfig` encrypted field |
| `src/shared/types.ts` | Add `ProviderConfig`, `OAuthState`, `NumberInfo` shared types |

## Dependencies

- Epic 43 (Setup Wizard) — the wizard calls these endpoints; this epic adds the backend they need
- Epic 49 (Asterisk Bridge Auto-Config) — SIP trunk provisioning produces the credentials consumed by the Asterisk bridge

## Testing

Project uses E2E only via Playwright. Provider API calls are mocked using `page.route()` or a lightweight in-process HTTP mock so no real provider credentials are needed.

**Test scenarios:**

- **Twilio OAuth happy path:** `GET /oauth/start` returns authUrl → simulate callback with valid code and state → Worker exchanges code with mock token endpoint → SettingsDO updated → `GET /status` returns `connected: true`
- **Twilio OAuth CSRF rejection:** callback with wrong `state` parameter returns 400
- **Twilio OAuth expired state:** callback after TTL expires returns 400
- **SignalWire credential entry:** `POST /configure` with valid credentials → mock validation endpoint returns 200 → `GET /status` returns `connected: true`
- **SignalWire bad credentials:** mock validation returns 401 → endpoint returns 400 with error
- **Number discovery:** `GET /numbers` returns list from mock provider API; list renders in wizard
- **Webhook auto-config:** `POST /select-number` makes correct provider API call with exact webhook URLs; idempotent on second call
- **Number provisioning:** `POST /provision-number` calls mock purchase endpoint; returns E.164 number
- **Twilio A2P brand submission:** `POST /a2p/brand` calls mock brand endpoint → returns `{ brandSid, status: 'pending' }`
- **A2P status polling:** `GET /a2p/status` with mock returning `APPROVED` → SMS channel marked active in SettingsDO
- **A2P skip:** admin marks "voice only" → `GET /status` shows `a2pStatus: 'skipped'`, SMS channel inactive
- **SIP trunk provisioning (Twilio):** `POST /select-number` with `sipTrunk: true` creates trunk via mock API and returns `sipProvider`, `sipUsername`, `sipPassword`
