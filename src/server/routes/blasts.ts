import { Hono } from 'hono'
import type { AppEnv } from '../types'

const blasts = new Hono<AppEnv>()

// These routes are hub-scoped and require authentication (handled by middleware in app.ts)

// --- Subscribers ---
blasts.get('/subscribers', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const subscribers = await services.blasts.listSubscribers(hubId ?? undefined)
  return c.json({ subscribers })
})

blasts.delete('/subscribers/:id', async (c) => {
  const id = c.req.param('id')
  const services = c.get('services')
  await services.blasts.deleteSubscriber(id)
  return c.json({ ok: true })
})

blasts.get('/subscribers/stats', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const stats = await services.blasts.getSubscriberStats(hubId ?? undefined)
  return c.json(stats)
})

blasts.post('/subscribers/import', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = (await c.req.json()) as Array<{
    identifierHash: string
    channels?: Array<{ type: 'sms' | 'whatsapp' | 'signal' | 'rcs'; verified: boolean }>
    tags?: string[]
    language?: string
    status?: string
    preferenceToken?: string
  }>
  if (!Array.isArray(body)) {
    return c.json({ error: 'Expected array of subscribers' }, 400)
  }
  const results = await Promise.allSettled(
    body.map((sub) =>
      services.blasts.createSubscriber({
        hubId: hubId ?? 'global',
        identifierHash: sub.identifierHash,
        channels: sub.channels,
        tags: sub.tags,
        language: sub.language,
        status: sub.status,
        preferenceToken: sub.preferenceToken,
      })
    )
  )
  const imported = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length
  return c.json({ imported, failed, skipped: failed })
})

// --- Blasts ---
blasts.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const blastList = await services.blasts.listBlasts(hubId ?? undefined)
  return c.json({ blasts: blastList })
})

blasts.post('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = (await c.req.json()) as {
    name: string
    targetChannels?: string[]
    targetTags?: string[]
    targetLanguages?: string[]
    encryptedContent?: string
    contentEnvelopes?: unknown[]
    status?: string
  }
  const blast = await services.blasts.createBlast({
    hubId: hubId ?? 'global',
    name: body.name,
    targetChannels: body.targetChannels,
    targetTags: body.targetTags,
    targetLanguages: body.targetLanguages,
    encryptedContent: body.encryptedContent,
    status: body.status,
  })
  return c.json({ blast }, 201)
})

blasts.get('/:id', async (c) => {
  const id = c.req.param('id')
  const services = c.get('services')
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  return c.json({ blast })
})

blasts.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const services = c.get('services')
  const body = await c.req.json()
  const updated = await services.blasts.updateBlast(
    id,
    body as Parameters<typeof services.blasts.updateBlast>[1]
  )
  return c.json({ blast: updated })
})

blasts.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const services = c.get('services')
  await services.blasts.deleteBlast(id)
  return c.json({ ok: true })
})

blasts.post('/:id/send', async (c) => {
  const id = c.req.param('id')
  const services = c.get('services')
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  if (blast.status !== 'draft' && blast.status !== 'scheduled') {
    return c.json({ error: 'Blast cannot be sent in its current state' }, 400)
  }
  // Mark as sent — actual message delivery is handled by a background worker/cron
  const updated = await services.blasts.updateBlast(id, {
    status: 'sending',
    sentAt: new Date(),
  })
  return c.json({ blast: updated })
})

blasts.post('/:id/schedule', async (c) => {
  const id = c.req.param('id')
  const services = c.get('services')
  const body = (await c.req.json()) as { scheduledAt?: string }
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  if (blast.status !== 'draft') {
    return c.json({ error: 'Only draft blasts can be scheduled' }, 400)
  }
  if (!body.scheduledAt) {
    return c.json({ error: 'scheduledAt is required' }, 400)
  }
  const updated = await services.blasts.updateBlast(id, {
    status: 'scheduled',
    scheduledAt: new Date(body.scheduledAt),
  })
  return c.json({ blast: updated })
})

blasts.post('/:id/cancel', async (c) => {
  const id = c.req.param('id')
  const services = c.get('services')
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  const updated = await services.blasts.updateBlast(id, { status: 'cancelled' })
  return c.json({ blast: updated })
})

// --- Settings (blast subscribe/unsubscribe keywords, stored in MessagingConfig) ---
blasts.get('/settings', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const config = await services.settings.getMessagingConfig(hubId ?? undefined)
  // Expose blast-relevant settings only
  return c.json({
    subscribeKeyword:
      (config as typeof config & { subscribeKeyword?: string }).subscribeKeyword ?? 'JOIN',
    autoRespond: (config as typeof config & { autoRespond?: boolean }).autoRespond ?? false,
  })
})

blasts.patch('/settings', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = await c.req.json()
  // Merge blast settings into MessagingConfig
  const updated = await services.settings.updateMessagingConfig(
    body as Parameters<typeof services.settings.updateMessagingConfig>[0],
    hubId ?? undefined
  )
  return c.json(updated)
})

export default blasts
