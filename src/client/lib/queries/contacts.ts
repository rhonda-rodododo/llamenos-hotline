/**
 * React Query hooks for contact directory management.
 *
 * List queries decrypt display name fields via the crypto worker
 * when the key manager is unlocked. Mutations invalidate the full
 * contacts cache on success.
 */

import { type ContactRecord, createContact, listContacts, updateContact } from '@/lib/api'
import { decryptArrayFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// useContacts
// ---------------------------------------------------------------------------

type ContactFilters = {
  contactType?: string
  riskLevel?: string
}

/**
 * Fetch and decrypt the contact list with optional filters.
 * Decrypts encryptedDisplayName -> displayName via LABEL_CONTACT_SUMMARY.
 */
export function useContacts(filters?: ContactFilters) {
  return useQuery({
    queryKey: queryKeys.contacts.list(filters),
    queryFn: async () => {
      const { contacts } = await listContacts(filters)
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          contacts as unknown as Record<string, unknown>[],
          pubkey,
          LABEL_CONTACT_SUMMARY
        )
      }
      return contacts
    },
  })
}

// ---------------------------------------------------------------------------
// useCreateContact
// ---------------------------------------------------------------------------

export function useCreateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateContact
// ---------------------------------------------------------------------------

export function useUpdateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateContact(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { ContactRecord }
