import { Hono } from 'hono'
import type { AppEnv } from '../types'

declare const __BUILD_VERSION__: string

const health = new Hono<AppEnv>()

interface HealthResult {
  status: 'ok' | 'degraded'
  checks: Record<string, 'ok' | 'failing'>
  details: Record<string, string>
}

async function runChecks(env: Record<string, unknown>): Promise<HealthResult> {
  const checks: Record<string, 'ok' | 'failing'> = {}
  const details: Record<string, string> = {}

  // PostgreSQL check (Node.js self-hosted only — CF Workers use Durable Objects)
  const isNode = typeof process !== 'undefined' && process.env?.PLATFORM === 'node'
  if (isNode) {
    try {
      const { getPool } = await import('../../../src/platform/node/storage/postgres-pool')
      const sql = getPool()
      await sql`SELECT 1`
      checks.postgres = 'ok'
    } catch (err) {
      checks.postgres = 'failing'
      details.postgres = err instanceof Error ? err.message : 'Connection failed'
    }
  }

  // Blob storage check (R2 on CF, MinIO on Node.js)
  if (env.R2_BUCKET) {
    checks.storage = 'ok'
  } else {
    checks.storage = 'failing'
    details.storage = 'Blob storage not configured'
  }

  // Nostr relay configuration check
  // Actual connectivity is verified by strfry's own healthcheck in Docker/K8s
  if (env.NOSTR_RELAY_URL) {
    checks.relay = 'ok'
  } else {
    checks.relay = 'failing'
    details.relay = 'NOSTR_RELAY_URL not configured'
  }

  const status = Object.values(checks).every(v => v === 'ok') ? 'ok' : 'degraded'
  return { status, checks, details }
}

// Full health check — dependency status
health.get('/', async (c) => {
  const { status, checks, details } = await runChecks(c.env as unknown as Record<string, unknown>)
  const hasDetails = Object.keys(details).length > 0

  return c.json({
    status,
    checks,
    ...(hasDetails && { details }),
    version: typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev',
    uptime: typeof process !== 'undefined' ? Math.floor(process.uptime()) : undefined,
  }, status === 'ok' ? 200 : 503)
})

// Kubernetes liveness probe — process is alive, always returns 200
health.get('/live', (c) => c.json({ status: 'ok' }))

// Kubernetes readiness probe — verifies all dependencies
health.get('/ready', async (c) => {
  const { status, checks, details } = await runChecks(c.env as unknown as Record<string, unknown>)
  const hasDetails = Object.keys(details).length > 0

  return c.json({
    status,
    checks,
    ...(hasDetails && { details }),
    version: typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev',
  }, status === 'ok' ? 200 : 503)
})

export default health
