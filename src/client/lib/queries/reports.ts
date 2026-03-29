/**
 * React Query hooks for reports resource management.
 *
 * Reports use per-message envelope encryption (XChaCha20-Poly1305 + ECIES).
 * Message decryption is done client-side via decryptMessage() from crypto.ts.
 */

import {
  type ConversationMessage,
  type Report,
  type ReportType,
  assignReport,
  getReportCategories,
  getReportMessages,
  listReportTypes,
  listReports,
  sendReportMessage,
  updateReport,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptMessage } from '@/lib/crypto'
import * as keyManager from '@/lib/key-manager'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReportFilters = {
  status?: string
  category?: string
}

export interface DecryptedReportMessages {
  messages: ConversationMessage[]
  decryptedContent: Map<string, string>
}

// ---------------------------------------------------------------------------
// useReports
// ---------------------------------------------------------------------------

/**
 * Fetch the list of reports with optional filters.
 * Polls every 30s as a safety net alongside Nostr real-time events.
 */
export function useReports(filters?: ReportFilters) {
  const normalizedFilters: { status?: string; category?: string } = {}
  if (filters?.status && filters.status !== 'all') normalizedFilters.status = filters.status
  if (filters?.category && filters.category !== 'all') normalizedFilters.category = filters.category

  return useQuery({
    queryKey: queryKeys.reports.list(normalizedFilters),
    queryFn: async (): Promise<Report[]> => {
      const { conversations } = await listReports(normalizedFilters)
      return conversations
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

// ---------------------------------------------------------------------------
// useReportMessages
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt messages for a selected report.
 * Only enabled when a reportId is provided.
 * Returns messages + a Map of decrypted content keyed by message id.
 */
export function useReportMessages(reportId: string | null) {
  const { hasNsec, publicKey } = useAuth()

  return useQuery({
    queryKey: reportId ? queryKeys.reports.messages(reportId) : ['reports', 'messages', null],
    enabled: !!reportId,
    queryFn: async (): Promise<DecryptedReportMessages> => {
      if (!reportId) return { messages: [], decryptedContent: new Map() }

      const { messages } = await getReportMessages(reportId, { limit: 100 })
      const decryptedContent = new Map<string, string>()

      const unlocked = hasNsec && publicKey ? await keyManager.isUnlocked() : false
      if (unlocked && publicKey) {
        for (const msg of messages) {
          if (msg.encryptedContent && msg.readerEnvelopes?.length) {
            const plaintext = await decryptMessage(
              msg.encryptedContent,
              msg.readerEnvelopes,
              publicKey
            )
            if (plaintext !== null) {
              decryptedContent.set(msg.id, plaintext)
            }
          }
        }
      }

      return { messages, decryptedContent }
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
  })
}

// ---------------------------------------------------------------------------
// useSendReportMessage
// ---------------------------------------------------------------------------

/**
 * Mutation to send an encrypted message to a report thread.
 * Invalidates the messages cache for the specific report on success.
 */
export function useSendReportMessage(reportId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof sendReportMessage>[1]) =>
      sendReportMessage(reportId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.messages(reportId) })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateReport
// ---------------------------------------------------------------------------

/**
 * Mutation to update a report (e.g. close it).
 * Invalidates the full reports cache on success.
 */
export function useUpdateReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      reportId,
      data,
    }: { reportId: string; data: Parameters<typeof updateReport>[1] }) =>
      updateReport(reportId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useAssignReport
// ---------------------------------------------------------------------------

/**
 * Mutation to assign a report to a volunteer.
 * Invalidates the full reports cache on success.
 */
export function useAssignReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reportId, pubkey }: { reportId: string; pubkey: string }) =>
      assignReport(reportId, pubkey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    },
  })
}

// ---------------------------------------------------------------------------
// useReportCategories
// ---------------------------------------------------------------------------

/**
 * Fetch available report category strings.
 * Used by ReportForm to populate the category select.
 */
export function useReportCategories() {
  return useQuery({
    queryKey: ['reports', 'categories'] as const,
    queryFn: async (): Promise<string[]> => {
      const { categories } = await getReportCategories()
      return categories
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ---------------------------------------------------------------------------
// useReportTypes
// ---------------------------------------------------------------------------

/**
 * Fetch report type definitions (admin-configured).
 * Used by ReportForm to populate the report type select.
 */
export function useReportTypes() {
  return useQuery({
    queryKey: queryKeys.settings.reportTypes(),
    queryFn: async (): Promise<ReportType[]> => {
      const { reportTypes } = await listReportTypes()
      return reportTypes
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { ConversationMessage, Report, ReportType }
