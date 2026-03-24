// --- ECIES Key Envelopes ---
// Used across notes, messages, files, and hub key wrapping.

/**
 * Unified ECIES-wrapped symmetric key for one recipient.
 * Used everywhere: notes, messages, call records, hub keys.
 * The same ECIES construction with different domain separation labels.
 */
export interface RecipientEnvelope {
  /** Recipient's x-only public key (hex). */
  pubkey: string
  /** Nonce (24 bytes) + ciphertext: ECIES-wrapped symmetric key (hex). */
  wrappedKey: string
  /** Ephemeral secp256k1 compressed public key used for ECDH (hex). */
  ephemeralPubkey: string
}

/** @deprecated Use RecipientEnvelope instead. Kept for gradual migration. */
export type KeyEnvelope = Omit<RecipientEnvelope, 'pubkey'>

/** @deprecated Use RecipientEnvelope instead. */
export type RecipientKeyEnvelope = RecipientEnvelope

// --- Telephony Provider Config ---

export type TelephonyProviderType = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'telnyx'

export const TELEPHONY_PROVIDER_LABELS: Record<TelephonyProviderType, string> = {
  twilio: 'Twilio',
  signalwire: 'SignalWire',
  vonage: 'Vonage',
  plivo: 'Plivo',
  asterisk: 'Asterisk (Self-Hosted)',
  telnyx: 'Telnyx',
}

export type { TelephonyProviderConfig } from '@shared/schemas/providers'

/**
 * Flat draft type for form state when editing telephony provider settings.
 * All fields are optional except `type`, making it safe to use as a work-in-progress
 * buffer before assembling a valid discriminated union config for the API.
 */
export interface TelephonyProviderDraft {
  type: TelephonyProviderType
  phoneNumber?: string
  // Twilio
  accountSid?: string
  authToken?: string
  webrtcEnabled?: boolean
  apiKeySid?: string
  apiKeySecret?: string
  twimlAppSid?: string
  // SignalWire
  signalwireSpace?: string
  // Vonage
  apiKey?: string
  apiSecret?: string
  applicationId?: string
  privateKey?: string
  // Plivo
  authId?: string
  // Asterisk
  ariUrl?: string
  ariUsername?: string
  ariPassword?: string
  bridgeCallbackUrl?: string
  // Telnyx
  texmlAppId?: string
}

// --- Call Preference ---

export type CallPreference = 'phone' | 'browser' | 'both'

// PROVIDER_REQUIRED_FIELDS removed — use ProviderCapabilities.credentialSchema instead
// See src/server/telephony/capabilities.ts

// --- Geocoding / Location Types ---

export type LocationPrecision = 'none' | 'city' | 'neighborhood' | 'block' | 'exact'

export type LocationResult = {
  address: string
  displayName?: string
  lat: number
  lon: number
  countryCode?: string
}

export type LocationFieldValue = {
  address: string
  displayName?: string
  lat?: number
  lon?: number
  source: 'geocoded' | 'gps' | 'manual'
}

export type GeocodingProvider = 'opencage' | 'geoapify'

export type GeocodingConfig = {
  provider: GeocodingProvider | null
  countries: string[]
  enabled: boolean
}

export type GeocodingConfigAdmin = GeocodingConfig & { apiKey: string }

export const GEOCODING_PROVIDER_LABELS: Record<GeocodingProvider, string> = {
  opencage: 'OpenCage',
  geoapify: 'Geoapify',
}

export const DEFAULT_GEOCODING_CONFIG: GeocodingConfigAdmin = {
  provider: null,
  apiKey: '',
  countries: [],
  enabled: false,
}

// --- Location Field Settings (for custom field definition) ---

export interface LocationFieldSettings {
  maxPrecision: LocationPrecision
  allowGps: boolean
}

// --- Custom Fields ---

export type CustomFieldContext = 'call-notes' | 'conversation-notes' | 'reports' | 'all'

/** Custom field definition — stored as config in SessionManager DO */
export interface CustomFieldDefinition {
  id: string // unique UUID
  name: string // internal key (machine-readable, e.g. "severity")
  label: string // display label (e.g. "Severity Rating")
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'file' | 'location'
  required: boolean
  options?: string[] // for 'select' type only
  validation?: {
    minLength?: number // text/textarea
    maxLength?: number // text/textarea
    min?: number // number
    max?: number // number
  }
  visibleToVolunteers: boolean
  editableByVolunteers: boolean
  context: CustomFieldContext // where this field appears
  /**
   * IDs of report types that display this field.
   * Empty array (default) means shown for all report types when context includes 'reports'.
   */
  reportTypeIds?: string[]
  // File field type options
  maxFileSize?: number // bytes, for file type
  allowedMimeTypes?: string[] // e.g., ['image/*', 'application/pdf']
  maxFiles?: number // for multi-file fields (default: 1)
  // Location field type options
  locationSettings?: LocationFieldSettings
  order: number
  createdAt: string
}

// --- Report Types ---

export interface ReportType {
  id: string
  hubId: string
  name: string
  description?: string
  isDefault: boolean
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateReportTypeInput {
  name: string
  description?: string
  isDefault?: boolean
}

export interface UpdateReportTypeInput {
  name?: string
  description?: string
  isDefault?: boolean
}

// --- Encrypted File Upload Types ---

export interface EncryptedFileMetadata {
  originalName: string
  mimeType: string
  size: number
  dimensions?: { width: number; height: number }
  duration?: number
  checksum: string // SHA-256 of plaintext for integrity verification
}

/** ECIES-wrapped file encryption key for one recipient. */
export interface FileKeyEnvelope {
  pubkey: string
  encryptedFileKey: string
  ephemeralPubkey: string
}

export interface EncryptedMetaItem {
  pubkey: string
  encryptedContent: string
  ephemeralPubkey: string
}

/** Value stored in NotePayload.fields for a file custom field. */
export interface FileFieldValue {
  /** References FileRecord.id — used to fetch envelopes, metadata, and content. */
  fileId: string
}

export interface FileRecord {
  id: string
  conversationId: string
  messageId?: string
  uploadedBy: string // pubkey of uploader
  recipientEnvelopes: FileKeyEnvelope[]
  encryptedMetadata: EncryptedMetaItem[]
  totalSize: number // encrypted size in bytes
  totalChunks: number
  status: 'uploading' | 'complete' | 'failed'
  completedChunks: number
  createdAt: string
  completedAt?: string
  /** Optional context binding — set after the parent record (note, report, etc.) is saved. */
  contextType?: 'conversation' | 'note' | 'report' | 'custom_field'
  contextId?: string // noteId or reportId
}

export interface UploadInit {
  totalSize: number
  totalChunks: number
  conversationId: string
  recipientEnvelopes: FileKeyEnvelope[]
  encryptedMetadata: EncryptedMetaItem[]
  /** Optional context binding — can be provided at init time or later via PATCH /context. */
  contextType?: 'conversation' | 'note' | 'report' | 'custom_field'
  contextId?: string
}

/** What gets encrypted before storage — replaces plain text */
export interface NotePayload {
  text: string
  fields?: Record<string, string | number | boolean | FileFieldValue>
}

export const MAX_CUSTOM_FIELDS = 20
export const MAX_SELECT_OPTIONS = 50
export const MAX_FIELD_NAME_LENGTH = 50
export const MAX_FIELD_LABEL_LENGTH = 200
export const MAX_OPTION_LENGTH = 200
export const FIELD_NAME_REGEX = /^[a-zA-Z0-9_]+$/

/** Check if a custom field should appear in a given context */
export function fieldMatchesContext(
  field: CustomFieldDefinition,
  context: CustomFieldContext
): boolean {
  return field.context === context || field.context === 'all'
}

export const CUSTOM_FIELD_CONTEXT_LABELS: Record<CustomFieldContext, string> = {
  'call-notes': 'Call Notes',
  'conversation-notes': 'Conversation Notes',
  reports: 'Reports',
  all: 'All Record Types',
}

// --- Messaging Channel Types ---

export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

export type MessagingChannelType = 'sms' | 'whatsapp' | 'signal' | 'rcs'

/** All possible channel types including voice and reports */
export type ChannelType = 'voice' | MessagingChannelType | 'reports'

/** Transport security level for each channel */
export type TransportSecurity = 'none' | 'provider-encrypted' | 'e2ee-to-bridge' | 'e2ee'

export const CHANNEL_SECURITY: Record<ChannelType, TransportSecurity> = {
  voice: 'provider-encrypted',
  sms: 'none',
  whatsapp: 'provider-encrypted',
  signal: 'e2ee-to-bridge',
  rcs: 'provider-encrypted',
  reports: 'e2ee',
}

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  voice: 'Voice Calls',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  rcs: 'RCS',
  reports: 'Reports',
}

// --- Messaging Configuration ---

export interface SMSConfig {
  // SMS reuses the telephony provider's phone number and credentials
  enabled: boolean
  autoResponse?: string // auto-reply on first contact
  afterHoursResponse?: string // auto-reply outside shift hours
}

export interface WhatsAppConfig {
  integrationMode: 'twilio' | 'direct'
  // Direct Meta API fields
  phoneNumberId?: string
  businessAccountId?: string
  accessToken?: string
  verifyToken?: string
  appSecret?: string
  // Twilio mode uses existing telephony provider credentials
  autoResponse?: string
  afterHoursResponse?: string
}

export interface SignalConfig {
  bridgeUrl: string // e.g., "https://signal-bridge.internal:8080"
  bridgeApiKey: string
  webhookSecret: string
  registeredNumber: string
  autoResponse?: string
  afterHoursResponse?: string
}

export interface RCSConfig {
  agentId: string
  serviceAccountKey: string // JSON string of Google service account key
  webhookSecret?: string
  fallbackToSms: boolean
  autoResponse?: string
  afterHoursResponse?: string
}

export interface MessagingConfig {
  enabledChannels: MessagingChannelType[]
  sms: SMSConfig | null
  whatsapp: WhatsAppConfig | null
  signal: SignalConfig | null
  rcs: RCSConfig | null
  autoAssign: boolean // auto-assign to on-shift volunteers
  inactivityTimeout: number // minutes before auto-close
  maxConcurrentPerVolunteer: number // conversation limit per volunteer
}

export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = {
  enabledChannels: [],
  sms: null,
  whatsapp: null,
  signal: null,
  rcs: null,
  autoAssign: true,
  inactivityTimeout: 60,
  maxConcurrentPerVolunteer: 3,
}

// --- Message Blasts ---

export interface Subscriber {
  id: string
  identifierHash: string // HMAC hash of phone/identifier
  channels: SubscriberChannel[]
  tags: string[]
  language: string // preferred language code
  subscribedAt: string
  status: 'active' | 'paused' | 'unsubscribed'
  doubleOptInConfirmed: boolean
  preferenceToken: string // HMAC token for self-service preferences
}

export interface SubscriberChannel {
  type: MessagingChannelType
  verified: boolean
}

export interface Blast {
  id: string
  name: string
  content: BlastContent
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
  targetChannels: MessagingChannelType[]
  targetTags: string[] // empty = all subscribers
  targetLanguages: string[] // empty = all languages
  scheduledAt?: string
  sentAt?: string
  cancelledAt?: string
  createdBy: string // pubkey
  createdAt: string
  updatedAt: string
  stats: BlastStats
}

export interface BlastContent {
  text: string
  mediaUrl?: string
  mediaType?: string
  // Per-channel overrides
  smsText?: string
  whatsappTemplateId?: string
  rcsRichCard?: boolean
}

export interface BlastStats {
  totalRecipients: number
  sent: number
  delivered: number
  failed: number
  optedOut: number
}

export interface BlastSettings {
  subscribeKeyword: string // default: "JOIN"
  unsubscribeKeyword: string // default: "STOP"
  confirmationMessage: string
  unsubscribeMessage: string
  doubleOptIn: boolean
  optOutFooter: string // appended to every blast message
  maxBlastsPerDay: number
  rateLimitPerSecond: number // sending rate
}

export const DEFAULT_BLAST_SETTINGS: BlastSettings = {
  subscribeKeyword: 'JOIN',
  unsubscribeKeyword: 'STOP',
  confirmationMessage: 'You have been subscribed. Reply STOP to unsubscribe.',
  unsubscribeMessage: 'You have been unsubscribed. Reply JOIN to resubscribe.',
  doubleOptIn: false,
  optOutFooter: '\nReply STOP to unsubscribe.',
  maxBlastsPerDay: 10,
  rateLimitPerSecond: 10,
}

// --- Setup State ---

export interface SetupState {
  setupCompleted: boolean
  completedSteps: string[]
  pendingChannels: ChannelType[]
  selectedChannels: ChannelType[]
  demoMode?: boolean
}

export const DEFAULT_SETUP_STATE: SetupState = {
  setupCompleted: false,
  completedSteps: [],
  pendingChannels: [],
  selectedChannels: [],
  demoMode: false,
}

// --- Enabled Channels (computed from settings) ---

export interface EnabledChannels {
  voice: boolean
  sms: boolean
  whatsapp: boolean
  signal: boolean
  rcs: boolean
  reports: boolean
}

// --- GDPR ---

/** The current platform consent version string. Bump this date to require re-consent. */
export const CONSENT_VERSION = '2026-03-22'

export interface RetentionSettings {
  callRecordsDays: number // 30–3650, default 365
  notesDays: number // 30–3650, default 365
  messagesDays: number // 30–3650, default 180
  auditLogDays: number // 365–3650, default 1825
}

export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  callRecordsDays: 365,
  notesDays: 365,
  messagesDays: 180,
  auditLogDays: 1825,
}

export interface GdprConsentStatus {
  hasConsented: boolean
  consentVersion: string | null
  consentedAt: string | null
  currentPlatformVersion: string
}

export interface GdprErasureRequest {
  pubkey: string
  requestedAt: string
  executeAt: string
  status: 'pending' | 'cancelled' | 'executed'
}

// --- Hub Types ---

export interface Hub {
  id: string // UUID
  name: string // Display name (e.g., "NYC Hotline")
  slug: string // URL-safe identifier
  description?: string
  status: 'active' | 'suspended' | 'archived'
  phoneNumber?: string // Primary hotline number (for routing)
  createdBy: string // Super admin pubkey
  /** Zero-trust: hub admin must explicitly opt-in to allow super-admin visibility */
  allowSuperAdminAccess?: boolean
  createdAt: string
  updatedAt: string
}

export interface HubRoleAssignment {
  hubId: string
  roleIds: string[]
}

// --- Provider OAuth Auto-Config Types (Epic 48) ---

export interface OAuthState {
  state: string // 32-byte hex CSRF token
  provider: 'twilio' | 'telnyx'
  expiresAt: number // Unix ms — 10-minute TTL
}

export interface NumberInfo {
  phoneNumber: string // E.164
  friendlyName: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  sid?: string // provider-specific ID (Twilio SID, Telnyx ID, etc.)
}

export type SupportedProvider = 'twilio' | 'telnyx' | 'signalwire' | 'vonage' | 'plivo'

export interface ProviderConfig {
  provider: SupportedProvider
  connected: boolean
  phoneNumber?: string
  webhooksConfigured: boolean
  sipConfigured: boolean
  a2pStatus?: 'not_started' | 'pending' | 'approved' | 'failed' | 'skipped'
  brandSid?: string
  campaignSid?: string
  messagingServiceSid?: string
  // Encrypted credential fields are stored in SettingsDO, not in this type
}

export interface SipTrunkConfig {
  sipProvider: string // e.g. 'sip.twilio.com'
  sipUsername: string
  sipPassword: string
  trunkSid?: string // Twilio Trunk SID
  connectionId?: string // Telnyx Connection ID
}

// --- Signal Registration ---

export interface SignalRegistrationPending {
  number: string
  bridgeUrl: string
  method: 'sms' | 'voice'
  expiresAt: string // ISO 8601
  status: 'pending' | 'complete' | 'failed'
  error?: string
}

// ── Provider capability result types ──

export interface ConnectionTestResult {
  connected: boolean
  latencyMs: number
  accountName?: string
  error?: string
  errorType?: 'invalid_credentials' | 'network_error' | 'rate_limited' | 'account_suspended' | 'unknown'
}

export interface WebhookUrlSet {
  voiceIncoming?: string
  voiceStatus?: string
  voiceFallback?: string
  smsIncoming?: string
  smsStatus?: string
  whatsappIncoming?: string
  signalIncoming?: string
  rcsIncoming?: string
}

export interface PhoneNumberInfo {
  number: string
  country: string
  locality?: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  monthlyFee?: string
  owned: boolean
}

export interface NumberSearchQuery {
  country: string
  areaCode?: string
  contains?: string
  limit?: number
}

export interface ProvisionResult {
  ok: boolean
  number?: string
  error?: string
}

export interface AutoConfigResult {
  ok: boolean
  error?: string
  details?: Record<string, unknown>
}

export interface SipTrunkOptions {
  domain?: string
  username?: string
  password?: string
}
