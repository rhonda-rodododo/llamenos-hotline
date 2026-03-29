/**
 * React Query hooks for ban list resource management.
 *
 * Ban entries contain HMAC-encrypted phone numbers. Mutations
 * invalidate the full bans cache on success.
 */

import { type BanEntry, addBan, bulkAddBans, listBans, removeBan } from '@/lib/api'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// bansListOptions
// ---------------------------------------------------------------------------

export const bansListOptions = () =>
  queryOptions({
    queryKey: queryKeys.bans.list(),
    queryFn: async () => {
      const { bans } = await listBans()
      return bans
    },
  })

// ---------------------------------------------------------------------------
// useBans
// ---------------------------------------------------------------------------

export function useBans() {
  return useQuery(bansListOptions())
}

// ---------------------------------------------------------------------------
// useAddBan
// ---------------------------------------------------------------------------

export function useAddBan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ phone, reason }: { phone: string; reason: string }) => addBan({ phone, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useBulkAddBans
// ---------------------------------------------------------------------------

export function useBulkAddBans() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ phones, reason }: { phones: string[]; reason: string }) =>
      bulkAddBans({ phones, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useRemoveBan
// ---------------------------------------------------------------------------

export function useRemoveBan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (phone: string) => removeBan(phone),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { BanEntry }
