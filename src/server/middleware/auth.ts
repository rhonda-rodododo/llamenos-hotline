import { createMiddleware } from 'hono/factory'
import type { Role } from '../../shared/permissions'
import { resolvePermissions } from '../../shared/permissions'
import { authenticateRequest } from '../lib/auth'
import type { AppEnv } from '../types'

export const auth = createMiddleware<AppEnv>(async (c, next) => {
  const services = c.get('services')
  const authResult = await authenticateRequest(c.req.raw, services.identity)
  if (!authResult) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Load all roles from SettingsService (cached per-request)
  const allRoles: Role[] = await services.settings.listRoles()

  // Resolve effective permissions from user's role IDs
  const permissions = resolvePermissions(authResult.volunteer.roles, allRoles)

  c.set('pubkey', authResult.pubkey)
  c.set('volunteer', authResult.volunteer)
  c.set('permissions', permissions)
  c.set('allRoles', allRoles)
  await next()
})
