import type { KeyEnvelope, MessageDeliveryStatus, MessagingChannelType, RecipientEnvelope } from '../shared/types'

/**
 * S3-compatible blob storage (R2 / MinIO).
 */
export interface BlobStorage {
  put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<void>
  get(
    key: string
  ): Promise<{ body: ReadableStream; size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>
  delete(key: string): Promise<void>
}

/**
 * Transcription service (self-hosted Whisper).
 */
export interface TranscriptionService {
  run(model: string, input: { audio: number[] }): Promise<{ text: string }>
}
import type { Services } from './services'

/**
 * Environment bindings available on the Hono context (c.env).
 * Injected at startup by server.ts via middleware.
 */

export interface Env {
  // Transcription (CF: Ai binding, Node: Whisper HTTP client)
  AI: TranscriptionService

  // Static assets (CF: Fetcher, Node: null — served by Hono serveStatic)
  ASSETS: { fetch(request: Request): Promise<Response> } | null

  // Blob storage (CF: R2Bucket, Node: MinIO S3 client)
  R2_BUCKET: BlobStorage

  // Plain env vars / secrets (same on both platforms)
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  ADMIN_PUBKEY: string
  ADMIN_DECRYPTION_PUBKEY?: string // Separate pubkey for note/hub key encryption (falls back to ADMIN_PUBKEY)
  HOTLINE_NAME: string
  ENVIRONMENT: string
  HMAC_SECRET: string
  E2E_TEST_SECRET?: string
  DEV_RESET_SECRET?: string

  // Demo mode
  DEMO_MODE?: string // "true" to enable
  DEMO_RESET_CRON?: string // Human-readable schedule label (e.g., "every 4 hours")

  // Server Nostr identity (Epic 76.1) — hex secret for HKDF keypair derivation
  SERVER_NOSTR_SECRET?: string
  // Phase 2.4: Comma-separated list of additional allowed CORS origins
  CORS_ALLOWED_ORIGINS?: string
  // Application URL (used for invite links, webhooks)
  APP_URL?: string
  // Relay URL for Node.js persistent WebSocket (Docker/self-hosted)
  NOSTR_RELAY_URL?: string
  // Public-facing relay URL for client browser connections (e.g., wss://relay.example.com)
  // Falls back to /nostr (reverse-proxied via Caddy) if not set but relay is configured
  NOSTR_RELAY_PUBLIC_URL?: string

  // Push notifications (Epic 86) — APNs (iOS)
  APNS_KEY_P8?: string // Apple Push Notification auth key (PEM format)
  APNS_KEY_ID?: string // Key ID from Apple Developer Portal
  APNS_TEAM_ID?: string // Apple Developer Team ID

  // Push notifications (Epic 86) — FCM (Android)
  FCM_SERVICE_ACCOUNT_KEY?: string // Google Cloud service account JSON

  // DATABASE_URL for Drizzle connection (Node.js only)
  DATABASE_URL?: string
}

/** @deprecated Use roles array + permission system instead */
export type UserRole = 'volunteer' | 'admin' | 'reporter'

export interface Volunteer {
  pubkey: string
  name: string
  phone: string
  roles: string[] // Global role IDs (e.g., ['role-super-admin', 'role-volunteer'])
  hubRoles?: { hubId: string; roleIds: string[] }[] // Per-hub role assignments
  active: boolean
  createdAt: string
  encryptedSecretKey: string // Admin-encrypted copy of the volunteer's nsec
  transcriptionEnabled: boolean
  spokenLanguages: string[] // Languages volunteer can take calls in (e.g. ['en', 'es'])
  uiLanguage: string // Preferred UI language
  profileCompleted: boolean // Whether first-login setup is done
  onBreak: boolean // Temporarily unavailable (still on shift)
  callPreference: 'phone' | 'browser' | 'both' // How to receive calls (default: 'phone')
  // Messaging channel capabilities (Epic 68)
  supportedMessagingChannels?: MessagingChannelType[] // SMS, WhatsApp, Signal, RCS (empty = all)
  messagingEnabled?: boolean // Whether volunteer can handle messaging conversations
}

export interface Shift {
  id: string
  name: string
  startTime: string
  endTime: string
  days: number[]
  volunteerPubkeys: string[]
  createdAt: string
}

export interface BanEntry {
  phone: string
  reason: string
  bannedBy: string
  bannedAt: string
}

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
  callerLast4?: string // For display (not sensitive)
  startedAt: string // Needed for ordering/pagination
  endedAt?: string // Needed for duration display
  duration?: number // Acceptable trade-off (no PII)
  status: 'completed' | 'unanswered'
  hasTranscription: boolean
  hasVoicemail: boolean
  hasRecording?: boolean
  recordingSid?: string // Twilio ID (not PII, server needs to update post-encryption)

  // Envelope-pattern encryption for admin(s)
  encryptedContent: string // hex: nonce(24) + ciphertext (XChaCha20-Poly1305)
  adminEnvelopes: RecipientEnvelope[] // Per-record key wrapped for each admin
}

/**
 * Plaintext inside EncryptedCallRecord.encryptedContent.
 * Only visible after admin decryption.
 */
export interface CallRecordMetadata {
  answeredBy: string | null // Volunteer pubkey
  callerNumber: string // HMAC-hashed phone number
}

export interface EncryptedNote {
  id: string
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

export interface SpamSettings {
  voiceCaptchaEnabled: boolean
  rateLimitEnabled: boolean
  maxCallsPerMinute: number
  blockDurationMinutes: number
}

export interface CallSettings {
  queueTimeoutSeconds: number // 30-300, default 90
  voicemailMaxSeconds: number // 30-300, default 120
}

export interface InviteCode {
  code: string
  name: string
  phone: string
  roleIds: string[] // Role IDs to assign on redemption
  createdBy: string
  createdAt: string
  expiresAt: string
  usedAt?: string
  usedBy?: string
}

export interface WebAuthnCredential {
  id: string // Base64URL credential ID
  publicKey: string // Base64URL public key bytes
  counter: number // Signature counter (clone detection)
  transports: string[] // ['internal', 'hybrid', etc.]
  backedUp: boolean // Cloud-synced passkey
  label: string // User-assigned name ("My Phone")
  createdAt: string
  lastUsedAt: string
}

export interface WebAuthnSettings {
  requireForAdmins: boolean
  requireForVolunteers: boolean
}

export interface ServerSession {
  token: string // Random 256-bit hex
  pubkey: string // Which user
  createdAt: string
  expiresAt: string // 8-hour expiry
}

export interface AuthPayload {
  pubkey: string
  timestamp: number
  token: string
}

// --- Conversation / Messaging Types ---

export type ConversationStatus = 'active' | 'waiting' | 'closed'

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

export type { MessageDeliveryStatus } from '../shared/types'

/**
 * Encrypted message using the envelope pattern (Epic 74).
 *
 * Single ciphertext encrypted with a random per-message symmetric key.
 * The key is ECIES-wrapped separately for each authorized reader.
 * Domain separation label: 'llamenos:message'.
 */
export interface EncryptedMessage {
  id: string
  conversationId: string
  direction: string
  authorPubkey: string
  encryptedContent: string
  readerEnvelopes: RecipientEnvelope[]
  hasAttachments: boolean
  attachmentIds?: string[]
  externalId?: string | null
  status: string
  deliveryStatus: MessageDeliveryStatus
  deliveryStatusUpdatedAt?: Date | null
  providerMessageId?: string | null
  deliveryError?: string | null
  deliveredAt?: Date | null
  readAt?: Date | null
  failureReason?: string | null
  retryCount: number
  createdAt: Date
}

/** @deprecated Use RecipientEnvelope from @shared/types instead. */
export type MessageKeyEnvelope = RecipientEnvelope

// --- Blast Queue ---

export interface BlastQueueItem {
  subscriberId: string
  channel: MessagingChannelType
  identifier: string // actual phone/contact (server-only, not stored)
  status: 'pending' | 'sent' | 'failed'
  error?: string
  sentAt?: string
}

export interface BlastDeliveryQueue {
  blastId: string
  items: BlastQueueItem[]
  processedCount: number
  totalCount: number
}

// --- Push Notification Types (Epic 86) ---

export interface DeviceRecord {
  platform: 'ios' | 'android'
  pushToken: string
  wakeKeyPublic: string // secp256k1 compressed pubkey (hex) for wake-tier ECIES
  registeredAt: string
  lastSeenAt: string
}

export type PushNotificationType = 'message' | 'voicemail' | 'shift_reminder' | 'assignment'

/** Wake-tier payload — decryptable without PIN (minimal metadata) */
export interface WakePayload {
  type: PushNotificationType
  conversationId?: string
  channelType?: string
  callId?: string
  shiftId?: string
  startsAt?: string
}

/** Full-tier payload — decryptable only with volunteer's nsec */
export interface FullPushPayload extends WakePayload {
  senderLast4?: string
  previewText?: string
  duration?: number
  callerLast4?: string
  shiftName?: string
  role?: string
}

// Hono typed context
export type AppEnv = {
  Bindings: Env
  Variables: {
    pubkey: string
    volunteer: Volunteer
    /** Effective permissions resolved from all roles */
    permissions: string[]
    /** All role definitions (loaded once per request) */
    allRoles: import('../shared/permissions').Role[]
    /** Current hub ID (set by hub middleware for hub-scoped routes) */
    hubId?: string
    /** Hub-scoped permissions (resolved for the current hub) */
    hubPermissions?: string[]
    /** Injected service instances */
    services: Services
  }
}

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
  credential: WebAuthnCredential
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
  adminEnvelopes?: RecipientEnvelope[]
}

export interface CallRecordFilters {
  search?: string
  dateFrom?: string
  dateTo?: string
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
// Conversation service input types
// -------------------------------------------------------------------

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

export interface CreateMessageData {
  conversationId: string
  direction: 'inbound' | 'outbound'
  authorPubkey: string
  encryptedContent: string
  readerEnvelopes?: RecipientEnvelope[]
  hasAttachments?: boolean
  attachmentIds?: string[]
  externalId?: string
  status?: string
  deliveryStatus?: MessageDeliveryStatus
  providerMessageId?: string
  deliveryError?: string
}

// -------------------------------------------------------------------
// Blast service types
// -------------------------------------------------------------------

export interface BlastStats {
  totalRecipients: number
  sent: number
  delivered: number
  failed: number
  optedOut: number
}

export interface SubscriberChannel {
  type: 'sms' | 'whatsapp' | 'signal' | 'rcs'
  verified: boolean
}

export interface Blast {
  id: string
  hubId: string
  name: string
  targetChannels: string[]
  targetTags: string[]
  targetLanguages: string[]
  content: string
  status: string
  stats: BlastStats
  createdAt: Date
  sentAt?: Date | null
}

export interface CreateBlastData {
  hubId?: string
  name: string
  targetChannels?: string[]
  targetTags?: string[]
  targetLanguages?: string[]
  content?: string
  status?: string
}

export interface Subscriber {
  id: string
  hubId: string
  identifierHash: string
  channels: SubscriberChannel[]
  tags: string[]
  language?: string | null
  status: string
  doubleOptInConfirmed: boolean
  subscribedAt: Date
  preferenceToken: string
  createdAt: Date
}

export interface CreateSubscriberData {
  hubId?: string
  identifierHash: string
  channels?: SubscriberChannel[]
  tags?: string[]
  language?: string
  status?: string
  preferenceToken?: string
}

export interface BlastDelivery {
  id: string
  blastId: string
  subscriberId: string
  channelType: string
  status: string
  error?: string | null
  sentAt?: Date | null
  deliveredAt?: Date | null
}

export interface CreateDeliveryData {
  blastId: string
  subscriberId: string
  channelType?: string
  status?: string
}
