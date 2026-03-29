/**
 * React Query hooks for call resource management.
 *
 * Call records have admin-only envelope-encrypted metadata
 * (answeredBy, callerNumber) decrypted client-side via ECIES.
 */

import { type CallRecord, getCallHistory } from '@/lib/api'
import { decryptCallRecord } from '@/lib/crypto'
import * as keyManager from '@/lib/key-manager'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// useCallHistory
// ---------------------------------------------------------------------------

type CallHistoryFilters = {
  page?: number
  limit?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  voicemailOnly?: boolean
}

/**
 * Fetch call history with optional filters. Decrypts encrypted call record
 * metadata (answeredBy, callerNumber) via admin ECIES envelopes when unlocked.
 */
export function useCallHistory(filters?: CallHistoryFilters) {
  return useQuery({
    queryKey: queryKeys.calls.history(filters),
    queryFn: async (): Promise<{ calls: CallRecord[]; total: number }> => {
      const res = await getCallHistory(filters)
      const pubkey = await keyManager.getPublicKeyHex()
      const unlocked = pubkey ? await keyManager.isUnlocked() : false

      if (!pubkey || !unlocked) return res

      const decrypted: CallRecord[] = []
      for (const call of res.calls) {
        if (call.answeredBy !== undefined) {
          decrypted.push(call)
          continue
        }
        if (!call.encryptedContent || !call.adminEnvelopes?.length) {
          decrypted.push(call)
          continue
        }
        const meta = await decryptCallRecord(call.encryptedContent, call.adminEnvelopes, pubkey)
        if (meta) {
          decrypted.push({ ...call, answeredBy: meta.answeredBy, callerNumber: meta.callerNumber })
        } else {
          decrypted.push(call)
        }
      }

      return { calls: decrypted, total: res.total }
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export type for convenience
// ---------------------------------------------------------------------------
export type { CallRecord }
