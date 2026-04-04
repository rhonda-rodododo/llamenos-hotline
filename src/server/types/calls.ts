import type { RecipientEnvelope } from '../../shared/types'

export interface CallRecord {
  id: string
  callerNumber: string
  callerLast4?: string
  answeredBy: string | null
  startedAt: string
  endedAt?: string
  duration?: number
  status: 'ringing' | 'in-progress' | 'completed' | 'unanswered'
  hasTranscription: boolean
  hasVoicemail: boolean
  recordingSid?: string
  hasRecording?: boolean
}

/**
 * Encrypted call record for history storage (Epic 77).
 *
 * Active calls remain as plaintext CallRecord (routing necessity).
 * When a call completes, sensitive metadata (answeredBy, full callerNumber)
 * is encrypted into an envelope and stored per-record as `callrecord:${id}`.
 *
 * Plaintext fields: callerLast4, timestamp, duration, status, hasTranscription, hasVoicemail
 * Encrypted fields: answeredBy, callerNumber (original hash), outcome details
 */
export interface EncryptedCallRecord {
  id: string
  callerLast4?: string // '[encrypted]' when E2EE, undefined for legacy
  startedAt: string // Needed for ordering/pagination
  endedAt?: string // Needed for duration display
  duration?: number // Acceptable trade-off (no PII)
  status: 'completed' | 'unanswered'
  hasTranscription: boolean
  hasVoicemail: boolean
  hasRecording?: boolean
  recordingSid?: string // Twilio ID (not PII, server needs to update post-encryption)
  voicemailFileId?: string | null // Object storage file ID for encrypted voicemail audio

  // Envelope-pattern encryption for admin(s)
  encryptedContent: string // hex: nonce(24) + ciphertext (XChaCha20-Poly1305)
  adminEnvelopes: RecipientEnvelope[] // Per-record key wrapped for each admin
  // E2EE envelope-encrypted callerLast4 (Phase 2D)
  encryptedCallerLast4?: string
  callerLast4Envelopes?: RecipientEnvelope[]
}

/**
 * Plaintext inside EncryptedCallRecord.encryptedContent.
 * Only visible after admin decryption.
 */
export interface CallRecordMetadata {
  answeredBy: string | null // User pubkey
  callerNumber: string // HMAC-hashed phone number
}

export interface CreateCallRecordData {
  id: string
  hubId?: string
  callerLast4?: string
  startedAt: Date
  endedAt?: Date
  duration?: number
  status: string
  hasTranscription?: boolean
  hasVoicemail?: boolean
  hasRecording?: boolean
  recordingSid?: string
  voicemailFileId?: string
  encryptedContent?: string
  adminEnvelopes?: RecipientEnvelope[]
}

export interface CallRecordFilters {
  search?: string
  dateFrom?: string
  dateTo?: string
  voicemailOnly?: boolean
}

// Analytics types
export interface CallVolumeDay {
  date: string
  count: number
  answered: number
  voicemail: number
}

export interface CallHourBucket {
  hour: number
  count: number
}

export interface ActiveCall {
  callSid: string
  hubId: string
  callerNumber: string
  status: string
  assignedPubkey?: string | null
  startedAt: Date
  metadata: Record<string, unknown>
}

export interface CreateActiveCallData {
  callSid: string
  hubId?: string
  callerNumber: string
  status?: string
  assignedPubkey?: string
}

export interface CallLeg {
  legSid: string
  callSid: string
  hubId: string
  userPubkey: string
  phone?: string | null
  type: 'phone' | 'browser'
  status: string
  createdAt: Date
}

export interface CreateCallLegData {
  legSid: string
  callSid: string
  hubId?: string
  userPubkey: string
  phone?: string
  type?: 'phone' | 'browser'
  status?: string
}

export interface CallTokenPayload {
  token: string
  callSid: string
  hubId: string
  pubkey: string
  expiresAt: Date
  createdAt: Date
}

export interface CreateCallTokenData {
  callSid: string
  hubId?: string
  pubkey: string
  ttlSeconds?: number
}
