/**
 * React Query hooks for role definitions.
 *
 * Roles are not encrypted PII — they are configuration data
 * readable by all authenticated users. Cache is long-lived since
 * roles rarely change.
 */

import {
  type RoleDefinition,
  createRole,
  deleteRole,
  getPermissionsCatalog,
  listRoles,
  updateRole,
} from '@/lib/api'
import type { Ciphertext } from '@shared/crypto-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
// usePermissionsCatalog
// ---------------------------------------------------------------------------

export function usePermissionsCatalog() {
  return useQuery({
    queryKey: queryKeys.roles.permissions(),
    queryFn: getPermissionsCatalog,
    staleTime: 5 * 60 * 1000,
  })
}

// ---------------------------------------------------------------------------
// useCreateRole
// ---------------------------------------------------------------------------

export function useCreateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      slug: string
      permissions: string[]
      description: string
      encryptedName?: Ciphertext
      encryptedDescription?: Ciphertext
    }) => createRole(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateRole
// ---------------------------------------------------------------------------

export function useUpdateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Partial<{
        name: string
        permissions: string[]
        description: string
        encryptedName: Ciphertext
        encryptedDescription: Ciphertext
      }>
    }) => updateRole(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteRole
// ---------------------------------------------------------------------------

export function useDeleteRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { RoleDefinition }
