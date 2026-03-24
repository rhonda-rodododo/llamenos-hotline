# Route Fix + Setup Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Mount the orphaned provider-setup routes, align the API contract with the frontend, and wire the full automated setup flow through the capabilities registry.

**Architecture:** Mount `provider-setup.ts` in `app.ts`, rewrite routes to match frontend expectations (generic paths, provider in body), delegate all provider-specific logic to `TELEPHONY_CAPABILITIES[provider]` and `MESSAGING_CAPABILITIES[channel]`. Add SMS test endpoint. Build automated setup pipeline in the frontend.

**Tech Stack:** Hono routes, Zod v4 validation, ProviderCapabilities registry, Playwright E2E tests.

**Spec:** `docs/superpowers/specs/2026-03-23-route-fix-setup-automation-design.md`

**Prerequisites:**
- **Plan A MUST be complete** — this plan imports `TELEPHONY_CAPABILITIES` and `MESSAGING_CAPABILITIES` from Plan A.
  Verify: `grep -r 'TELEPHONY_CAPABILITIES' src/server/telephony/capabilities.ts` should show the registry.
- **Plan B should be complete** for encrypted credential storage (not blocking but recommended).

**SSRF Note:** The `/validate` route calls `capabilities.testConnection()` which makes outbound HTTP requests. SSRF protection is handled within each provider's capabilities — Asterisk uses `validateSelfHostedUrl()`, Signal uses `validateExternalUrl()`, cloud providers use hardcoded API base URLs. No additional SSRF guard is needed at the route level.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server/app.ts` | MODIFY | Mount provider-setup routes |
| `src/server/routes/provider-setup.ts` | REWRITE | Generic routes matching frontend API contract |
| `src/server/routes/settings.ts` | MODIFY | Replace test switch with capabilities, add SMS test |
| `src/client/lib/api.ts` | VERIFY/MODIFY | Ensure API functions match new routes |
| `src/client/components/setup/VoiceSmsProviderForm.tsx` | MODIFY | Wire automated setup state machine |
| `src/client/components/setup/PhoneNumberSelector.tsx` | MODIFY | Wire to capabilities-based endpoints |
| `tests/provider-setup-routes.spec.ts` | CREATE | E2E tests for setup routes |

---

### Task 1: Mount Provider Setup Routes

**Files:**
- Modify: `src/server/app.ts` (after line 171)

- [x] **Step 1: Write test that the routes are reachable**

```typescript
// tests/provider-setup-routes.spec.ts
import { test, expect } from '@playwright/test'

test.describe('provider setup routes', () => {
  test('POST /api/setup/provider/validate returns 400 for missing provider (not 404)', async ({ request }) => {
    // If this returns 404, the routes are not mounted
    const res = await request.post('/api/setup/provider/validate', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    // 400 (bad request) or 401 (unauthorized) means the route EXISTS
    // 404 means the route is NOT MOUNTED (the current bug)
    expect(res.status()).not.toBe(404)
  })
})
```

- [x] **Step 2: Run test to confirm the 404 bug**

Run: `bunx playwright test tests/provider-setup-routes.spec.ts`
Expected: FAIL — status is 404 (routes not mounted)
(These tests need the webserver running — they run under the chromium project with global-setup)

- [x] **Step 3: Mount the routes in app.ts**

In `src/server/app.ts`, add after line 171 (`authenticated.route('/setup', setupRoutes)`):

```typescript
import providerSetupRoutes from './routes/provider-setup'
// ... existing code ...
authenticated.route('/setup/provider', providerSetupRoutes)
```

- [x] **Step 4: Run test to verify routes are mounted**

Run: `bunx playwright test tests/provider-setup-routes.spec.ts --project chromium`
Expected: PASS — status is 400 or 401 (not 404)

- [x] **Step 5: Commit**

```bash
git add src/server/app.ts tests/provider-setup-routes.spec.ts
git commit -m "fix: mount provider-setup routes in app.ts (fixes 404 on /api/setup/provider/*)"
```

---

### Task 2: Rewrite Provider Setup Routes

**Files:**
- Rewrite: `src/server/routes/provider-setup.ts`

- [x] **Step 1: Add route tests for validate, phone-numbers, webhooks**

Append to `tests/provider-setup-routes.spec.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

test.describe('provider setup API', () => {
  // Note: These tests run under the chromium project which includes global-setup
  // (creates admin auth). If running standalone, ensure dev server is running
  // and admin is bootstrapped.

  test('POST /validate with valid Asterisk creds tests connection', async ({ request }) => {
    // Asterisk is running in Docker — use real ARI credentials
    const res = await request.post('/api/setup/provider/validate', {
      data: {
        provider: 'asterisk',
        credentials: {
          type: 'asterisk',
          phoneNumber: '+15551234567',
          ariUrl: 'http://localhost:8089/ari',
          ariUsername: 'llamenos',
          ariPassword: 'changeme',
        },
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.connected).toBe(true)
    expect(body.latencyMs).toBeGreaterThan(0)
    expect(body.accountName).toContain('Asterisk')
  })

  test('POST /validate with invalid provider returns 400', async ({ request }) => {
    const res = await request.post('/api/setup/provider/validate', {
      data: { provider: 'nonexistent', credentials: {} },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /validate with bad schema returns 400', async ({ request }) => {
    const res = await request.post('/api/setup/provider/validate', {
      data: {
        provider: 'twilio',
        credentials: { type: 'twilio', phoneNumber: 'not-e164' },
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /webhooks returns URLs for provider', async ({ request }) => {
    const res = await request.post('/api/setup/provider/webhooks', {
      data: { provider: 'twilio', baseUrl: 'https://hotline.example.com', hubId: 'hub-1' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.voiceIncoming).toContain('/api/telephony/incoming')
    expect(body.voiceIncoming).toContain('hub=hub-1')
  })
})
```

- [x] **Step 2: Rewrite `src/server/routes/provider-setup.ts`**

Full rewrite — generic paths, provider in body, delegates to capabilities:

```typescript
import { Hono } from 'hono'
import { requirePermission } from '../middleware/permission-guard'
import { TELEPHONY_CAPABILITIES } from '../telephony/capabilities'
import type { AppEnv } from '../types'
import type { TelephonyProviderType } from '@shared/types'

const providerSetup = new Hono<AppEnv>()

// Validate provider credentials
providerSetup.post('/validate', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json() as { provider: string; credentials: unknown }
  const capabilities = TELEPHONY_CAPABILITIES[body.provider as TelephonyProviderType]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)

  const parsed = capabilities.credentialSchema.safeParse(body.credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error.format() }, 400)

  const result = await capabilities.testConnection(parsed.data)
  return c.json(result)
})

// Get webhook URLs for a provider
providerSetup.post('/webhooks', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json() as { provider: string; baseUrl: string; hubId?: string }
  const capabilities = TELEPHONY_CAPABILITIES[body.provider as TelephonyProviderType]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  return c.json(capabilities.getWebhookUrls(body.baseUrl, body.hubId))
})

// List owned phone numbers
providerSetup.post('/phone-numbers', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json() as { provider: string; credentials: unknown }
  const capabilities = TELEPHONY_CAPABILITIES[body.provider as TelephonyProviderType]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.listOwnedNumbers) return c.json({ error: 'Provider does not support number listing' }, 400)

  const parsed = capabilities.credentialSchema.safeParse(body.credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error.format() }, 400)

  const numbers = await capabilities.listOwnedNumbers(parsed.data)
  return c.json({ numbers })
})

// Search available phone numbers
providerSetup.post('/phone-numbers/search', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json() as { provider: string; credentials: unknown; query: unknown }
  const capabilities = TELEPHONY_CAPABILITIES[body.provider as TelephonyProviderType]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.searchAvailableNumbers) return c.json({ error: 'Provider does not support number search' }, 400)

  const parsed = capabilities.credentialSchema.safeParse(body.credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error.format() }, 400)

  // TODO: validate query with a NumberSearchQuery Zod schema
  const numbers = await capabilities.searchAvailableNumbers(parsed.data, body.query as NumberSearchQuery)
  return c.json({ numbers })
})

// Provision a phone number
providerSetup.post('/phone-numbers/provision', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json() as { provider: string; credentials: unknown; number: string }
  const capabilities = TELEPHONY_CAPABILITIES[body.provider as TelephonyProviderType]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.provisionNumber) return c.json({ error: 'Provider does not support number provisioning' }, 400)

  const parsed = capabilities.credentialSchema.safeParse(body.credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error.format() }, 400)

  const result = await capabilities.provisionNumber(parsed.data, body.number)
  return c.json(result)
})

// Auto-configure webhooks on provider
providerSetup.post('/configure-webhooks', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json() as { provider: string; credentials: unknown; phoneNumber: string }
  const capabilities = TELEPHONY_CAPABILITIES[body.provider as TelephonyProviderType]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.configureWebhooks) return c.json({ error: 'Provider does not support webhook auto-config' }, 400)

  const parsed = capabilities.credentialSchema.safeParse(body.credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error.format() }, 400)

  const webhookUrls = capabilities.getWebhookUrls(
    c.env.APP_URL || `${new URL(c.req.url).origin}`,
    c.get('hubId') ?? undefined,
  )
  const result = await capabilities.configureWebhooks(parsed.data, body.phoneNumber, webhookUrls)
  return c.json(result)
})

// Configure SIP trunk
providerSetup.post('/configure-sip', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json() as { provider: string; credentials: unknown; options: unknown }
  const capabilities = TELEPHONY_CAPABILITIES[body.provider as TelephonyProviderType]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.configureSipTrunk) return c.json({ error: 'Provider does not support SIP trunk config' }, 400)

  const parsed = capabilities.credentialSchema.safeParse(body.credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error.format() }, 400)

  const result = await capabilities.configureSipTrunk(parsed.data, body.options as SipTrunkOptions)
  return c.json(result)
})

// OAuth start (Twilio, Telnyx)
providerSetup.post('/oauth/start', requirePermission('settings:manage'), async (c) => {
  const body = await c.req.json() as { provider: string }
  const services = c.get('services')
  const providerSetupService = services.providerSetup
  if (!providerSetupService) return c.json({ error: 'Provider setup not available' }, 500)
  const result = await providerSetupService.oauthStart(body.provider as any)
  return c.json(result)
})

// OAuth callback
providerSetup.get('/oauth/callback', async (c) => {
  const { code, state, provider } = c.req.query()
  const services = c.get('services')
  const providerSetupService = services.providerSetup
  if (!providerSetupService) return c.text('Provider setup not available', 500)
  try {
    await providerSetupService.oauthCallback(provider as any, code, state)
    return c.redirect('/setup?oauth=success')
  } catch (err) {
    return c.redirect(`/setup?oauth=error&message=${encodeURIComponent(String(err))}`)
  }
})

// Provider status
providerSetup.get('/status', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const config = await services.settings.getProviderConfig()
  return c.json(config ?? { connected: false })
})

export default providerSetup
```

- [x] **Step 3: Run tests**

Run: `bunx playwright test tests/provider-setup-routes.spec.ts --project chromium`
Expected: All tests PASS

- [x] **Step 4: Commit**

```bash
git add src/server/routes/provider-setup.ts tests/provider-setup-routes.spec.ts
git commit -m "feat: rewrite provider-setup routes to match frontend API + capabilities registry"
```

---

### Task 3: Deduplicate Settings Test Route + Add SMS Test

**Files:**
- Modify: `src/server/routes/settings.ts`

- [x] **Step 1: Replace the telephony-provider/test switch with capabilities**

Find the `POST /telephony-provider/test` handler and replace the inline switch with:

```typescript
import { TELEPHONY_CAPABILITIES } from '../telephony/capabilities'

settings.post('/telephony-provider/test', requirePermission('settings:manage'), async (c) => {
  const config = await c.req.json()
  const capabilities = TELEPHONY_CAPABILITIES[config.type as TelephonyProviderType]
  if (!capabilities) return c.json({ error: `Unknown provider: ${config.type}` }, 400)

  const parsed = capabilities.credentialSchema.safeParse(config)
  if (!parsed.success) return c.json({ error: 'Invalid config', details: parsed.error.format() }, 400)

  const result = await capabilities.testConnection(parsed.data)
  return c.json(result)
})
```

- [x] **Step 2: Add SMS test endpoint**

```typescript
import { MESSAGING_CAPABILITIES } from '../messaging/capabilities'

settings.post('/messaging/test', requirePermission('settings:manage-messaging'), async (c) => {
  const hubId = c.get('hubId')
  const body = await c.req.json() as { channel: string }
  const capabilities = MESSAGING_CAPABILITIES[body.channel as MessagingChannelType]
  if (!capabilities) return c.json({ error: `Unknown channel: ${body.channel}` }, 400)

  const services = c.get('services')
  const messagingConfig = await services.settings.getMessagingConfig(hubId ?? undefined)
  const channelConfig = messagingConfig?.[body.channel as keyof typeof messagingConfig]
  if (!channelConfig) return c.json({ error: `Channel ${body.channel} not configured` }, 400)

  const result = await capabilities.testConnection(channelConfig)
  return c.json(result)
})
```

- [x] **Step 3: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add src/server/routes/settings.ts
git commit -m "feat: deduplicate provider test via capabilities, add SMS connection test"
```

---

### Task 4: Verify Frontend API Alignment

**Files:**
- Verify: `src/client/lib/api.ts`

- [x] **Step 1: Read the frontend API functions and verify paths match**

Check that these functions in `api.ts` call the correct paths:
- `startProviderOAuth()` → `POST /api/setup/provider/oauth/start`
- `validateProviderCredentials()` → `POST /api/setup/provider/validate`
- `listProviderPhoneNumbers()` → `POST /api/setup/provider/phone-numbers`
- `searchAvailablePhoneNumbers()` → `POST /api/setup/provider/phone-numbers/search`
- `provisionPhoneNumber()` → `POST /api/setup/provider/phone-numbers/provision`
- `getWebhookUrls()` → `POST /api/setup/provider/webhooks`

If any paths don't match, update them.

- [x] **Step 2: Run build to verify frontend compiles**

Run: `bun run build`
Expected: PASS

- [x] **Step 3: Commit any changes**

```bash
git add src/client/lib/api.ts
git commit -m "fix: align frontend API paths with mounted provider-setup routes"
```

---

### Task 5: Final Integration Test

- [x] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [x] **Step 2: Run full build**

Run: `bun run build`
Expected: PASS

- [x] **Step 3: Run all bridge + provider tests**

Run: `bunx playwright test tests/provider-setup-routes.spec.ts tests/provider-capabilities.spec.ts tests/asterisk-auto-config.spec.ts --project bridge`
Expected: All PASS

- [x] **Step 4: Run chromium tests for route smoke test**

Run: `bunx playwright test tests/provider-setup-routes.spec.ts --project chromium`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git status
# Stage only relevant changed files
git commit -m "feat: route fix + setup automation complete"
```
