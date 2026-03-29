/**
 * React Query hooks for notes resource management.
 *
 * Notes have special per-note ECIES decryption:
 *   - Regular notes: decrypted via authorEnvelope (volunteer) or adminEnvelopes (admin)
 *   - Transcriptions: decrypted via decryptTranscription + ephemeralPubkey
 *
 * Role-based filtering:
 *   - system:transcription:admin → admins only
 *   - system:transcription       → non-admins only
 *   - All other notes            → always visible
 */

import {
  type CustomFieldDefinition,
  type EncryptedNote,
  createNote,
  getCustomFields,
  listNotes,
  updateNote,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptNoteV2, decryptTranscription } from '@/lib/crypto'
import * as keyManager from '@/lib/key-manager'
import type { NotePayload } from '@shared/types'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecryptedNote extends EncryptedNote {
  decrypted: string
  payload: NotePayload
  isTranscription: boolean
}

type NoteFilters = {
  callId?: string
  page?: number
  limit?: number
}

type NotesAuth = {
  isAdmin: boolean
  publicKey: string | null
  hasNsec: boolean
}

// ---------------------------------------------------------------------------
// notesListOptions
// ---------------------------------------------------------------------------

/**
 * queryOptions factory for the notes list.
 * auth values must be passed explicitly (extracted from useAuth() in the hook wrapper)
 * since queryOptions cannot call React hooks.
 */
export const notesListOptions = (filters: NoteFilters | undefined, auth: NotesAuth) =>
  queryOptions({
    queryKey: queryKeys.notes.list(filters),
    queryFn: async (): Promise<{ notes: DecryptedNote[]; total: number }> => {
      const { isAdmin, publicKey, hasNsec } = auth
      const res = await listNotes(filters)
      const unlocked = await keyManager.isUnlocked()

      const filtered = (res.notes ?? []).filter((note) => {
        if (note.authorPubkey === 'system:transcription:admin') return isAdmin
        if (note.authorPubkey === 'system:transcription') return !isAdmin
        return true
      })

      const decryptedNotes: DecryptedNote[] = []
      for (const note of filtered) {
        const isTranscription = note.authorPubkey.startsWith('system:transcription')
        let payload: NotePayload

        if (isTranscription && note.ephemeralPubkey && hasNsec && unlocked) {
          const text =
            (await decryptTranscription(note.encryptedContent, note.ephemeralPubkey)) ||
            '[Decryption failed]'
          payload = { text }
        } else if (isTranscription && !note.ephemeralPubkey) {
          payload = { text: note.encryptedContent }
        } else if (hasNsec && unlocked) {
          const myPubkey = publicKey!
          const envelope = isAdmin
            ? (note.adminEnvelopes?.find((e) => e.pubkey === myPubkey) ?? note.adminEnvelopes?.[0])
            : note.authorEnvelope
          if (envelope) {
            payload = (await decryptNoteV2(note.encryptedContent, envelope)) || {
              text: '[Decryption failed]',
            }
          } else {
            payload = { text: '[Decryption failed]' }
          }
        } else {
          payload = { text: '[No key]' }
        }

        decryptedNotes.push({ ...note, decrypted: payload.text, payload, isTranscription })
      }

      return { notes: decryptedNotes, total: res.total }
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

// ---------------------------------------------------------------------------
// useNotes
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt the notes list with optional filters.
 *
 * Replicates the exact decryption + role-based filtering logic from the
 * legacy `loadNotes` callback in notes.tsx:
 *   - Admins see system:transcription:admin notes; non-admins see system:transcription
 *   - Transcriptions with ephemeralPubkey are ECIES-decrypted via decryptTranscription
 *   - Transcriptions without ephemeralPubkey use encryptedContent as plain text
 *   - Regular notes: admin looks up their envelope in adminEnvelopes, volunteer uses authorEnvelope
 */
export function useNotes(filters?: NoteFilters) {
  const { hasNsec, publicKey, isAdmin } = useAuth()
  return useQuery(notesListOptions(filters, { isAdmin, publicKey, hasNsec }))
}

// ---------------------------------------------------------------------------
// customFieldsOptions
// ---------------------------------------------------------------------------

export const customFieldsOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings.customFields(),
    queryFn: async (): Promise<CustomFieldDefinition[]> => {
      const res = await getCustomFields()
      return res.fields ?? []
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  })

// ---------------------------------------------------------------------------
// useCustomFields
// ---------------------------------------------------------------------------

/**
 * Fetch custom field definitions from settings.
 */
export function useCustomFields() {
  return useQuery(customFieldsOptions())
}

// ---------------------------------------------------------------------------
// useCreateNote
// ---------------------------------------------------------------------------

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateNote
// ---------------------------------------------------------------------------

export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateNote>[1] }) =>
      updateNote(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { CustomFieldDefinition, EncryptedNote }
