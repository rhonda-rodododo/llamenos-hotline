import type { KeyEnvelope, RecipientEnvelope } from '../../shared/types'

export interface EncryptedNote {
  id: string
  hubId: string
  callId?: string // links to a voice call
  conversationId?: string // links to a conversation (Epic 123)
  contactHash?: string // links to a contact for contact-level view (Epic 123)
  authorPubkey: string
  encryptedContent: string
  createdAt: string
  updatedAt: string
  ephemeralPubkey?: string // hex-encoded, present for server-encrypted transcriptions (ECIES)
  // V2 per-note ECIES envelopes (forward secrecy)
  authorEnvelope?: KeyEnvelope
  adminEnvelopes?: RecipientEnvelope[]
  replyCount?: number // cached count of replies (Epic 123)
}

export interface AuditLogEntry {
  id: string
  event: string
  actorPubkey: string
  details: Record<string, unknown>
  createdAt: string
  // Tamper detection (Epic 77)
  previousEntryHash?: string // SHA-256 of previous entry (chain link)
  entryHash?: string // SHA-256 of this entry's content (for chain verification)
}

export interface CreateNoteData {
  id?: string
  hubId?: string
  callId?: string
  conversationId?: string
  contactHash?: string
  authorPubkey: string
  encryptedContent: string
  ephemeralPubkey?: string
  authorEnvelope?: { wrappedKey: string; ephemeralPubkey: string }
  adminEnvelopes?: { pubkey: string; wrappedKey: string; ephemeralPubkey: string }[]
}

export interface UpdateNoteData {
  encryptedContent: string
  authorPubkey: string
  authorEnvelope?: { wrappedKey: string; ephemeralPubkey: string }
  adminEnvelopes?: { pubkey: string; wrappedKey: string; ephemeralPubkey: string }[]
}

export interface NoteFilters {
  authorPubkey?: string | null
  callId?: string | null
  conversationId?: string | null
  contactHash?: string | null
  page?: number
  limit?: number
  hubId?: string
}

export interface AuditFilters {
  page?: number
  limit?: number
  actorPubkey?: string
  eventType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  hubId?: string
}
