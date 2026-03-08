import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'
import { authenticateRequest, parseAuthHeader, parseSessionHeader } from '../lib/auth'
import { getDOs } from '../lib/do-access'
import type { Role } from '@shared/permissions'
import { resolvePermissions } from '@shared/permissions'
import { createLogger } from '../lib/logger'
import { incError } from '../lib/error-counter'

const log = createLogger('auth')

export const auth = createMiddleware<AppEnv>(async (c, next) => {
  const dos = getDOs(c.env)
  const requestId = c.get('requestId')
  const reqLog = requestId ? log.child({ requestId }) : log

  const authResult = await authenticateRequest(c.req.raw, dos.identity)
  if (!authResult) {
    // Log auth failure with minimal non-PII info
    const authHeader = c.req.header('Authorization') ?? null
    const authPayload = parseAuthHeader(authHeader)
    const sessionToken = parseSessionHeader(authHeader)

    const pubkeyPrefix = authPayload?.pubkey?.slice(0, 8) || undefined
    const method = c.req.method
    const path = new URL(c.req.url).pathname

    reqLog.warn('Auth failed', {
      reason: sessionToken ? 'invalid_session' : authPayload ? 'signature_verification_failed' : 'missing_credentials',
      pubkeyPrefix,
      method,
      path,
    })

    incError('auth')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Load all roles from SettingsDO (cached per-request)
  const rolesRes = await dos.settings.fetch(new Request('http://do/settings/roles'))
  const allRoles: Role[] = rolesRes.ok ? ((await rolesRes.json()) as { roles: Role[] }).roles : []

  // Resolve effective permissions from user's role IDs
  const permissions = resolvePermissions(authResult.volunteer.roles, allRoles)

  c.set('pubkey', authResult.pubkey)
  c.set('volunteer', authResult.volunteer)
  c.set('permissions', permissions)
  c.set('allRoles', allRoles)
  await next()
})
