import { randomUUID } from 'node:crypto'
import { LABEL_VOICEMAIL_WRAP } from '@shared/crypto-labels'
import type { FileKeyEnvelope } from '@shared/types'
import type { FilesService } from '../services/files'
import type { RecordsService } from '../services/records'
import type { TelephonyAdapter } from '../telephony/adapter'
import { encryptBinaryForStorage } from './crypto'

interface StoreVoicemailParams {
  callSid: string
  recordingSid: string
  hubId: string
  adminPubkeys: string[]
  adapter: TelephonyAdapter
  files: FilesService
  records: RecordsService
  maxBytes: number
}

/**
 * Orchestrates voicemail audio storage:
 * 1. Download audio from telephony provider
 * 2. Validate size — bail with 'oversized' if too large, keeping provider copy as fallback
 * 3. Encrypt with ECIES envelopes for each admin
 * 4. Store encrypted blob in MinIO via FilesService
 * 5. Delete from provider only after successful storage
 * 6. Update call record with voicemailFileId
 *
 * Returns the new fileId on success, or 'oversized' if the audio exceeds maxBytes.
 */
export async function storeVoicemailAudio(
  params: StoreVoicemailParams
): Promise<string | 'oversized'> {
  const { callSid, recordingSid, hubId, adminPubkeys, adapter, files, records, maxBytes } = params

  // 1. Download audio from provider
  const audioBuffer = await adapter.getRecordingAudio(recordingSid)
  if (!audioBuffer) {
    throw new Error(`Failed to download recording ${recordingSid} for call ${callSid}`)
  }

  const audioBytes = new Uint8Array(audioBuffer)

  // 2. Validate size — if over limit, log warning and keep provider copy as fallback
  if (audioBytes.length > maxBytes) {
    console.warn(
      `[voicemail] Audio (${audioBytes.length} bytes) exceeds max (${maxBytes} bytes) for call ${callSid} — keeping provider copy`
    )
    return 'oversized'
  }

  // 3. Encrypt audio with ECIES envelopes for each admin
  const { encryptedContent, readerEnvelopes } = encryptBinaryForStorage(
    audioBytes,
    adminPubkeys,
    LABEL_VOICEMAIL_WRAP
  )

  // Map RecipientEnvelope (wrappedKey) → FileKeyEnvelope (encryptedFileKey)
  const recipientEnvelopes: FileKeyEnvelope[] = readerEnvelopes.map((env) => ({
    pubkey: env.pubkey,
    encryptedFileKey: env.wrappedKey,
    ephemeralPubkey: env.ephemeralPubkey,
  }))

  // 4. Store encrypted blob in MinIO via FilesService
  const fileId = randomUUID()
  const encryptedBytes = Buffer.from(encryptedContent, 'hex')

  // putAssembled first — if this throws, we don't proceed to createFileRecord or deleteRecording
  await files.putAssembled(fileId, new Uint8Array(encryptedBytes))
  await files.createFileRecord({
    id: fileId,
    conversationId: null,
    messageId: undefined,
    uploadedBy: 'system:voicemail',
    recipientEnvelopes,
    encryptedMetadata: [],
    totalSize: encryptedBytes.length,
    totalChunks: 1,
    status: 'complete',
    contextType: 'voicemail',
    contextId: callSid,
  })
  await files.completeUpload(fileId)

  // 5. Delete from provider — only after successful storage
  await adapter.deleteRecording(recordingSid)

  // 6. Update call record with file reference
  await records.updateCallRecord(callSid, hubId, { voicemailFileId: fileId })

  return fileId
}
