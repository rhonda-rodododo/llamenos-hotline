import { createMiddleware } from 'hono/factory'
import type { AppEnv, UserRole } from '../types'

/**
 * Creates a middleware that restricts access to specific roles.
 * Usage: roleGuard('admin', 'volunteer') — allows admin or volunteer, blocks reporter
 */
export function roleGuard(...allowedRoles: UserRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const role = c.get('role')
    if (!allowedRoles.includes(role)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    await next()
  })
}

/** Blocks reporters — only admin and volunteer can access */
export const volunteerOrAdminGuard = roleGuard('admin', 'volunteer')

/** Only reporters and admins can access */
export const reporterOrAdminGuard = roleGuard('admin', 'reporter')
