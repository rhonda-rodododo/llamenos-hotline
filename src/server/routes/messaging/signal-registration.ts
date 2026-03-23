import { Hono } from 'hono'
import type { SignalRegistrationPending } from '../../../shared/types'
import { validateExternalUrl } from '../../lib/ssrf-guard'
import { completeSignalRegistration } from '../../messaging/signal/registration'
import { requirePermission } from '../../middleware/permission-guard'
import type { AppEnv } from '../../types'

const signalRegistration = new Hono<AppEnv>()

/**
 * POST /api/messaging/signal/register
 * Initiate Signal number registration via the bridge.
 */
signalRegistration.post('/register', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')

  const body = await c.req.json<{
    bridgeUrl?: string
    registeredNumber?: string
    useVoice?: boolean
  }>()

  const { bridgeUrl, registeredNumber, useVoice } = body

  if (!bridgeUrl || !registeredNumber) {
    return c.json({ error: 'bridgeUrl and registeredNumber are required' }, 400)
  }

  try {
    const parsed = new URL(bridgeUrl)
    if (parsed.protocol !== 'https:') {
      return c.json({ error: 'Bridge URL must use HTTPS' }, 400)
    }
  } catch {
    return c.json({ error: 'Invalid bridge URL' }, 400)
  }

  const ssrfError = validateExternalUrl(bridgeUrl, 'Bridge URL')
  if (ssrfError) {
    return c.json({ error: ssrfError }, 400)
  }

  // Check for existing pending registration
  const existingPending = await services.settings.getSignalRegistrationPending()
  if (existingPending && existingPending.status === 'pending') {
    return c.json({ error: 'Registration already in progress' }, 409)
  }

  // Check if Signal is already fully configured
  const msgConfig = await services.settings.getMessagingConfig()
  if (msgConfig?.signal?.registeredNumber && !existingPending) {
    return c.json({ error: 'Signal is already configured' }, 409)
  }

  const method = useVoice ? 'voice' : 'sms'

  // Write pending state BEFORE calling bridge (race condition prevention)
  const pending: SignalRegistrationPending = {
    number: registeredNumber,
    bridgeUrl,
    method,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    status: 'pending',
  }

  await services.settings.setSignalRegistrationPending(pending)

  // Call the bridge to initiate registration
  try {
    const registerUrl = `${bridgeUrl}/v1/register/${encodeURIComponent(registeredNumber)}`
    const bridgeBody = useVoice ? JSON.stringify({ use_voice: true }) : undefined
    const bridgeRes = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bridgeBody,
    })

    if (!bridgeRes.ok) {
      await services.settings.clearSignalRegistrationPending()
      const errorText = await bridgeRes.text().catch(() => `HTTP ${bridgeRes.status}`)
      return c.json({ error: `Bridge error: ${errorText}` }, 502)
    }

    return c.json({ ok: true, method })
  } catch (err) {
    await services.settings.clearSignalRegistrationPending()
    const errorMsg = err instanceof Error ? err.message : String(err)
    return c.json({ error: `Bridge connection failed: ${errorMsg}` }, 502)
  }
})

/**
 * GET /api/messaging/signal/registration-status
 */
signalRegistration.get('/registration-status', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')

  const pending = await services.settings.getSignalRegistrationPending()

  if (!pending) {
    const msgConfig = await services.settings.getMessagingConfig()
    if (msgConfig?.signal?.registeredNumber) {
      return c.json({ status: 'complete' })
    }
    return c.json({ status: 'idle' })
  }

  return c.json({
    status: pending.status,
    method: pending.method,
    expiresAt: pending.expiresAt,
    error: pending.error,
  })
})

/**
 * POST /api/messaging/signal/verify
 * Manual verification code entry (voice path).
 */
signalRegistration.post('/verify', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')

  const body = await c.req.json<{ code?: string }>()
  const { code } = body

  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ error: 'Code must be exactly 6 digits' }, 400)
  }

  const pending = await services.settings.getSignalRegistrationPending()

  if (!pending) {
    return c.json({ error: 'No pending registration found' }, 404)
  }

  await completeSignalRegistration(pending, code, services.settings)

  // Re-read pending state to check result
  const result = await services.settings.getSignalRegistrationPending()

  if (!result || result.status === 'complete') {
    return c.json({ ok: true })
  }

  return c.json({ error: result.error || 'Verification failed' }, 400)
})

export default signalRegistration
