import type { ConnectionTestResult, MessagingChannelType } from '@shared/types'

export interface HealthCheckResult {
  provider: string
  channel?: MessagingChannelType
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  lastCheck: string
  consecutiveFailures: number
  error?: string
}

export interface ProviderHealthStatus {
  telephony: HealthCheckResult | null
  messaging: Record<string, HealthCheckResult>
  lastFullCheck: string
}

interface Checkable {
  testConnection(): Promise<ConnectionTestResult>
}

const DOWN_THRESHOLD = 3

export class ProviderHealthService {
  private results = new Map<string, HealthCheckResult>()
  private failures = new Map<string, number>()
  private interval: ReturnType<typeof setInterval> | null = null

  async checkProvider(
    category: string,
    name: string,
    adapter: Checkable
  ): Promise<HealthCheckResult> {
    const key = `${category}:${name}`
    const testResult = await adapter.testConnection()
    const consecutiveFailures = testResult.connected ? 0 : (this.failures.get(key) ?? 0) + 1
    this.failures.set(key, consecutiveFailures)

    const result: HealthCheckResult = {
      provider: name,
      status: testResult.connected
        ? 'healthy'
        : consecutiveFailures >= DOWN_THRESHOLD
          ? 'down'
          : 'degraded',
      latencyMs: testResult.latencyMs,
      lastCheck: new Date().toISOString(),
      consecutiveFailures,
      error: testResult.error,
    }

    const prev = this.results.get(key)
    if (prev && prev.status !== result.status) {
      if (result.status === 'down')
        console.error(
          `[health] ERROR: ${name} DOWN — ${consecutiveFailures} consecutive failures: ${result.error}`
        )
      else if (result.status === 'degraded')
        console.warn(
          `[health] WARNING: ${name} connection failed (${consecutiveFailures}/${DOWN_THRESHOLD}): ${result.error}`
        )
      else console.log(`[health] ${name} recovered — now healthy (${result.latencyMs}ms)`)
    }

    this.results.set(key, result)
    return result
  }

  getHealthStatus(): ProviderHealthStatus {
    const telephony = this.results.get('telephony:active') ?? null
    const messaging: Record<string, HealthCheckResult> = {}
    for (const [key, result] of this.results) {
      if (key.startsWith('messaging:')) messaging[key.replace('messaging:', '')] = result
    }
    return { telephony, messaging, lastFullCheck: new Date().toISOString() }
  }

  start(checkFn: () => Promise<void>, intervalMs = 60_000): void {
    this.stop()
    checkFn().catch((err) => console.error('[health] Initial check failed:', err))
    this.interval = setInterval(() => {
      checkFn().catch((err) => console.error('[health] Check failed:', err))
    }, intervalMs)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }
}
