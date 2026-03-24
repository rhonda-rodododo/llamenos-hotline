import { type HealthCheckResult, type ProviderHealthStatus, getProviderHealth } from '@/lib/api'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const POLL_INTERVAL = 30_000

function StatusDot({ status }: { status: HealthCheckResult['status'] }) {
  const colors: Record<string, string> = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
  }
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${colors[status] ?? 'bg-gray-400'}`}
      aria-hidden="true"
    />
  )
}

function HealthEntry({ result }: { result: HealthCheckResult }) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusDot status={result.status} />
      <span className="font-medium capitalize">{result.provider}</span>
      {result.status === 'healthy' && (
        <span className="text-muted-foreground">{result.latencyMs}ms</span>
      )}
      {result.status === 'degraded' && (
        <span className="text-yellow-600 dark:text-yellow-400">
          {t('settings.health.degraded', 'Degraded')}
        </span>
      )}
      {result.status === 'down' && (
        <span className="text-red-600 dark:text-red-400">
          {t('settings.health.down', 'Down')} ({result.consecutiveFailures}{' '}
          {t('settings.health.failures', 'failures')})
        </span>
      )}
    </div>
  )
}

export function ProviderHealthBadge() {
  const { t } = useTranslation()
  const [health, setHealth] = useState<ProviderHealthStatus | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      const data = await getProviderHealth()
      setHealth(data)
    } catch {
      // Silently ignore — badge just won't display
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const id = setInterval(fetchHealth, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchHealth])

  if (!health) return null

  const hasAny = health.telephony || Object.keys(health.messaging).length > 0
  if (!hasAny) return null

  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
        {t('settings.health.title', 'Provider Health')}
      </h4>
      {health.telephony && <HealthEntry result={health.telephony} />}
      {Object.values(health.messaging).map((r) => (
        <HealthEntry key={r.provider} result={r} />
      ))}
    </div>
  )
}
