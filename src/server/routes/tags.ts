import type { Ciphertext } from '@shared/crypto-types'
import { Hono } from 'hono'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const tags = new Hono<AppEnv>()

// GET /tags — list tags for hub (any authenticated user with contact read access)
tags.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const tagsList = await services.tags.listTags(hubId)
  return c.json({ tags: tagsList })
})

// POST /tags — create tag (requires tags:create or settings:manage-fields)
tags.post('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  if (
    !checkPermission(permissions, 'tags:create') &&
    !checkPermission(permissions, 'settings:manage-fields')
  ) {
    return c.json({ error: 'Forbidden', required: 'tags:create' }, 403)
  }

  const body = await c.req.json<{
    name: string
    encryptedLabel: Ciphertext
    color?: string
    encryptedCategory?: Ciphertext
  }>()

  if (!body.name || !body.encryptedLabel) {
    return c.json({ error: 'name and encryptedLabel are required' }, 400)
  }

  // Check if strictTags prevents this user from creating (admins with settings:manage-fields bypass)
  if (!checkPermission(permissions, 'settings:manage-fields')) {
    const strict = await services.tags.isStrictTags(hubId)
    if (strict) {
      return c.json({ error: 'Tag creation is restricted — strictTags is enabled' }, 403)
    }
  }

  try {
    const tag = await services.tags.createTag({
      hubId,
      name: body.name,
      encryptedLabel: body.encryptedLabel,
      color: body.color,
      encryptedCategory: body.encryptedCategory ?? null,
      createdBy: pubkey ?? '',
    })
    return c.json({ tag }, 201)
  } catch (err: unknown) {
    // Unique constraint violation
    if (err instanceof Error && err.message.includes('unique')) {
      return c.json({ error: 'Tag already exists' }, 409)
    }
    throw err
  }
})

// PATCH /tags/:id — update tag (requires settings:manage-fields)
tags.patch('/:id', requirePermission('settings:manage-fields'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const body = await c.req.json<{
    encryptedLabel?: Ciphertext
    color?: string
    encryptedCategory?: Ciphertext | null
  }>()

  const tag = await services.tags.updateTag(id, hubId, body)
  if (!tag) return c.json({ error: 'Tag not found' }, 404)
  return c.json({ tag })
})

// DELETE /tags/:id — delete tag (requires settings:manage-fields)
tags.delete('/:id', requirePermission('settings:manage-fields'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  // Get usage count before deleting
  const usageCount = await services.tags.getTagUsageCount(id, hubId)
  const deleted = await services.tags.deleteTag(id, hubId)
  if (!deleted) return c.json({ error: 'Tag not found' }, 404)
  return c.json({ ok: true, removedFromContacts: usageCount })
})

export default tags
