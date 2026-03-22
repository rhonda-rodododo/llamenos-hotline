import { Hono } from 'hono'
import { BUILD_VERSION } from '../lib/build-constants'
import type { AppEnv } from '../types'

const health = new Hono<AppEnv>()

interface BackupStatus {
  lastSuccessAt: string
  lastSizeBytes: number
  file: string
}

interface HealthResult {
  status: 'ok' | 'degraded'
  checks: Record<string, 'ok' | 'failing'>
  details: Record<string, string>
  backup?: BackupStatus
}

async function readBackupStatus(): Promise<BackupStatus | undefined> {
  try {
    const text = await Bun.file('/var/data/backup-status.json').text()
    return JSON.parse(text) as BackupStatus
  } catch {
    return undefined
  }
}

async function runChecks(): Promise<HealthResult> {
  const checks: Record<string, 'ok' | 'failing'> = {}
  const details: Record<string, string> = {}

  // PostgreSQL check — verify DB connection via Drizzle
  try {
    const { getDb } = await import('../db')
    const db = getDb()
    await db.execute('SELECT 1')
    checks.postgres = 'ok'
  } catch (err) {
    checks.postgres = 'failing'
    details.postgres = err instanceof Error ? err.message : 'Connection failed'
  }

  // Blob storage check — verify MinIO bucket exists and is accessible
  try {
    const { HeadBucketCommand, S3Client } = await import('@aws-sdk/client-s3')
    // MinIO credentials come from process.env (Bun server), not Hono bindings
    const endpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9000'
    const accessKeyId = process.env.MINIO_APP_USER || process.env.MINIO_ACCESS_KEY
    const secretAccessKey = process.env.MINIO_APP_PASSWORD || process.env.MINIO_SECRET_KEY
    const bucket = process.env.MINIO_BUCKET || 'llamenos-files'

    if (!accessKeyId || !secretAccessKey) {
      checks.storage = 'failing'
      details.storage = 'MinIO credentials not configured'
    } else {
      const s3 = new S3Client({
        endpoint,
        region: 'us-east-1',
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      })
      await s3.send(new HeadBucketCommand({ Bucket: bucket }))
      checks.storage = 'ok'
    }
  } catch (err) {
    checks.storage = 'failing'
    const msg = err instanceof Error ? err.message : String(err)
    details.storage = msg.includes('NoSuchBucket') ? 'bucket_missing' : 'unreachable'
  }

  // Nostr relay configuration check
  // Actual connectivity is verified by strfry's own healthcheck in Docker/K8s
  if (process.env.NOSTR_RELAY_URL) {
    checks.relay = 'ok'
  } else {
    checks.relay = 'failing'
    details.relay = 'NOSTR_RELAY_URL not configured'
  }

  const status = Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded'
  return { status, checks, details }
}

// Full health check — dependency status
health.get('/', async (c) => {
  const [{ status, checks, details }, backup] = await Promise.all([
    runChecks(),
    readBackupStatus(),
  ])
  const hasDetails = Object.keys(details).length > 0

  return c.json(
    {
      status,
      checks,
      ...(hasDetails && { details }),
      ...(backup && { backup }),
      version: BUILD_VERSION,
      uptime: typeof process !== 'undefined' ? Math.floor(process.uptime()) : undefined,
    },
    status === 'ok' ? 200 : 503
  )
})

// Kubernetes liveness probe — process is alive, always returns 200
health.get('/live', (c) => c.json({ status: 'ok' }))

// Kubernetes readiness probe — verifies all dependencies
health.get('/ready', async (c) => {
  const { status, checks, details } = await runChecks()
  const hasDetails = Object.keys(details).length > 0

  return c.json(
    {
      status,
      checks,
      ...(hasDetails && { details }),
      version: BUILD_VERSION,
    },
    status === 'ok' ? 200 : 503
  )
})

export default health
