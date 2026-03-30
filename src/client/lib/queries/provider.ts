/**
 * React Query hooks for telephony/messaging provider health monitoring.
 */

import { type ProviderHealthStatus, getProviderHealth } from '@/lib/api'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// providerHealthOptions
// ---------------------------------------------------------------------------

/**
 * Poll provider health every 30 seconds. staleTime matches the poll interval
 * so health data is always refetched from the server on each cycle.
 */
export const providerHealthOptions = () =>
  queryOptions({
    queryKey: queryKeys.provider.health(),
    queryFn: (): Promise<ProviderHealthStatus> => getProviderHealth(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

// ---------------------------------------------------------------------------
// useProviderHealth
// ---------------------------------------------------------------------------

export function useProviderHealth() {
  return useQuery(providerHealthOptions())
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { ProviderHealthStatus }
