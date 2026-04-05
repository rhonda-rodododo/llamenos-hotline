/**
 * Public subscriber preferences endpoints (token-validated, no auth).
 *
 * Subscribers receive a preference token in their messages, which they use to
 * view/update their subscription status, language, and tags without needing an
 * account. The token is a per-subscriber HMAC generated server-side.
 */

import { PreferencesUpdateSchema } from '@shared/schemas/blasts'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'

const preferencesRoutes = new Hono<AppEnv>()

preferencesRoutes.get('/', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Token required' }, 400)
  const services = c.get('services')
  const subscriber = await services.blasts.getSubscriberByPreferenceToken(token)
  if (!subscriber) return c.json({ error: 'Invalid token' }, 404)
  return c.json({
    id: subscriber.id,
    channels: subscriber.channels,
    status: subscriber.status,
    tags: subscriber.tags,
    language: subscriber.language,
  })
})

preferencesRoutes.patch('/', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Token required' }, 400)
  const services = c.get('services')
  const subscriber = await services.blasts.getSubscriberByPreferenceToken(token)
  if (!subscriber) return c.json({ error: 'Invalid token' }, 404)
  const parsed = PreferencesUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
  }
  const body = parsed.data
  const updated = await services.blasts.updateSubscriber(subscriber.id, {
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.language !== undefined ? { language: body.language } : {}),
    ...(body.tags !== undefined ? { tags: body.tags } : {}),
  })
  return c.json({
    id: updated.id,
    channels: updated.channels,
    status: updated.status,
    tags: updated.tags,
    language: updated.language,
  })
})

export { preferencesRoutes }
