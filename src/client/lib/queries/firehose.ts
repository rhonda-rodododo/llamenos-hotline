/**
 * React Query hooks for firehose connection management.
 *
 * Firehose connections use hub-key encryption for display names.
 * The query cache stores raw API responses; decryption happens in components
 * via decryptHubField() since display names are the only encrypted field.
 */

import {
  createFirehoseConnection,
  deleteFirehoseConnection,
  getFirehoseStatus,
  listFirehoseConnections,
  updateFirehoseConnection,
} from '@/lib/api'
import type {
  CreateFirehoseConnectionInput,
  FirehoseConnection,
  FirehoseConnectionHealth,
  UpdateFirehoseConnectionInput,
} from '@shared/schemas/firehose'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'

// ---------------------------------------------------------------------------
// firehoseConnectionsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch all firehose connections for the active hub.
 */
export const firehoseConnectionsOptions = () =>
  queryOptions({
    queryKey: queryKeys.firehose.list(),
    queryFn: async (): Promise<FirehoseConnection[]> => {
      const { connections } = await listFirehoseConnections()
      return connections
    },
    staleTime: 30_000,
  })

// ---------------------------------------------------------------------------
// useFirehoseConnections
// ---------------------------------------------------------------------------

export function useFirehoseConnections() {
  return useQuery(firehoseConnectionsOptions())
}

// ---------------------------------------------------------------------------
// firehoseStatusOptions
// ---------------------------------------------------------------------------

/**
 * Poll firehose health status every 30 seconds.
 */
export const firehoseStatusOptions = () =>
  queryOptions({
    queryKey: queryKeys.firehose.status(),
    queryFn: async (): Promise<FirehoseConnectionHealth[]> => {
      const { health } = await getFirehoseStatus()
      return health
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

// ---------------------------------------------------------------------------
// useFirehoseStatus
// ---------------------------------------------------------------------------

export function useFirehoseStatus() {
  return useQuery(firehoseStatusOptions())
}

// ---------------------------------------------------------------------------
// useCreateFirehoseConnection
// ---------------------------------------------------------------------------

/**
 * Mutation to create a new firehose connection.
 * Invalidates the connections list on success.
 */
export function useCreateFirehoseConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateFirehoseConnectionInput) => createFirehoseConnection(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateFirehoseConnection
// ---------------------------------------------------------------------------

/**
 * Mutation to update an existing firehose connection.
 * Invalidates the connections list and health status on success.
 */
export function useUpdateFirehoseConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFirehoseConnectionInput }) =>
      updateFirehoseConnection(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.status() })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteFirehoseConnection
// ---------------------------------------------------------------------------

/**
 * Mutation to delete a firehose connection.
 * Invalidates the connections list on success.
 */
export function useDeleteFirehoseConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteFirehoseConnection(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
    },
  })
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { FirehoseConnection, FirehoseConnectionHealth }
