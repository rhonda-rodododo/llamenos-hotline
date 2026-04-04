import { Hono } from 'hono'
import { z } from 'zod'
import type { SignalRegistrationPending } from '../../../shared/types'
import { validateExternalUrl } from '../../lib/ssrf-guard'
import { completeSignalRegistration } from '../../messaging/signal/registration'
import { requirePermission } from '../../middleware/permission-guard'
import type { AppEnv } from '../../types'

const signalRegistration = new Hono<AppEnv>()

const RegisterSchema = z.object({
  bridgeUrl: z.string().min(1),
  registeredNumber: z.string().min(1),
  useVoice: z.boolean().optional(),
})

const VerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
})

/**
 * POST /api/messaging/signal/register
 * Initiate Signal number registration via the bridge.
 */
signalRegistration.post('/register', requirePermission('settings:manage'), async (c) => {
  const services = c.get('services')

  const raw = await c.req.json()
  const parsed = RegisterSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json(
      { error: 'bridgeUrl and registeredNumber are required', details: parsed.error.flatten() },
      400
    )
  }
  const { bridgeUrl, registeredNumber, useVoice } = parsed.data

  try {
    const parsedUrl = new URL(bridgeUrl)
    if (parsedUrl.protocol !== 'https:') {
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

  const raw = await c.req.json()
  const parsed = VerifySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'Code must be exactly 6 digits', details: parsed.error.flatten() }, 400)
  }
  const { code } = parsed.data

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
