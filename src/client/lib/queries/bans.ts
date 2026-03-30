/**
 * React Query hooks for ban list resource management.
 *
 * Ban entries contain HMAC-encrypted phone numbers. Mutations
 * invalidate the full bans cache on success.
 */

import { type BanEntry, addBan, bulkAddBans, listBans, removeBan } from '@/lib/api'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
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
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        // Ban phone/reason fields use LABEL_VOLUNTEER_PII envelope encryption
        await decryptArrayFields(
          bans as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_VOLUNTEER_PII
        )
      }
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
