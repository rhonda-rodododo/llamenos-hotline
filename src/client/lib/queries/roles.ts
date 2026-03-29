/**
 * React Query hooks for role definitions.
 *
 * Roles are not encrypted PII — they are configuration data
 * readable by all authenticated users. Cache is long-lived since
 * roles rarely change.
 */

import { type RoleDefinition, listRoles } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// useRoles
// ---------------------------------------------------------------------------

/**
 * Fetch the list of role definitions.
 * Stale for 5 minutes since roles change infrequently.
 */
export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles.list(),
    queryFn: async () => {
      const { roles } = await listRoles()
      return roles
    },
    staleTime: 5 * 60 * 1000,
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { RoleDefinition }
