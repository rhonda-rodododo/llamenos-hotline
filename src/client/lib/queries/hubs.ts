/**
 * React Query hooks for hub resource management.
 *
 * Hubs are configuration objects — names are hub-encrypted but the
 * decryption happens client-side via decryptHubField at render time.
 * Cache is long-lived (10 min) since hubs rarely change.
 * Mutations invalidate the full hubs cache on success.
 */

import { type Hub, archiveHub, createHub, deleteHub, listHubs, updateHub } from '@/lib/api'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// hubsListOptions
// ---------------------------------------------------------------------------

export const hubsListOptions = () =>
  queryOptions({
    queryKey: queryKeys.hubs.list(),
    queryFn: async () => {
      const { hubs } = await listHubs()
      return hubs
    },
    staleTime: 10 * 60 * 1000,
  })

// ---------------------------------------------------------------------------
// useHubs
// ---------------------------------------------------------------------------

export function useHubs() {
  return useQuery(hubsListOptions())
}

// ---------------------------------------------------------------------------
// useCreateHub
// ---------------------------------------------------------------------------

export function useCreateHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; description?: string; phoneNumber?: string }) =>
      createHub(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateHub
// ---------------------------------------------------------------------------

export function useUpdateHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Hub> }) => updateHub(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteHub
// ---------------------------------------------------------------------------

export function useDeleteHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteHub(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useArchiveHub
// ---------------------------------------------------------------------------

export function useArchiveHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => archiveHub(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { Hub }
