import { Hono } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from '../types'
import { getScopedDOs } from '../lib/do-access'
import { validateBody, validateQuery } from '../middleware/validate'
import { listBlastsQuerySchema, createBlastBodySchema, updateBlastBodySchema, scheduleBlastBodySchema } from '../schemas/blasts'

const blasts = new Hono<AppEnv>()

// Forward all blast routes to BlastDO
// These are hub-scoped and require authentication (handled by middleware in app.ts)

// --- Subscribers ---
blasts.get('/subscribers', async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const url = new URL(c.req.url)
  const res = await dos.blasts.fetch(new Request(`http://do/subscribers${url.search}`))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.delete('/subscribers/:id', async (c) => {
  const id = c.req.param('id')
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const res = await dos.blasts.fetch(new Request(`http://do/subscribers/${id}`, { method: 'DELETE' }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.get('/subscribers/stats', async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const res = await dos.blasts.fetch(new Request('http://do/subscribers/stats'))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.post('/subscribers/import', async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const body = await c.req.text()
  const res = await dos.blasts.fetch(new Request('http://do/subscribers/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

// --- Blasts ---
blasts.get('/', validateQuery(listBlastsQuerySchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const query = c.get('validatedQuery') as z.infer<typeof listBlastsQuerySchema>
  const params = new URLSearchParams()
  params.set('page', String(query.page))
  params.set('limit', String(query.limit))
  if (query.status) params.set('status', query.status)
  const res = await dos.blasts.fetch(new Request(`http://do/blasts?${params}`))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.post('/', validateBody(createBlastBodySchema), async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const body = c.get('validatedBody') as z.infer<typeof createBlastBodySchema>
  const res = await dos.blasts.fetch(new Request('http://do/blasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.get('/:id', async (c) => {
  const id = c.req.param('id')
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const res = await dos.blasts.fetch(new Request(`http://do/blasts/${id}`))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.patch('/:id', validateBody(updateBlastBodySchema), async (c) => {
  const id = c.req.param('id')
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const body = c.get('validatedBody') as z.infer<typeof updateBlastBodySchema>
  const res = await dos.blasts.fetch(new Request(`http://do/blasts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const res = await dos.blasts.fetch(new Request(`http://do/blasts/${id}`, { method: 'DELETE' }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.post('/:id/send', async (c) => {
  const id = c.req.param('id')
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const res = await dos.blasts.fetch(new Request(`http://do/blasts/${id}/send`, { method: 'POST' }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.post('/:id/schedule', validateBody(scheduleBlastBodySchema), async (c) => {
  const id = c.req.param('id')
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const body = c.get('validatedBody') as z.infer<typeof scheduleBlastBodySchema>
  const res = await dos.blasts.fetch(new Request(`http://do/blasts/${id}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.post('/:id/cancel', async (c) => {
  const id = c.req.param('id')
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const res = await dos.blasts.fetch(new Request(`http://do/blasts/${id}/cancel`, { method: 'POST' }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

// --- Settings ---
blasts.get('/settings', async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const res = await dos.blasts.fetch(new Request('http://do/blast-settings'))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

blasts.patch('/settings', async (c) => {
  const dos = getScopedDOs(c.env, c.get('hubId'))
  const body = await c.req.text()
  const res = await dos.blasts.fetch(new Request('http://do/blast-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  }))
  return new Response(res.body, { status: res.status, headers: res.headers })
})

export default blasts
