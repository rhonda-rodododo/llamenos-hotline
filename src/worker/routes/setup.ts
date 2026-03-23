import { Hono } from 'hono'
import type { TelephonyProviderType } from '@shared/types'
import { getDOs } from '../lib/do-access'
import { validateExternalUrl } from '../lib/ssrf-guard'
import { requirePermission } from '../middleware/permission-guard'
import { audit } from '../services/audit'
import type { AppEnv } from '../types'

const setup = new Hono<AppEnv>()

// --- Provider OAuth Types ---

interface OAuthState {
  provider: TelephonyProviderType
  status: 'pending' | 'connected' | 'error'
  accountSid?: string
  authToken?: string
  error?: string
  connectedAt?: string
}

// In-memory OAuth state store (per-request lifecycle — production would use DO storage)
// For setup wizard, we store state in SettingsDO via the setup state
const oauthStates = new Map<string, OAuthState>()

interface PhoneNumber {
  phoneNumber: string
  friendlyName: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  locality?: string
  region?: string
  country: string
}

interface AvailablePhoneNumber {
  phoneNumber: string
  friendlyName: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  locality?: string
  region?: string
  country: string
  monthlyPrice?: string
}

// Get setup state (any authenticated user — used for redirect logic)
setup.get('/state', async (c) => {
  const dos = getDOs(c.env)
  const res = await dos.settings.fetch(new Request('http://do/settings/setup'))
  return new Response(res.body, res)
})

// Update setup state (admin only)
setup.patch('/state', requirePermission('settings:manage'), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = await c.req.json()
  const res = await dos.settings.fetch(
    new Request('http://do/settings/setup', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  )
  if (res.ok) await audit(dos.records, 'setupStateUpdated', pubkey, body as Record<string, unknown>)
  return new Response(res.body, res)
})

// Complete setup (admin only) — also creates default hub if none exists
setup.post('/complete', requirePermission('settings:manage'), async (c) => {
  const dos = getDOs(c.env)
  const pubkey = c.get('pubkey')
  const body = (await c.req.json().catch(() => ({}))) as { demoMode?: boolean }

  // Create default hub if none exists
  try {
    const hubsRes = await dos.settings.fetch(new Request('http://do/settings/hubs'))
    const hubsData = hubsRes.ok ? ((await hubsRes.json()) as { hubs: unknown[] }) : { hubs: [] }
    if (hubsData.hubs.length === 0) {
      const hotlineName = c.env.HOTLINE_NAME || 'Hotline'
      const defaultHub = {
        id: crypto.randomUUID(),
        name: hotlineName,
        slug: hotlineName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        status: 'active',
        phoneNumber: c.env.TWILIO_PHONE_NUMBER || '',
        createdBy: pubkey,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await dos.settings.fetch(
        new Request('http://do/settings/hubs', {
          method: 'POST',
          body: JSON.stringify(defaultHub),
        })
      )
      // Assign admin to the default hub with all roles
      await dos.identity.fetch(
        new Request('http://do/identity/hub-role', {
          method: 'POST',
          body: JSON.stringify({ pubkey, hubId: defaultHub.id, roleIds: ['role-super-admin'] }),
        })
      )
    }
  } catch {
    // Non-fatal — hub creation failing shouldn't block setup completion
  }

  const res = await dos.settings.fetch(
    new Request('http://do/settings/setup', {
      method: 'PATCH',
      body: JSON.stringify({ setupCompleted: true, demoMode: body.demoMode ?? false }),
    })
  )

  if (res.ok)
    await audit(dos.records, 'setupCompleted', pubkey, { demoMode: body.demoMode ?? false })
  return new Response(res.body, res)
})

// --- Provider OAuth Endpoints ---

// Initiate OAuth flow — returns a redirect URL for the provider
setup.post('/provider/oauth/start', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as { provider: TelephonyProviderType }
  const provider = body.provider

  if (!provider || !['twilio', 'signalwire', 'vonage', 'plivo'].includes(provider)) {
    return c.json({ error: 'Invalid provider. OAuth supported for: twilio, signalwire, vonage, plivo' }, 400)
  }

  // Generate a state token for CSRF protection
  const stateToken = crypto.randomUUID()

  // Store pending state
  oauthStates.set(stateToken, {
    provider,
    status: 'pending',
  })

  // For now, return a manual-entry flow URL since actual OAuth requires provider app registration.
  // In production, this would redirect to provider's OAuth consent page.
  return c.json({
    stateToken,
    provider,
    mode: 'manual',
    message: 'OAuth app registration required. Use manual credential entry.',
    signupUrl: getProviderSignupUrl(provider),
    docsUrl: getProviderDocsUrl(provider),
  })
})

// Poll OAuth status (client polls after redirect)
setup.get('/provider/oauth/status/:stateToken', requirePermission('settings:manage'), async (c) => {
  const stateToken = c.req.param('stateToken')
  const state = oauthStates.get(stateToken)

  if (!state) {
    return c.json({ status: 'expired', error: 'OAuth session not found or expired' }, 404)
  }

  return c.json({
    provider: state.provider,
    status: state.status,
    accountSid: state.accountSid,
    error: state.error,
    connectedAt: state.connectedAt,
  })
})

// Validate credentials manually entered (alternative to OAuth callback)
setup.post('/provider/validate', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as {
    provider: TelephonyProviderType
    accountSid?: string
    authToken?: string
    signalwireSpace?: string
    apiKey?: string
    apiSecret?: string
    applicationId?: string
    authId?: string
    ariUrl?: string
    ariUsername?: string
    ariPassword?: string
  }

  if (!body.provider) {
    return c.json({ ok: false, error: 'Provider type is required' }, 400)
  }

  try {
    const result = await validateProviderCredentials(body)
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed'
    return c.json({ ok: false, error: message }, 400)
  }
})

// List existing phone numbers from provider account
setup.post('/provider/phone-numbers', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as {
    provider: TelephonyProviderType
    accountSid?: string
    authToken?: string
    signalwireSpace?: string
    apiKey?: string
    apiSecret?: string
    authId?: string
  }

  if (!body.provider) {
    return c.json({ error: 'Provider type is required' }, 400)
  }

  try {
    const numbers = await listProviderPhoneNumbers(body)
    return c.json({ numbers })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list phone numbers'
    return c.json({ error: message, numbers: [] }, 400)
  }
})

// Search available phone numbers to purchase
setup.post('/provider/phone-numbers/search', requirePermission('settings:manage'), async (c) => {
  const body = (await c.req.json()) as {
    provider: TelephonyProviderType
    accountSid?: string
    authToken?: string
    signalwireSpace?: string
    apiKey?: string
    apiSecret?: string
    authId?: string
    country: string
    areaCode?: string
    contains?: string
  }

  if (!body.provider || !body.country) {
    return c.json({ error: 'Provider and country are required' }, 400)
  }

  try {
    const numbers = await searchAvailableNumbers(body)
    return c.json({ numbers })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to search phone numbers'
    return c.json({ error: message, numbers: [] }, 400)
  }
})

// Provision (purchase) a phone number
setup.post('/provider/phone-numbers/provision', requirePermission('settings:manage'), async (c) => {
  const pubkey = c.get('pubkey')
  const dos = getDOs(c.env)
  const body = (await c.req.json()) as {
    provider: TelephonyProviderType
    accountSid?: string
    authToken?: string
    signalwireSpace?: string
    apiKey?: string
    apiSecret?: string
    authId?: string
    phoneNumber: string
  }

  if (!body.provider || !body.phoneNumber) {
    return c.json({ error: 'Provider and phone number are required' }, 400)
  }

  try {
    const result = await provisionPhoneNumber(body)
    await audit(dos.records, 'phoneNumberProvisioned', pubkey, {
      provider: body.provider,
      phoneNumber: body.phoneNumber,
    })
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to provision phone number'
    return c.json({ ok: false, error: message }, 400)
  }
})

// Get webhook URLs for the configured provider
setup.get('/provider/webhooks', requirePermission('settings:manage'), async (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    voice: `${origin}/api/telephony/incoming`,
    voiceStatus: `${origin}/api/telephony/status`,
    sms: `${origin}/api/messaging/sms/webhook`,
    whatsapp: `${origin}/api/messaging/whatsapp/webhook`,
    signal: `${origin}/api/messaging/signal/webhook`,
  })
})

// --- Helper Functions ---

function getProviderSignupUrl(provider: TelephonyProviderType): string {
  switch (provider) {
    case 'twilio': return 'https://www.twilio.com/try-twilio'
    case 'signalwire': return 'https://signalwire.com/signup'
    case 'vonage': return 'https://dashboard.nexmo.com/sign-up'
    case 'plivo': return 'https://console.plivo.com/accounts/register/'
    case 'asterisk': return 'https://www.asterisk.org/get-started/'
  }
}

function getProviderDocsUrl(provider: TelephonyProviderType): string {
  switch (provider) {
    case 'twilio': return 'https://www.twilio.com/docs/voice'
    case 'signalwire': return 'https://developer.signalwire.com/'
    case 'vonage': return 'https://developer.vonage.com/voice/voice-api/overview'
    case 'plivo': return 'https://www.plivo.com/docs/voice/'
    case 'asterisk': return 'https://docs.asterisk.org/'
  }
}

async function validateProviderCredentials(params: {
  provider: TelephonyProviderType
  accountSid?: string
  authToken?: string
  signalwireSpace?: string
  apiKey?: string
  apiSecret?: string
  applicationId?: string
  authId?: string
  ariUrl?: string
  ariUsername?: string
  ariPassword?: string
}): Promise<{ ok: boolean; error?: string; accountName?: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    switch (params.provider) {
      case 'twilio': {
        if (!params.accountSid || !params.authToken) {
          return { ok: false, error: 'Account SID and Auth Token are required' }
        }
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}.json`, {
          headers: {
            Authorization: `Basic ${btoa(`${params.accountSid}:${params.authToken}`)}`,
          },
          signal: controller.signal,
        })
        if (res.ok) {
          const data = (await res.json()) as { friendly_name?: string }
          return { ok: true, accountName: data.friendly_name }
        }
        return { ok: false, error: `Twilio returned ${res.status}` }
      }

      case 'signalwire': {
        if (!params.accountSid || !params.authToken || !params.signalwireSpace) {
          return { ok: false, error: 'Project ID, API Token, and Space URL are required' }
        }
        const res = await fetch(`https://${params.signalwireSpace}.signalwire.com/api/relay/rest/phone_numbers`, {
          headers: {
            Authorization: `Basic ${btoa(`${params.accountSid}:${params.authToken}`)}`,
          },
          signal: controller.signal,
        })
        if (res.ok) return { ok: true }
        return { ok: false, error: `SignalWire returned ${res.status}` }
      }

      case 'vonage': {
        if (!params.apiKey || !params.apiSecret) {
          return { ok: false, error: 'API Key and API Secret are required' }
        }
        const res = await fetch(`https://rest.nexmo.com/account/get-balance?api_key=${params.apiKey}&api_secret=${params.apiSecret}`, {
          signal: controller.signal,
        })
        if (res.ok) return { ok: true }
        return { ok: false, error: `Vonage returned ${res.status}` }
      }

      case 'plivo': {
        if (!params.authId || !params.authToken) {
          return { ok: false, error: 'Auth ID and Auth Token are required' }
        }
        const res = await fetch(`https://api.plivo.com/v1/Account/${params.authId}/`, {
          headers: {
            Authorization: `Basic ${btoa(`${params.authId}:${params.authToken}`)}`,
          },
          signal: controller.signal,
        })
        if (res.ok) return { ok: true }
        return { ok: false, error: `Plivo returned ${res.status}` }
      }

      case 'asterisk': {
        if (!params.ariUrl || !params.ariUsername || !params.ariPassword) {
          return { ok: false, error: 'ARI URL, Username, and Password are required' }
        }
        const urlError = validateExternalUrl(params.ariUrl, 'ARI URL')
        if (urlError) return { ok: false, error: urlError }

        const res = await fetch(`${params.ariUrl}/asterisk/info`, {
          headers: {
            Authorization: `Basic ${btoa(`${params.ariUsername}:${params.ariPassword}`)}`,
          },
          signal: controller.signal,
        })
        if (res.ok) return { ok: true }
        return { ok: false, error: `Asterisk returned ${res.status}` }
      }

      default:
        return { ok: false, error: 'Unknown provider' }
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function listProviderPhoneNumbers(params: {
  provider: TelephonyProviderType
  accountSid?: string
  authToken?: string
  signalwireSpace?: string
  apiKey?: string
  apiSecret?: string
  authId?: string
}): Promise<PhoneNumber[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    switch (params.provider) {
      case 'twilio': {
        if (!params.accountSid || !params.authToken) return []
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/IncomingPhoneNumbers.json`,
          {
            headers: {
              Authorization: `Basic ${btoa(`${params.accountSid}:${params.authToken}`)}`,
            },
            signal: controller.signal,
          }
        )
        if (!res.ok) return []
        const data = (await res.json()) as {
          incoming_phone_numbers: Array<{
            phone_number: string
            friendly_name: string
            capabilities: { voice: boolean; sms: boolean; mms: boolean }
            locality?: string
            region?: string
            iso_country: string
          }>
        }
        return data.incoming_phone_numbers.map((n) => ({
          phoneNumber: n.phone_number,
          friendlyName: n.friendly_name,
          capabilities: n.capabilities,
          locality: n.locality ?? undefined,
          region: n.region ?? undefined,
          country: n.iso_country,
        }))
      }

      case 'signalwire': {
        if (!params.accountSid || !params.authToken || !params.signalwireSpace) return []
        const res = await fetch(
          `https://${params.signalwireSpace}.signalwire.com/api/relay/rest/phone_numbers`,
          {
            headers: {
              Authorization: `Basic ${btoa(`${params.accountSid}:${params.authToken}`)}`,
            },
            signal: controller.signal,
          }
        )
        if (!res.ok) return []
        const data = (await res.json()) as {
          data: Array<{
            number: string
            name?: string
            capabilities?: { voice: boolean; sms: boolean; mms: boolean }
          }>
        }
        return (data.data || []).map((n) => ({
          phoneNumber: n.number,
          friendlyName: n.name || n.number,
          capabilities: n.capabilities || { voice: true, sms: true, mms: false },
          country: 'US',
        }))
      }

      case 'plivo': {
        if (!params.authId || !params.authToken) return []
        const res = await fetch(
          `https://api.plivo.com/v1/Account/${params.authId}/Number/`,
          {
            headers: {
              Authorization: `Basic ${btoa(`${params.authId}:${params.authToken}`)}`,
            },
            signal: controller.signal,
          }
        )
        if (!res.ok) return []
        const data = (await res.json()) as {
          objects: Array<{
            number: string
            alias?: string
            voice_enabled: boolean
            sms_enabled: boolean
            country: string
            region?: string
          }>
        }
        return (data.objects || []).map((n) => ({
          phoneNumber: n.number,
          friendlyName: n.alias || n.number,
          capabilities: { voice: n.voice_enabled, sms: n.sms_enabled, mms: false },
          region: n.region ?? undefined,
          country: n.country,
        }))
      }

      default:
        return []
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function searchAvailableNumbers(params: {
  provider: TelephonyProviderType
  accountSid?: string
  authToken?: string
  signalwireSpace?: string
  apiKey?: string
  apiSecret?: string
  authId?: string
  country: string
  areaCode?: string
  contains?: string
}): Promise<AvailablePhoneNumber[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    switch (params.provider) {
      case 'twilio': {
        if (!params.accountSid || !params.authToken) return []
        const qs = new URLSearchParams()
        if (params.areaCode) qs.set('AreaCode', params.areaCode)
        if (params.contains) qs.set('Contains', params.contains)
        qs.set('VoiceEnabled', 'true')
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/AvailablePhoneNumbers/${params.country}/Local.json?${qs}`,
          {
            headers: {
              Authorization: `Basic ${btoa(`${params.accountSid}:${params.authToken}`)}`,
            },
            signal: controller.signal,
          }
        )
        if (!res.ok) return []
        const data = (await res.json()) as {
          available_phone_numbers: Array<{
            phone_number: string
            friendly_name: string
            capabilities: { voice: boolean; sms: boolean; mms: boolean }
            locality?: string
            region?: string
            iso_country: string
          }>
        }
        return (data.available_phone_numbers || []).map((n) => ({
          phoneNumber: n.phone_number,
          friendlyName: n.friendly_name,
          capabilities: n.capabilities,
          locality: n.locality ?? undefined,
          region: n.region ?? undefined,
          country: n.iso_country,
        }))
      }

      default:
        return []
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function provisionPhoneNumber(params: {
  provider: TelephonyProviderType
  accountSid?: string
  authToken?: string
  signalwireSpace?: string
  apiKey?: string
  apiSecret?: string
  authId?: string
  phoneNumber: string
}): Promise<{ ok: boolean; phoneNumber: string; error?: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    switch (params.provider) {
      case 'twilio': {
        if (!params.accountSid || !params.authToken) {
          return { ok: false, phoneNumber: params.phoneNumber, error: 'Missing credentials' }
        }
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/IncomingPhoneNumbers.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${btoa(`${params.accountSid}:${params.authToken}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `PhoneNumber=${encodeURIComponent(params.phoneNumber)}`,
            signal: controller.signal,
          }
        )
        if (res.ok) {
          return { ok: true, phoneNumber: params.phoneNumber }
        }
        const errBody = await res.text()
        return { ok: false, phoneNumber: params.phoneNumber, error: `Twilio: ${errBody}` }
      }

      default:
        return { ok: false, phoneNumber: params.phoneNumber, error: 'Provisioning not supported for this provider' }
    }
  } finally {
    clearTimeout(timeout)
  }
}

// Test Signal bridge connection
setup.post('/test/signal', requirePermission('settings:manage-messaging'), async (c) => {
  const body = (await c.req.json()) as { bridgeUrl: string; bridgeApiKey: string }

  if (!body.bridgeUrl) {
    return c.json({ ok: false, error: 'Bridge URL is required' }, 400)
  }

  const bridgeError = validateExternalUrl(body.bridgeUrl, 'Bridge URL')
  if (bridgeError) {
    return c.json({ ok: false, error: bridgeError }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const headers: Record<string, string> = {}
    if (body.bridgeApiKey) headers.Authorization = `Bearer ${body.bridgeApiKey}`

    const res = await fetch(`${body.bridgeUrl}/v1/about`, {
      headers,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (res.ok) {
      return c.json({ ok: true })
    }
    return c.json({ ok: false, error: `Bridge returned ${res.status}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return c.json({ ok: false, error: message }, 400)
  }
})

// Test WhatsApp connection (direct Meta API)
setup.post('/test/whatsapp', requirePermission('settings:manage-messaging'), async (c) => {
  const body = (await c.req.json()) as { phoneNumberId: string; accessToken: string }

  if (!body.phoneNumberId || !body.accessToken) {
    return c.json({ ok: false, error: 'Phone Number ID and Access Token are required' }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${encodeURIComponent(body.phoneNumberId)}`,
      {
        headers: { Authorization: `Bearer ${body.accessToken}` },
        signal: controller.signal,
      }
    )
    clearTimeout(timeout)

    if (res.ok) {
      return c.json({ ok: true })
    }
    return c.json({ ok: false, error: `WhatsApp API returned ${res.status}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return c.json({ ok: false, error: message }, 400)
  }
})

export default setup
