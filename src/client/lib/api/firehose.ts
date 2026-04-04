import type {
  CreateFirehoseConnectionInput,
  FirehoseConnection,
  FirehoseConnectionHealth,
  UpdateFirehoseConnectionInput,
} from '@shared/schemas/firehose'
import { hp, request } from './client'

export type { FirehoseConnection, FirehoseConnectionHealth }

// ---------------------------------------------------------------------------
// Firehose Connections
// ---------------------------------------------------------------------------

export async function listFirehoseConnections(): Promise<{
  connections: FirehoseConnection[]
}> {
  return request(hp('/firehose/connections'))
}

export async function getFirehoseConnection(id: string): Promise<{
  connection: FirehoseConnection
}> {
  return request(hp(`/firehose/connections/${id}`))
}

export async function createFirehoseConnection(
  data: CreateFirehoseConnectionInput
): Promise<{ connection: FirehoseConnection }> {
  return request(hp('/firehose/connections'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateFirehoseConnection(
  id: string,
  data: UpdateFirehoseConnectionInput
): Promise<{ connection: FirehoseConnection }> {
  return request(hp(`/firehose/connections/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteFirehoseConnection(id: string): Promise<{ success: boolean }> {
  return request(hp(`/firehose/connections/${id}`), {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Firehose Health / Status
// ---------------------------------------------------------------------------

export async function getFirehoseStatus(): Promise<{
  health: FirehoseConnectionHealth[]
}> {
  return request(hp('/firehose/status'))
}
