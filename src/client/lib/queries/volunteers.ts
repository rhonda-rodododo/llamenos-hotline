/**
 * React Query hooks for volunteer resource management.
 *
 * All list/detail queries decrypt PII fields via the crypto worker
 * when the key manager is unlocked. Mutations invalidate the full
 * volunteers cache on success.
 */

import {
  type Volunteer,
  createVolunteer,
  deleteVolunteer,
  getVolunteerUnmasked,
  listVolunteers,
  updateVolunteer,
} from '@/lib/api'
import { decryptArrayFields, decryptObjectFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// useVolunteers
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt the full volunteer list.
 * Returns already-decrypted Volunteer objects — no further decryption needed
 * by consumers (e.g. VolunteerMultiSelect).
 */
export function useVolunteers() {
  return useQuery({
    queryKey: queryKeys.volunteers.list(),
    queryFn: async () => {
      const { volunteers } = await listVolunteers()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          volunteers as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_VOLUNTEER_PII
        )
      }
      return volunteers
    },
  })
}

// ---------------------------------------------------------------------------
// useVolunteer
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt a single volunteer's unmasked data (admin only).
 */
export function useVolunteer(pubkey: string) {
  return useQuery({
    queryKey: queryKeys.volunteers.detail(pubkey),
    queryFn: async () => {
      const { volunteer } = await getVolunteerUnmasked(pubkey)
      const readerPubkey = await keyManager.getPublicKeyHex()
      if (readerPubkey && (await keyManager.isUnlocked())) {
        await decryptObjectFields(
          volunteer as unknown as Record<string, unknown>,
          readerPubkey,
          LABEL_VOLUNTEER_PII
        )
      }
      return volunteer
    },
    enabled: !!pubkey,
  })
}

// ---------------------------------------------------------------------------
// useCreateVolunteer
// ---------------------------------------------------------------------------

export function useCreateVolunteer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createVolunteer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.volunteers.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateVolunteer
// ---------------------------------------------------------------------------

export function useUpdateVolunteer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      pubkey,
      data,
    }: { pubkey: string; data: Parameters<typeof updateVolunteer>[1] }) =>
      updateVolunteer(pubkey, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.volunteers.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteVolunteer
// ---------------------------------------------------------------------------

export function useDeleteVolunteer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pubkey: string) => deleteVolunteer(pubkey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.volunteers.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export Volunteer type for convenience
// ---------------------------------------------------------------------------
export type { Volunteer }
