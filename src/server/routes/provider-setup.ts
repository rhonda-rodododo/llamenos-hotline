import { Hono } from 'hono'
import type { SupportedProvider } from '../../shared/types'
import { ProviderSetup, OAuthStateError, ProviderApiError } from '../provider-setup/index'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const SUPPORTED_PROVIDERS: SupportedProvider[] = [
  'twilio',
  'telnyx',
  'signalwire',
  'vonage',
  'plivo',
]

function isValidProvider(p: string): p is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(p as SupportedProvider)
}

const providerSetup = new Hono<AppEnv>()

// All routes require admin auth (settings:manage permission)
providerSetup.use('*', requirePermission('settings:manage'))

// --- Error handling helper ---
function handleProviderError(err: unknown): Response {
  if (err instanceof OAuthStateError) {
    return Response.json({ error: 'invalid_state', message: err.message }, { status: 400 })
  }
  if (err instanceof ProviderApiError) {
    return Response.json(
      { error: err.message, providerStatus: err.statusCode },
      { status: 400 }
    )
  }
  const message = err instanceof Error ? err.message : 'Unknown error'
  return Response.json({ error: message }, { status: 500 })
}

// --- Twilio OAuth ---

providerSetup.get('/twilio/oauth/start', async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const result = await setup.oauthStart('twilio')
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.get('/twilio/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')

  if (!code || !state) {
    return c.redirect('/admin/setup?provider=twilio&status=error&message=missing_params')
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    await setup.oauthCallback('twilio', code, state)
    return c.redirect('/admin/setup?provider=twilio&status=success')
  } catch (err) {
    const message = err instanceof Error ? encodeURIComponent(err.message) : 'unknown'
    return c.redirect(`/admin/setup?provider=twilio&status=error&message=${message}`)
  }
})

// --- Telnyx OAuth ---

providerSetup.get('/telnyx/oauth/start', async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const result = await setup.oauthStart('telnyx')
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.get('/telnyx/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')

  if (!code || !state) {
    return c.redirect('/admin/setup?provider=telnyx&status=error&message=missing_params')
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    await setup.oauthCallback('telnyx', code, state)
    return c.redirect('/admin/setup?provider=telnyx&status=success')
  } catch (err) {
    const message = err instanceof Error ? encodeURIComponent(err.message) : 'unknown'
    return c.redirect(`/admin/setup?provider=telnyx&status=error&message=${message}`)
  }
})

// --- A2P (Twilio Only) ---

providerSetup.post('/twilio/a2p/brand', async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const body = (await c.req.json()) as Record<string, string>
    const result = await setup.submitA2pBrand(body)
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.get('/twilio/a2p/status', async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const result = await setup.getA2pStatus()
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.post('/twilio/a2p/campaign', async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const body = (await c.req.json()) as Record<string, unknown>
    const result = await setup.submitA2pCampaign(body)
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.post('/twilio/a2p/skip', async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    await setup.skipA2p()
    return c.json({ ok: true })
  } catch (err) {
    return handleProviderError(err)
  }
})

// --- Generic Provider Routes ---

providerSetup.post('/:provider/configure', async (c) => {
  const provider = c.req.param('provider')
  if (!isValidProvider(provider)) {
    return c.json({ error: `Unsupported provider: ${provider}` }, 400)
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const body = (await c.req.json()) as { credentials: Record<string, string> }
    if (!body.credentials) {
      return c.json({ error: 'credentials field is required' }, 400)
    }
    const result = await setup.configure(provider, body.credentials)
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.get('/:provider/numbers', async (c) => {
  const provider = c.req.param('provider')
  if (!isValidProvider(provider)) {
    return c.json({ error: `Unsupported provider: ${provider}` }, 400)
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const numbers = await setup.listNumbers(provider)
    return c.json({ numbers })
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.post('/:provider/select-number', async (c) => {
  const provider = c.req.param('provider')
  if (!isValidProvider(provider)) {
    return c.json({ error: `Unsupported provider: ${provider}` }, 400)
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const body = (await c.req.json()) as {
      phoneNumber: string
      enableSms?: boolean
      createSipTrunk?: boolean
    }
    if (!body.phoneNumber) {
      return c.json({ error: 'phoneNumber is required' }, 400)
    }
    const result = await setup.selectNumber(provider, body.phoneNumber, {
      enableSms: body.enableSms,
      createSipTrunk: body.createSipTrunk,
    })
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.post('/:provider/provision-number', async (c) => {
  const provider = c.req.param('provider')
  if (!isValidProvider(provider)) {
    return c.json({ error: `Unsupported provider: ${provider}` }, 400)
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const body = (await c.req.json()) as { areaCode?: string; country?: string }
    const result = await setup.provisionNumber(provider, body)
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

providerSetup.get('/:provider/status', async (c) => {
  const provider = c.req.param('provider')
  if (!isValidProvider(provider)) {
    return c.json({ error: `Unsupported provider: ${provider}` }, 400)
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.env)
    const result = await setup.getStatus()
    return c.json(result)
  } catch (err) {
    return handleProviderError(err)
  }
})

export default providerSetup
