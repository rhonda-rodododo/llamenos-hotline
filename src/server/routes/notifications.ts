import { Hono } from 'hono'
import type { AppEnv } from '../types'

const notifications = new Hono<AppEnv>()

/** GET /vapid-public-key — public, returns VAPID public key from env. */
notifications.get('/vapid-public-key', (c) => {
  const key = c.env.VAPID_PUBLIC_KEY
  if (!key) {
    return c.json({ error: 'Push notifications not configured' }, 503)
  }
  return c.json({ publicKey: key })
})

/** POST /subscribe — authenticated, stores a push subscription. */
notifications.post('/subscribe', async (c) => {
  const pubkey = c.get('pubkey')
  const body = await c.req.json<{
    endpoint?: string
    keys?: { auth?: string; p256dh?: string }
    deviceLabel?: string
  }>()

  if (!body.endpoint || !body.keys?.auth || !body.keys?.p256dh) {
    return c.json({ error: 'Missing required fields: endpoint, keys.auth, keys.p256dh' }, 400)
  }

  const services = c.get('services')
  const subscription = await services.push.subscribe({
    pubkey,
    endpoint: body.endpoint,
    authKey: body.keys.auth,
    p256dhKey: body.keys.p256dh,
    deviceLabel: body.deviceLabel,
  })

  return c.json(subscription)
})

/** DELETE /subscribe — authenticated, removes a push subscription. */
notifications.delete('/subscribe', async (c) => {
  const pubkey = c.get('pubkey')
  const body = await c.req.json<{ endpoint?: string }>()

  if (!body.endpoint) {
    return c.json({ error: 'Missing required field: endpoint' }, 400)
  }

  const services = c.get('services')
  await services.push.unsubscribe(body.endpoint, pubkey)

  return c.json({ ok: true })
})

export default notifications
