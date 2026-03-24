import { Hono } from 'hono'
import { requirePermission } from '../middleware/permission-guard'
import { ProviderSetup, OAuthStateError, ProviderApiError } from '../provider-setup/index'
import { TELEPHONY_CAPABILITIES } from '../telephony/capabilities'
import type { AppEnv } from '../types'
import type { TelephonyProviderType, NumberSearchQuery } from '@shared/types'

const providerSetup = new Hono<AppEnv>()

// --- Error handling helper (preserved from legacy ProviderSetup) ---
function handleProviderError(err: unknown): Response {
  if (err instanceof OAuthStateError) {
    return Response.json({ error: 'invalid_state', message: err.message }, { status: 400 })
  }
  if (err instanceof ProviderApiError) {
    return Response.json(
      { error: err.message, providerStatus: err.statusCode },
      { status: 400 },
    )
  }
  const message = err instanceof Error ? err.message : 'Unknown error'
  return Response.json({ error: message }, { status: 500 })
}

// --- Capabilities-based routes (match frontend API contract) ---

// Validate provider credentials
providerSetup.post('/validate', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as { provider: string; credentials?: unknown; [key: string]: unknown }
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)

  // Frontend sends flat ProviderCredentials; extract credentials or use body itself
  const credentials = body.credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  const result = await capabilities.testConnection(parsed.data)
  return c.json(result)
})

// Get webhook URLs
providerSetup.post('/webhooks', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as { provider: string; baseUrl?: string; hubId?: string }
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  const baseUrl = body.baseUrl || c.env.APP_URL || new URL(c.req.url).origin
  return c.json(capabilities.getWebhookUrls(baseUrl, body.hubId))
})

// GET /webhooks — frontend calls this without a body
providerSetup.get('/webhooks', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const config = await services.settings.getTelephonyProvider(hubId ?? undefined)
  const provider = (config?.type ?? 'twilio') as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${provider}` }, 400)
  const baseUrl = c.env.APP_URL || new URL(c.req.url).origin
  return c.json(capabilities.getWebhookUrls(baseUrl, hubId ?? undefined))
})

// List owned phone numbers
providerSetup.post('/phone-numbers', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as { provider: string; credentials?: unknown; [key: string]: unknown }
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.listOwnedNumbers) return c.json({ error: 'Provider does not support number listing' }, 400)

  const credentials = body.credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  const numbers = await capabilities.listOwnedNumbers(parsed.data)
  return c.json({ numbers })
})

// Search available phone numbers
providerSetup.post('/phone-numbers/search', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as { provider: string; credentials?: unknown; query?: NumberSearchQuery; country?: string; areaCode?: string; contains?: string; [key: string]: unknown }
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.searchAvailableNumbers) return c.json({ error: 'Provider does not support number search' }, 400)

  const credentials = body.credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  // Frontend may send query fields at top level or nested
  const query: NumberSearchQuery = body.query ?? {
    country: body.country ?? 'US',
    areaCode: body.areaCode,
    contains: body.contains,
  }
  const numbers = await capabilities.searchAvailableNumbers(parsed.data, query)
  return c.json({ numbers })
})

// Provision a phone number
providerSetup.post('/phone-numbers/provision', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as { provider: string; credentials?: unknown; phoneNumber: string; number?: string; [key: string]: unknown }
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.provisionNumber) return c.json({ error: 'Provider does not support number provisioning' }, 400)

  const credentials = body.credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  const phoneNumber = body.phoneNumber || body.number
  if (!phoneNumber) return c.json({ error: 'phoneNumber is required' }, 400)

  const result = await capabilities.provisionNumber(parsed.data, phoneNumber)
  return c.json(result)
})

// Auto-configure webhooks on provider
providerSetup.post('/configure-webhooks', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as { provider: string; credentials?: unknown; phoneNumber: string; [key: string]: unknown }
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.configureWebhooks) return c.json({ error: 'Provider does not support webhook auto-config' }, 400)

  const credentials = body.credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  const webhookUrls = capabilities.getWebhookUrls(
    c.env.APP_URL || new URL(c.req.url).origin,
    c.get('hubId') ?? undefined,
  )
  const result = await capabilities.configureWebhooks(parsed.data, body.phoneNumber, webhookUrls)
  return c.json(result)
})

// Provider status
providerSetup.get('/status', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')
  const config = await services.settings.getProviderConfig()
  return c.json(config ?? { connected: false })
})

// --- OAuth routes (delegate to ProviderSetup class) ---

providerSetup.post('/oauth/start', requirePermission('settings:manage'), async (c) => {
  try {
    const body = (await c.req.json()) as { provider: string }
    const provider = body.provider as 'twilio' | 'telnyx'
    if (provider !== 'twilio' && provider !== 'telnyx') {
      return c.json({ error: `OAuth not supported for provider: ${body.provider}` }, 400)
    }
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const result = await setup.oauthStart(provider)
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.get('/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const provider = c.req.query('provider') as 'twilio' | 'telnyx' | undefined

  if (!code || !state) {
    return c.redirect('/admin/setup?status=error&message=missing_params')
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    // Determine provider from state lookup if not in query
    const oauthProvider = provider ?? 'twilio'
    await setup.oauthCallback(oauthProvider, code, state)
    return c.redirect(`/admin/setup?provider=${oauthProvider}&status=success`)
  } catch (err) {
    const message = err instanceof Error ? encodeURIComponent(err.message) : 'unknown'
    return c.redirect(`/admin/setup?status=error&message=${message}`)
  }
})

providerSetup.get('/oauth/status/:stateToken', requirePermission('settings:manage'), async (c) => {
  try {
    const services = c.get('services')
    const config = await services.settings.getProviderConfig()
    if (config?.connected) {
      return c.json({
        provider: config.provider,
        status: 'connected' as const,
        connectedAt: new Date().toISOString(),
      })
    }
    return c.json({ provider: 'unknown', status: 'pending' as const })
  } catch (err) {
    return handleProviderError(err)
  }
})

// --- A2P routes (Twilio only, delegate to ProviderSetup class) ---

providerSetup.post('/a2p/brand', requirePermission('settings:manage'), async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const body = (await c.req.json()) as Record<string, string>
    const result = await setup.submitA2pBrand(body)
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.get('/a2p/status', requirePermission('settings:manage'), async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const result = await setup.getA2pStatus()
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.post('/a2p/campaign', requirePermission('settings:manage'), async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const body = (await c.req.json()) as Record<string, unknown>
    const result = await setup.submitA2pCampaign(body)
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.post('/a2p/skip', requirePermission('settings:manage'), async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    await setup.skipA2p()
    return c.json({ ok: true })
  } catch (err) {
    return handleProviderError(err)
  }
})

export default providerSetup
