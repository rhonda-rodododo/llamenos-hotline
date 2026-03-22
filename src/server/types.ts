/**
 * Service-layer domain types.
 *
 * Re-exports shared types where they match exactly, and adds service-layer
 * input/filter shapes that don't belong in @shared.
 */

// Re-export types from worker types (identity-related)
export type {
  Volunteer,
  InviteCode,
  WebAuthnCredential,
  WebAuthnSettings,
  ServerSession,
  BanEntry,
  EncryptedNote,
  EncryptedCallRecord,
  AuditLogEntry,
  SpamSettings,
  CallSettings,
} from '../worker/types'

// Re-export types from shared types
export type {
  TelephonyProviderConfig,
  MessagingConfig,
  SetupState,
  EnabledChannels,
  Hub,
  RecipientEnvelope,
  CustomFieldDefinition,
} from '../shared/types'

// Re-export role type from shared permissions
export type { Role } from '../shared/permissions'

// -------------------------------------------------------------------
// Identity service input types
// -------------------------------------------------------------------

export interface CreateVolunteerData {
  pubkey: string
  name: string
  phone: string
  roleIds?: string[]
  roles?: string[]
  encryptedSecretKey: string
}

export interface UpdateVolunteerData {
  name?: string
  phone?: string
  spokenLanguages?: string[]
  uiLanguage?: string
  profileCompleted?: boolean
  transcriptionEnabled?: boolean
  onBreak?: boolean
  callPreference?: 'phone' | 'browser' | 'both'
  // Admin-only fields
  roles?: string[]
  active?: boolean
  supportedMessagingChannels?: string[]
  messagingEnabled?: boolean
  encryptedSecretKey?: string
}

export interface CreateInviteData {
  name: string
  phone: string
  roleIds: string[]
  createdBy: string
}

export interface RedeemInviteData {
  code: string
  pubkey: string
}

export interface CreateSessionData {
  pubkey: string
}

export interface CreateWebAuthnChallengeData {
  id: string
  challenge: string
  pubkey?: string
}

export interface AddWebAuthnCredentialData {
  pubkey: string
  credential: import('../worker/types').WebAuthnCredential
}

export interface UpdateWebAuthnCounterData {
  pubkey: string
  credId: string
  counter: number
  lastUsedAt: string
}

export interface CreateProvisionRoomData {
  ephemeralPubkey: string
}

export interface ProvisionRoomStatus {
  status: 'waiting' | 'ready' | 'expired'
  ephemeralPubkey?: string
  encryptedNsec?: string
  primaryPubkey?: string
}

export interface SetProvisionPayloadData {
  token: string
  encryptedNsec: string
  primaryPubkey: string
  senderPubkey: string
}

export interface SetHubRoleData {
  pubkey: string
  hubId: string
  roleIds: string[]
}

// -------------------------------------------------------------------
// Settings service types
// -------------------------------------------------------------------

export interface TranscriptionSettings {
  globalEnabled: boolean
  allowVolunteerOptOut: boolean
}

export interface IvrAudioEntry {
  hubId: string
  promptType: string
  language: string
  audioData: string // base64-encoded
  mimeType: string
}

export interface IvrAudioMeta {
  promptType: string
  language: string
  mimeType: string
}

export interface CreateRoleData {
  name: string
  slug: string
  permissions: string[]
  description: string
  hubId?: string
}

export interface UpdateRoleData {
  name?: string
  description?: string
  permissions?: string[]
}

export interface CreateHubData {
  id: string
  name: string
  slug?: string
  description?: string
  status?: 'active' | 'suspended' | 'archived'
  phoneNumber?: string
  createdBy: string
}

export interface HubKeyEntry {
  pubkey: string
  wrappedKey: string
  ephemeralPubkey: string
}

export interface CaptchaEntry {
  callSid: string
  expectedDigits: string
}

// -------------------------------------------------------------------
// Records service types
// -------------------------------------------------------------------

export interface CreateBanData {
  phone: string
  reason: string
  bannedBy: string
  hubId?: string
}

export interface BulkBanData {
  phones: string[]
  reason: string
  bannedBy: string
  hubId?: string
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
  encryptedContent?: string
  adminEnvelopes?: import('../shared/types').RecipientEnvelope[]
}

export interface CallRecordFilters {
  search?: string
  dateFrom?: string
  dateTo?: string
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

// -------------------------------------------------------------------
// Shift service types
// -------------------------------------------------------------------

export interface ShiftSchedule {
  id: string
  hubId: string
  name: string
  startTime: string
  endTime: string
  days: number[]
  volunteerPubkeys: string[]
  ringGroupId?: string | null
  createdAt: Date
}

export interface CreateScheduleData {
  hubId?: string
  name: string
  startTime: string
  endTime: string
  days: number[]
  volunteerPubkeys: string[]
  ringGroupId?: string
}

export interface ShiftOverride {
  id: string
  hubId: string
  scheduleId?: string | null
  date: string
  type: string
  volunteerPubkeys?: string[] | null
  createdAt: Date
}

export interface CreateOverrideData {
  hubId?: string
  scheduleId?: string
  date: string
  type: 'cancel' | 'substitute'
  volunteerPubkeys?: string[]
}

export interface RingGroup {
  id: string
  hubId: string
  name: string
  volunteerPubkeys: string[]
  createdAt: Date
}

export interface CreateRingGroupData {
  hubId?: string
  name: string
  volunteerPubkeys: string[]
}

export interface ActiveShift {
  pubkey: string
  hubId: string
  startedAt: Date
  ringGroupId?: string | null
}

export interface StartShiftData {
  pubkey: string
  hubId?: string
  ringGroupId?: string
}

// -------------------------------------------------------------------
// Call service types
// -------------------------------------------------------------------

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
  volunteerPubkey: string
  phone?: string | null
  status: string
  createdAt: Date
}

export interface CreateCallLegData {
  legSid: string
  callSid: string
  hubId?: string
  volunteerPubkey: string
  phone?: string
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

// -------------------------------------------------------------------
// Conversation service types
// -------------------------------------------------------------------

export interface Conversation {
  id: string
  hubId: string
  channelType: string
  contactIdentifierHash: string
  contactLast4?: string | null
  externalId?: string | null
  assignedTo?: string | null
  status: string
  metadata: Record<string, unknown>
  messageCount: number
  createdAt: Date
  updatedAt: Date
  lastMessageAt: Date
}

export interface ConversationFilters {
  hubId?: string
  status?: string
  assignedTo?: string
  channelType?: string
  page?: number
  limit?: number
}

export interface CreateConversationData {
  hubId?: string
  channelType: string
  contactIdentifierHash: string
  contactLast4?: string
  externalId?: string
  assignedTo?: string
  status?: string
  metadata?: Record<string, unknown>
}

export interface EncryptedMessage {
  id: string
  conversationId: string
  direction: string
  authorPubkey: string
  encryptedContent: string
  readerEnvelopes: import('../shared/types').RecipientEnvelope[]
  hasAttachments: boolean
  attachmentIds?: string[]
  externalId?: string | null
  status: string
  deliveredAt?: Date | null
  readAt?: Date | null
  failureReason?: string | null
  retryCount: number
  createdAt: Date
}

export interface CreateMessageData {
  conversationId: string
  direction: 'inbound' | 'outbound'
  authorPubkey: string
  encryptedContent: string
  readerEnvelopes?: import('../shared/types').RecipientEnvelope[]
  hasAttachments?: boolean
  attachmentIds?: string[]
  externalId?: string
  status?: string
}

// -------------------------------------------------------------------
// Blast service types
// -------------------------------------------------------------------

export interface Blast {
  id: string
  hubId: string
  name: string
  channel: string
  content: string
  status: string
  totalCount: number
  sentCount: number
  failedCount: number
  createdAt: Date
  sentAt?: Date | null
}

export interface CreateBlastData {
  hubId?: string
  name: string
  channel: string
  content?: string
  status?: string
}

export interface Subscriber {
  id: string
  hubId: string
  phoneNumber: string
  channel: string
  active: boolean
  token?: string | null
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface CreateSubscriberData {
  hubId?: string
  phoneNumber: string
  channel: string
  active?: boolean
  token?: string
  metadata?: Record<string, unknown>
}

export interface BlastDelivery {
  id: string
  blastId: string
  subscriberId: string
  status: string
  error?: string | null
  sentAt?: Date | null
}

export interface CreateDeliveryData {
  blastId: string
  subscriberId: string
  status?: string
}
