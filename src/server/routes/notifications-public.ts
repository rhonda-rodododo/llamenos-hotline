/**
 * Public notification routes (no auth required).
 *
 * Browsers need the VAPID public key BEFORE authenticating in order to
 * subscribe to push notifications, so this endpoint lives outside the
 * authenticated notifications router.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'

const notificationsPublic = new Hono<AppEnv>()

notificationsPublic.get('/vapid-public-key', (c) => {
  const key = c.env.VAPID_PUBLIC_KEY
  if (!key) return c.json({ error: 'Push notifications not configured' }, 503)
  return c.json({ publicKey: key })
})

export { notificationsPublic }
