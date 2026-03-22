import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import type { VolunteerStatEntry } from '@/lib/api'

interface Props {
  data: VolunteerStatEntry[]
  loading: boolean
}

export function VolunteerStatsTable({ data, loading }: Props) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="space-y-2" data-testid="volunteer-stats-skeleton">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground" data-testid="volunteer-stats-no-data">
        {t('dashboard.analytics.noData')}
      </p>
    )
  }

  const sorted = [...data].sort((a, b) => b.callsAnswered - a.callsAnswered)

  return (
    <div className="overflow-x-auto" data-testid="volunteer-stats-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">{t('volunteers.title', { defaultValue: 'Volunteer' })}</th>
            <th className="pb-2 text-right font-medium">{t('dashboard.analytics.answered')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((row) => (
            <tr key={row.pubkey} className="py-2">
              <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                {row.pubkey.slice(0, 16)}…
              </td>
              <td className="py-2 text-right font-medium">{row.callsAnswered}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
