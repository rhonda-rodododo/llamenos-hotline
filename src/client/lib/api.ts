import type { Ciphertext } from '@shared/crypto-types'
import type { EncryptedMetaItem, KeyEnvelope, RecipientEnvelope } from '@shared/types'
import { authFacadeClient } from './auth-facade-client'
import * as keyManager from './key-manager'

const API_BASE = '/api'

// Auth expiry callback — set by AuthProvider to handle 401s reactively
let onAuthExpired: (() => void) | null = null
export function setOnAuthExpired(cb: (() => void) | null) {
  onAuthExpired = cb
}

function getAuthHeaders(): Record<string, string> {
  const token = authFacadeClient.getAccessToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

// Activity tracking callback — set by AuthProvider
let onApiActivity: (() => void) | null = null
export function setOnApiActivity(cb: (() => void) | null) {
  onApiActivity = cb
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...options.headers,
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      // Session expired — notify auth provider (don't clear nsec for reconnect)
      onAuthExpired?.()
    }
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  // Track successful API activity for session expiry warning
  onApiActivity?.()
  return res.json()
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`API error ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

// --- Hub context for hub-scoped API calls ---

let activeHubId: string | null = null
export function setActiveHub(id: string | null) {
  activeHubId = id
}
export function getActiveHub(): string | null {
  return activeHubId
}

/** Prefix a path with the active hub scope. No-op when no hub is active. */
function hp(path: string): string {
  return activeHubId ? `/hubs/${activeHubId}${path}` : path
}

// --- Public config (no auth) ---

export async function getConfig() {
  const res = await fetch(`${API_BASE}/config`)
  if (!res.ok)
    return {
      hotlineName: 'Hotline',
      hotlineNumber: '',
      channels: undefined,
      setupCompleted: undefined,
    }
  return res.json() as Promise<{
    hotlineName: string
    hotlineNumber: string
    channels?: import('@shared/types').EnabledChannels
    setupCompleted?: boolean
    adminPubkey?: string
    demoMode?: boolean
    demoResetSchedule?: string | null
    needsBootstrap?: boolean
    hubs?: import('@shared/types').Hub[]
    defaultHubId?: string
    serverNostrPubkey?: string
    nostrRelayUrl?: string
  }>
}

// --- Auth ---

export async function login(pubkey: string, timestamp: number, token: string) {
  return request<{ ok: true; roles: string[] }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pubkey, timestamp, token }),
  })
}

export async function bootstrapAdmin(pubkey: string, timestamp: number, token: string) {
  const res = await fetch(`${API_BASE}/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey, timestamp, token }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<{ ok: true; roles: string[]; nsecSecret: string }>
}

export async function logout() {
  return request<{ ok: true }>('/auth/me/logout', { method: 'POST' }).catch(() => {})
}

export async function getMe() {
  return request<{
    pubkey: string
    roles: string[]
    hubRoles: { hubId: string; roleIds: string[] }[]
    permissions: string[]
    primaryRole: { id: string; name: string; slug: string } | null
    name: string
    encryptedName?: Ciphertext
    nameEnvelopes?: RecipientEnvelope[]
    transcriptionEnabled: boolean
    spokenLanguages: string[]
    uiLanguage: string
    profileCompleted: boolean
    onBreak: boolean
    callPreference: 'phone' | 'browser' | 'both'
    webauthnRequired: boolean
    webauthnRegistered: boolean
    adminPubkey: string
    adminDecryptionPubkey: string
  }>('/auth/me')
}

// --- Volunteers (admin only) ---

export async function listVolunteers() {
  return request<{ volunteers: Volunteer[] }>('/volunteers')
}

export async function createVolunteer(data: {
  name: string
  phone: string
  roleIds: string[]
  pubkey: string
}) {
  return request<{ volunteer: Volunteer }>('/volunteers', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateVolunteer(
  pubkey: string,
  data: Partial<{
    name: string
    phone: string
    roles: string[]
    active: boolean
    supportedMessagingChannels: string[]
    messagingEnabled: boolean
  }>
) {
  return request<{ volunteer: Volunteer }>(`/volunteers/${pubkey}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteVolunteer(pubkey: string) {
  return request<{ ok: true }>(`/volunteers/${pubkey}`, { method: 'DELETE' })
}

// --- Shift Status (all users) ---

export interface ShiftStatus {
  onShift: boolean
  currentShift: { name: string; startTime: string; endTime: string } | null
  nextShift: { name: string; startTime: string; endTime: string; day: number } | null
}

export async function getMyShiftStatus() {
  return request<ShiftStatus>(hp('/shifts/my-status'))
}

// --- Shifts (admin only) ---

export async function listShifts() {
  return request<{ shifts: Shift[] }>(hp('/shifts'))
}

export async function createShift(data: Omit<Shift, 'id'>) {
  return request<{ shift: Shift }>(hp('/shifts'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateShift(id: string, data: Partial<Shift>) {
  return request<{ shift: Shift }>(hp(`/shifts/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteShift(id: string) {
  return request<{ ok: true }>(hp(`/shifts/${id}`), { method: 'DELETE' })
}

export async function getFallbackGroup() {
  return request<{ volunteers: string[] }>(hp('/shifts/fallback'))
}

export async function setFallbackGroup(volunteers: string[]) {
  return request<{ ok: true }>(hp('/shifts/fallback'), {
    method: 'PUT',
    body: JSON.stringify({ volunteers }),
  })
}

// --- Ban List ---

export async function listBans() {
  return request<{ bans: BanEntry[] }>(hp('/bans'))
}

export async function addBan(data: { phone: string; reason: string }) {
  return request<{ ban: BanEntry }>(hp('/bans'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function removeBan(phone: string) {
  return request<{ ok: true }>(hp(`/bans/${encodeURIComponent(phone)}`), { method: 'DELETE' })
}

export async function bulkAddBans(data: { phones: string[]; reason: string }) {
  return request<{ count: number }>(hp('/bans/bulk'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// --- Notes ---

export async function listNotes(params?: { callId?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams()
  if (params?.callId) qs.set('callId', params.callId)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ notes: EncryptedNote[]; total: number }>(hp(`/notes?${qs}`))
}

export async function createNote(data: {
  callId: string
  encryptedContent: Ciphertext
  authorEnvelope?: KeyEnvelope
  adminEnvelopes?: RecipientEnvelope[]
}) {
  return request<{ note: EncryptedNote }>(hp('/notes'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateNote(
  id: string,
  data: {
    encryptedContent: Ciphertext
    authorEnvelope?: KeyEnvelope
    adminEnvelopes?: RecipientEnvelope[]
  }
) {
  return request<{ note: EncryptedNote }>(hp(`/notes/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Calls ---

export async function listActiveCalls() {
  return request<{ calls: ActiveCall[] }>(hp('/calls/active'))
}

export async function getCallHistory(params?: {
  page?: number
  limit?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  voicemailOnly?: boolean
}) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.search) qs.set('search', params.search)
  if (params?.dateFrom) qs.set('dateFrom', params.dateFrom)
  if (params?.dateTo) qs.set('dateTo', params.dateTo)
  if (params?.voicemailOnly) qs.set('voicemailOnly', 'true')
  return request<{ calls: CallRecord[]; total: number }>(hp(`/calls/history?${qs}`))
}

// --- Call Actions (REST) ---

export async function answerCall(callId: string, type?: 'phone' | 'browser') {
  return request<{ call: ActiveCall }>(hp(`/calls/${callId}/answer`), {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}

export async function hangupCall(callId: string) {
  return request<{ call: ActiveCall }>(hp(`/calls/${callId}/hangup`), { method: 'POST' })
}

export async function reportCallSpam(callId: string) {
  return request<{ callId: string; callerNumber: string | null; reportedBy: string }>(
    hp(`/calls/${callId}/spam`),
    { method: 'POST' }
  )
}

// --- Calls Today ---

export async function getCallsTodayCount() {
  return request<{ count: number }>(hp('/calls/today-count'))
}

// --- Call Recording ---

export async function getCallRecording(callId: string): Promise<ArrayBuffer> {
  const headers = {
    ...getAuthHeaders(),
  }
  const res = await fetch(`${API_BASE}${hp(`/calls/${callId}/recording`)}`, { headers })
  if (!res.ok) {
    if (res.status === 401) onAuthExpired?.()
    throw new ApiError(res.status, await res.text())
  }
  onApiActivity?.()
  return res.arrayBuffer()
}

// --- Volunteer Presence (admin only) ---

export async function getVolunteerPresence() {
  return request<{ volunteers: VolunteerPresence[] }>(hp('/calls/presence'))
}

// --- Audit Log (admin only) ---

export async function listAuditLog(params?: {
  page?: number
  limit?: number
  actorPubkey?: string
  eventType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.actorPubkey) qs.set('actorPubkey', params.actorPubkey)
  if (params?.eventType) qs.set('eventType', params.eventType)
  if (params?.dateFrom) qs.set('dateFrom', params.dateFrom)
  if (params?.dateTo) qs.set('dateTo', params.dateTo)
  if (params?.search) qs.set('search', params.search)
  return request<{ entries: AuditLogEntry[]; total: number }>(hp(`/audit?${qs}`))
}

// --- Spam Mitigation ---

export async function getSpamSettings() {
  return request<SpamSettings>('/settings/spam')
}

export async function updateSpamSettings(data: Partial<SpamSettings>) {
  return request<SpamSettings>('/settings/spam', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Call Settings ---

export interface CallSettings {
  queueTimeoutSeconds: number
  voicemailMaxSeconds: number
  voicemailMaxBytes: number
  voicemailMode: 'auto' | 'always' | 'never'
  voicemailRetentionDays: number | null
  callRecordingMaxBytes: number
}

export async function getCallSettings() {
  return request<CallSettings>('/settings/call')
}

export async function updateCallSettings(data: Partial<CallSettings>) {
  return request<CallSettings>('/settings/call', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- IVR Language Settings ---

export async function getIvrLanguages() {
  return request<{ enabledLanguages: string[] }>('/settings/ivr-languages')
}

export async function updateIvrLanguages(data: { enabledLanguages: string[] }) {
  return request<{ enabledLanguages: string[] }>('/settings/ivr-languages', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Transcription Settings ---

export async function getTranscriptionSettings() {
  return request<{ globalEnabled: boolean; allowVolunteerOptOut: boolean }>(
    '/settings/transcription'
  )
}

export async function updateTranscriptionSettings(data: {
  globalEnabled?: boolean
  allowVolunteerOptOut?: boolean
}) {
  return request<{ globalEnabled: boolean; allowVolunteerOptOut: boolean }>(
    '/settings/transcription',
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    }
  )
}

export async function updateMyTranscriptionPreference(enabled: boolean) {
  return request<{ ok: true }>('/auth/me/transcription', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

export async function updateMyProfile(data: {
  name?: string
  phone?: string
  spokenLanguages?: string[]
  uiLanguage?: string
  profileCompleted?: boolean
  callPreference?: 'phone' | 'browser' | 'both'
}) {
  return request<{ ok: true }>('/auth/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function updateMyAvailability(onBreak: boolean) {
  return request<{ ok: true }>('/auth/me/availability', {
    method: 'PATCH',
    body: JSON.stringify({ onBreak }),
  })
}

// --- Invites ---

export async function listInvites() {
  return request<{ invites: InviteCode[] }>('/invites')
}

export async function createInvite(data: { name: string; phone: string; roleIds: string[] }) {
  return request<{ invite: InviteCode }>('/invites', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function revokeInvite(code: string) {
  return request<{ ok: true }>(`/invites/${code}`, { method: 'DELETE' })
}

export async function validateInvite(code: string) {
  const res = await fetch(`${API_BASE}/invites/validate/${code}`)
  return res.json() as Promise<{
    valid: boolean
    name?: string
    roleIds?: string[]
    error?: string
  }>
}

export async function redeemInvite(code: string, pubkey: string) {
  // JWT auth handles authentication now — no Schnorr token needed
  const res = await fetch(`${API_BASE}/invites/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, pubkey }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<{ volunteer: Volunteer; nsecSecret?: string; accessToken?: string }>
}

// --- IVR Audio ---

export interface IvrAudioRecording {
  promptType: string
  language: string
  size: number
  uploadedAt: string
}

export async function listIvrAudio() {
  return request<{ recordings: IvrAudioRecording[] }>('/settings/ivr-audio')
}

export async function uploadIvrAudio(promptType: string, language: string, audioBlob: Blob) {
  const res = await fetch(`${API_BASE}/settings/ivr-audio/${promptType}/${language}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': audioBlob.type || 'audio/webm',
    },
    body: audioBlob,
  })
  if (!res.ok) {
    if (res.status === 401) {
      onAuthExpired?.()
    }
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<{ ok: true }>
}

export async function deleteIvrAudio(promptType: string, language: string) {
  return request<{ ok: true }>(`/settings/ivr-audio/${promptType}/${language}`, {
    method: 'DELETE',
  })
}

export function getIvrAudioUrl(promptType: string, language: string) {
  return `${API_BASE}/ivr-audio/${promptType}/${language}`
}

// --- Custom Fields ---

export type { CustomFieldDefinition } from '@shared/types'
import type { CustomFieldDefinition } from '@shared/types'

export async function getCustomFields() {
  return request<{ fields: CustomFieldDefinition[] }>('/settings/custom-fields')
}

export async function updateCustomFields(fields: CustomFieldDefinition[]) {
  return request<{ fields: CustomFieldDefinition[] }>('/settings/custom-fields', {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  })
}

// --- Provider Health Status ---

export interface HealthCheckResult {
  provider: string
  channel?: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  lastCheck: string
  consecutiveFailures: number
  error?: string
}

export interface ProviderHealthStatus {
  telephony: HealthCheckResult | null
  messaging: Record<string, HealthCheckResult>
  lastFullCheck: string
}

export async function getProviderHealth() {
  return request<ProviderHealthStatus>('/settings/provider-health')
}

// --- Telephony Provider Settings ---

export type { TelephonyProviderConfig, TelephonyProviderType } from '@shared/types'
import type { TelephonyProviderConfig, TelephonyProviderType } from '@shared/types'

export async function getTelephonyProvider() {
  return request<TelephonyProviderConfig | null>('/settings/telephony-provider')
}

export async function updateTelephonyProvider(config: TelephonyProviderConfig) {
  return request<TelephonyProviderConfig>('/settings/telephony-provider', {
    method: 'PATCH',
    body: JSON.stringify(config),
  })
}

export async function testTelephonyProvider(
  config: Partial<TelephonyProviderConfig> & { type: string }
) {
  return request<{ ok: boolean; error?: string }>('/settings/telephony-provider/test', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

// --- WebRTC Token ---

export async function getWebRtcToken() {
  return request<{ token: string; provider: string; identity: string; ttl: number }>(
    '/telephony/webrtc-token'
  )
}

export async function getWebRtcStatus() {
  return request<{ available: boolean; provider: string | null }>('/telephony/webrtc-status')
}

// --- WebAuthn Settings ---

export interface WebAuthnSettings {
  requireForAdmins: boolean
  requireForVolunteers: boolean
}

export async function getWebAuthnSettings() {
  return request<WebAuthnSettings>('/settings/webauthn')
}

export async function updateWebAuthnSettings(data: Partial<WebAuthnSettings>) {
  return request<WebAuthnSettings>('/settings/webauthn', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Roles (PBAC) ---

export interface RoleDefinition {
  id: string
  name: string
  slug: string
  permissions: string[]
  isDefault: boolean
  isSystem: boolean
  description: string
  /** Hub-key encrypted name (hex ciphertext). */
  encryptedName?: Ciphertext
  /** Hub-key encrypted description (hex ciphertext). */
  encryptedDescription?: Ciphertext
  createdAt: string
  updatedAt: string
}

export async function listRoles() {
  return request<{ roles: RoleDefinition[] }>('/settings/roles')
}

export async function createRole(data: {
  name: string
  slug: string
  permissions: string[]
  description: string
  encryptedName?: Ciphertext
  encryptedDescription?: Ciphertext
}) {
  return request<{ role: RoleDefinition }>('/settings/roles', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateRole(
  id: string,
  data: Partial<{
    name: string
    permissions: string[]
    description: string
    encryptedName: Ciphertext
    encryptedDescription: Ciphertext
  }>
) {
  return request<{ role: RoleDefinition }>(`/settings/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteRole(id: string) {
  return request<{ ok: true }>(`/settings/roles/${id}`, { method: 'DELETE' })
}

export async function getPermissionsCatalog() {
  return request<{
    permissions: Record<string, string>
    byDomain: Record<string, { key: string; label: string }[]>
  }>('/settings/permissions')
}

// --- Types ---

/** @deprecated Use roles array + permissions */
export type UserRole = 'volunteer' | 'admin' | 'reporter'

export interface Volunteer {
  pubkey: string
  name: string
  phone: string
  roles: string[]
  active: boolean
  createdAt: string
  transcriptionEnabled: boolean
  onBreak: boolean
  callPreference: 'phone' | 'browser' | 'both'
  // Messaging capabilities (Epic 68)
  supportedMessagingChannels?: string[] // SMS, WhatsApp, Signal, RCS (empty = all)
  messagingEnabled?: boolean // Whether volunteer can handle messaging conversations
  // E2EE envelope-encrypted name (Phase 2D)
  encryptedName?: Ciphertext
  nameEnvelopes?: RecipientEnvelope[]
}

export interface Shift {
  id: string
  name: string
  /** Hub-key encrypted name (hex ciphertext). */
  encryptedName?: Ciphertext
  startTime: string // HH:mm
  endTime: string // HH:mm
  days: number[] // 0=Sunday, 1=Monday, ..., 6=Saturday
  volunteerPubkeys: string[]
  createdAt: string
}

export interface BanEntry {
  phone: string
  reason: string
  bannedBy: string
  bannedAt: string
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedPhone?: Ciphertext
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedReason?: Ciphertext
  reasonEnvelopes?: RecipientEnvelope[]
}

export interface EncryptedNote {
  id: string
  callId: string
  authorPubkey: string
  encryptedContent: Ciphertext
  createdAt: string
  updatedAt: string
  ephemeralPubkey?: string
  // V2 per-note ECIES envelopes (forward secrecy)
  authorEnvelope?: KeyEnvelope
  adminEnvelopes?: RecipientEnvelope[]
}

export interface ActiveCall {
  id: string
  callerNumber: string
  answeredBy: string | null
  startedAt: string
  status: 'ringing' | 'in-progress' | 'completed' | 'unanswered'
}

export interface CallRecord {
  id: string
  callerLast4?: string
  startedAt: string
  endedAt?: string
  duration?: number
  hasTranscription: boolean
  hasVoicemail: boolean
  hasRecording?: boolean
  recordingSid?: string
  voicemailFileId?: string | null
  status: 'completed' | 'unanswered'

  // Envelope-encrypted metadata (Epic 77)
  encryptedContent?: Ciphertext
  adminEnvelopes?: MessageKeyEnvelope[]

  // Decrypted fields (populated client-side after decryption)
  answeredBy?: string | null
  callerNumber?: string

  // E2EE envelope-encrypted callerLast4 (Phase 2D)
  encryptedCallerLast4?: Ciphertext
  callerLast4Envelopes?: RecipientEnvelope[]
}

export interface AuditLogEntry {
  id: string
  event: string
  actorPubkey: string
  details: Record<string, unknown>
  createdAt: string
  // Chain integrity (Epic 77)
  previousEntryHash?: string
  entryHash?: string
}

export interface VolunteerPresence {
  pubkey: string
  status: 'available' | 'on-call' | 'online'
}

export interface SpamSettings {
  voiceCaptchaEnabled: boolean
  rateLimitEnabled: boolean
  maxCallsPerMinute: number
  blockDurationMinutes: number
  captchaMaxAttempts: number
}

export interface InviteCode {
  code: string
  name: string
  phone: string
  roleIds: string[]
  createdBy: string
  createdAt: string
  expiresAt: string
  usedAt?: string
  deliveryChannel?: string
  deliverySentAt?: string
  // E2EE envelope-encrypted name (Phase 2D)
  encryptedName?: Ciphertext
  nameEnvelopes?: RecipientEnvelope[]
}

// --- Conversations ---

export interface Conversation {
  id: string
  channelType: string
  contactIdentifierHash: string
  contactLast4?: string
  assignedTo?: string
  status: 'active' | 'waiting' | 'closed'
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  messageCount: number
  metadata?: {
    linkedCallId?: string
    reportId?: string
    type?: 'report'
    reportTitle?: string
    reportCategory?: string
  }
  // E2EE envelope-encrypted contactLast4 (Phase 2D)
  encryptedContactLast4?: Ciphertext
  contactLast4Envelopes?: RecipientEnvelope[]
}

export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

/** ECIES-wrapped message key for a specific reader. */
export interface MessageKeyEnvelope {
  pubkey: string // reader's x-only pubkey (hex)
  wrappedKey: Ciphertext // hex: nonce(24) + ciphertext(48)
  ephemeralPubkey: string // hex: compressed 33-byte ephemeral pubkey
}

export interface ConversationMessage {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound'
  authorPubkey: string
  encryptedContent: Ciphertext // hex: nonce(24) + ciphertext (XChaCha20-Poly1305)
  readerEnvelopes: MessageKeyEnvelope[] // per-reader ECIES-wrapped message keys
  hasAttachments: boolean
  attachmentIds?: string[]
  // Delivery status tracking (Epic 71)
  status?: MessageDeliveryStatus
  /** Alias for status — used by UI delivery indicators. */
  deliveryStatus?: MessageDeliveryStatus
  deliveredAt?: string
  readAt?: string
  failureReason?: string
  /** Alias for failureReason — used by UI delivery indicators. */
  deliveryError?: string
  retryCount?: number
  createdAt: string
  externalId?: string
}

export async function listConversations(params?: {
  status?: string
  channel?: string
  page?: number
  limit?: number
}) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.channel) qs.set('channel', params.channel)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{
    conversations: Conversation[]
    total?: number
    assignedCount?: number
    waitingCount?: number
  }>(hp(`/conversations?${qs}`))
}

export async function getConversation(id: string) {
  return request<Conversation>(hp(`/conversations/${id}`))
}

export async function getConversationMessages(
  id: string,
  params?: { page?: number; limit?: number }
) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ messages: ConversationMessage[]; total: number }>(
    hp(`/conversations/${id}/messages?${qs}`)
  )
}

export async function sendConversationMessage(
  id: string,
  data: {
    encryptedContent: Ciphertext
    readerEnvelopes: MessageKeyEnvelope[]
    plaintextForSending?: string
  }
) {
  return request<ConversationMessage>(hp(`/conversations/${id}/messages`), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function claimConversation(id: string) {
  return request<Conversation>(hp(`/conversations/${id}/claim`), { method: 'POST' })
}

export async function updateConversation(
  id: string,
  data: { status?: string; assignedTo?: string }
) {
  return request<Conversation>(hp(`/conversations/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getConversationStats() {
  return request<{ waiting: number; active: number; closed: number; today: number; total: number }>(
    hp('/conversations/stats')
  )
}

export async function getVolunteerLoads() {
  return request<{ loads: Record<string, number> }>(hp('/conversations/load'))
}

// --- Messaging Config ---

export type { MessagingConfig, EnabledChannels } from '@shared/types'
import type { MessagingConfig } from '@shared/types'

export async function getMessagingConfig() {
  return request<MessagingConfig>('/settings/messaging')
}

export async function updateMessagingConfig(data: Partial<MessagingConfig>) {
  return request<MessagingConfig>('/settings/messaging', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function testMessagingChannel(channel: string) {
  return request<{ connected: boolean }>('/settings/messaging/test', {
    method: 'POST',
    body: JSON.stringify({ channel }),
  })
}

// --- Setup State ---

export type { SetupState } from '@shared/types'
import type { SetupState } from '@shared/types'

export async function getSetupState() {
  return request<SetupState>('/setup/state')
}

export async function updateSetupState(data: Partial<SetupState>) {
  return request<SetupState>('/setup/state', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function completeSetup(demoMode = false) {
  return request<SetupState>('/setup/complete', {
    method: 'POST',
    body: JSON.stringify({ demoMode }),
  })
}

export async function testSignalBridge(data: { bridgeUrl: string; bridgeApiKey: string }) {
  return request<{ ok: boolean; error?: string }>('/setup/test/signal', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function testWhatsAppConnection(data: { phoneNumberId: string; accessToken: string }) {
  return request<{ ok: boolean; error?: string }>('/setup/test/whatsapp', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// --- Provider OAuth & Phone Numbers ---

export interface OAuthStartResponse {
  stateToken: string
  provider: string
  mode: 'oauth' | 'manual'
  redirectUrl?: string
  message?: string
  signupUrl: string
  docsUrl: string
}

export interface OAuthStatusResponse {
  provider: string
  status: 'pending' | 'connected' | 'error' | 'expired'
  accountSid?: string
  error?: string
  connectedAt?: string
}

export interface ProviderPhoneNumber {
  phoneNumber: string
  friendlyName: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  locality?: string
  region?: string
  country: string
}

export interface AvailablePhoneNumber extends ProviderPhoneNumber {
  monthlyPrice?: string
}

export interface ProviderCredentials {
  provider: TelephonyProviderType
  accountSid?: string
  authToken?: string
  signalwireSpace?: string
  apiKey?: string
  apiSecret?: string
  applicationId?: string
  authId?: string
  ariUrl?: string
  ariUsername?: string
  ariPassword?: string
}

export async function startProviderOAuth(provider: TelephonyProviderType) {
  return request<OAuthStartResponse>('/setup/provider/oauth/start', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  })
}

export async function getProviderOAuthStatus(stateToken: string) {
  return request<OAuthStatusResponse>(`/setup/provider/oauth/status/${stateToken}`)
}

export async function validateProviderCredentials(credentials: ProviderCredentials) {
  return request<{ ok: boolean; error?: string; accountName?: string }>(
    '/setup/provider/validate',
    {
      method: 'POST',
      body: JSON.stringify(credentials),
    }
  )
}

export async function listProviderPhoneNumbers(credentials: ProviderCredentials) {
  return request<{ numbers: ProviderPhoneNumber[] }>('/setup/provider/phone-numbers', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

export async function searchAvailablePhoneNumbers(
  credentials: ProviderCredentials & { country: string; areaCode?: string; contains?: string }
) {
  return request<{ numbers: AvailablePhoneNumber[] }>('/setup/provider/phone-numbers/search', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

export async function provisionPhoneNumber(
  credentials: ProviderCredentials & { phoneNumber: string }
) {
  return request<{ ok: boolean; phoneNumber: string; error?: string }>(
    '/setup/provider/phone-numbers/provision',
    {
      method: 'POST',
      body: JSON.stringify(credentials),
    }
  )
}

export async function getWebhookUrls() {
  return request<{
    voice: string
    voiceStatus: string
    sms: string
    whatsapp: string
    signal: string
  }>('/setup/provider/webhooks')
}

// --- Signal Registration ---

export interface SignalRegistrationResponse {
  ok: boolean
  method: 'sms' | 'voice'
}

export interface SignalRegistrationStatus {
  status: 'idle' | 'pending' | 'complete' | 'failed'
  method?: 'sms' | 'voice'
  expiresAt?: string
  error?: string
}

export async function startSignalRegistration(data: {
  bridgeUrl: string
  registeredNumber: string
  useVoice?: boolean
}) {
  return request<SignalRegistrationResponse>('/messaging/signal/register', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getSignalRegistrationStatus() {
  return request<SignalRegistrationStatus>('/messaging/signal/registration-status')
}

export async function verifySignalRegistration(code: string) {
  return request<{ ok: boolean }>('/messaging/signal/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

// --- Reports ---

export interface Report extends Conversation {
  metadata: {
    type: 'report'
    reportTitle?: string
    reportCategory?: string
    customFieldValues?: string
    linkedCallId?: string
    reportId?: string
  }
}

export async function listReports(params?: {
  status?: string
  category?: string
  page?: number
  limit?: number
}) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.category) qs.set('category', params.category)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ conversations: Report[]; total: number }>(hp(`/reports?${qs}`))
}

export async function createReport(data: {
  title: string
  category?: string
  reportTypeId?: string
  encryptedContent: Ciphertext
  readerEnvelopes: MessageKeyEnvelope[]
}) {
  return request<Report>(hp('/reports'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getReport(id: string) {
  return request<Report>(hp(`/reports/${id}`))
}

export async function getReportMessages(id: string, params?: { page?: number; limit?: number }) {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<{ messages: ConversationMessage[]; total: number }>(
    hp(`/reports/${id}/messages?${qs}`)
  )
}

export async function sendReportMessage(
  id: string,
  data: {
    encryptedContent: Ciphertext
    readerEnvelopes: MessageKeyEnvelope[]
    attachmentIds?: string[]
  }
) {
  return request<ConversationMessage>(hp(`/reports/${id}/messages`), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function assignReport(id: string, assignedTo: string) {
  return request<Report>(hp(`/reports/${id}/assign`), {
    method: 'POST',
    body: JSON.stringify({ assignedTo }),
  })
}

export async function updateReport(id: string, data: { status?: string }) {
  return request<Report>(hp(`/reports/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getReportCategories() {
  return request<{ categories: string[] }>(hp('/reports/categories'))
}

// --- Report Types ---

import type { CreateReportTypeInput, ReportType, UpdateReportTypeInput } from '@shared/types'
export type { ReportType }

export async function listReportTypes() {
  return request<{ reportTypes: ReportType[] }>(hp('/report-types'))
}

export async function createReportType(data: CreateReportTypeInput) {
  return request<{ reportType: ReportType }>(hp('/report-types'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateReportType(id: string, data: UpdateReportTypeInput) {
  return request<{ reportType: ReportType }>(hp(`/report-types/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function archiveReportType(id: string) {
  return request<{ reportType: ReportType }>(hp(`/report-types/${id}`), {
    method: 'DELETE',
  })
}

export async function unarchiveReportType(id: string) {
  return request<{ reportType: ReportType }>(hp(`/report-types/${id}/unarchive`), {
    method: 'POST',
  })
}

export async function setDefaultReportType(id: string) {
  return request<{ reportType: ReportType }>(hp(`/report-types/${id}/default`), {
    method: 'POST',
  })
}

export async function getReportFiles(id: string) {
  return request<{ files: import('@shared/types').FileRecord[] }>(hp(`/reports/${id}/files`))
}

// --- File Uploads ---

export async function initUpload(data: import('@shared/types').UploadInit) {
  return request<{ uploadId: string; totalChunks: number }>('/uploads/init', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function uploadChunk(uploadId: string, chunkIndex: number, data: ArrayBuffer) {
  const headers = {
    ...getAuthHeaders(),
    'Content-Type': 'application/octet-stream',
  }
  const res = await fetch(`${API_BASE}/uploads/${uploadId}/chunks/${chunkIndex}`, {
    method: 'PUT',
    headers,
    body: data,
  })
  if (!res.ok) {
    if (res.status === 401) onAuthExpired?.()
    throw new ApiError(res.status, await res.text())
  }
  onApiActivity?.()
  return res.json() as Promise<{ chunkIndex: number; completedChunks: number; totalChunks: number }>
}

export async function completeUpload(uploadId: string) {
  return request<{ fileId: string; status: string }>(`/uploads/${uploadId}/complete`, {
    method: 'POST',
  })
}

export async function getUploadStatus(uploadId: string) {
  return request<{
    uploadId: string
    status: string
    completedChunks: number
    totalChunks: number
  }>(`/uploads/${uploadId}/status`)
}

export async function downloadFile(fileId: string): Promise<ArrayBuffer> {
  const headers = getAuthHeaders()
  const res = await fetch(`${API_BASE}/files/${fileId}/content`, { headers })
  if (!res.ok) {
    if (res.status === 401) onAuthExpired?.()
    throw new ApiError(res.status, await res.text())
  }
  onApiActivity?.()
  return res.arrayBuffer()
}

export async function getFileEnvelopes(fileId: string) {
  return request<{ envelopes: import('@shared/types').FileKeyEnvelope[] }>(
    `/files/${fileId}/envelopes`
  )
}

export async function getFileMetadata(fileId: string) {
  return request<{
    metadata: EncryptedMetaItem[]
  }>(`/files/${fileId}/metadata`)
}

export async function shareFile(
  fileId: string,
  data: {
    envelope: import('@shared/types').FileKeyEnvelope
    encryptedMetadata: EncryptedMetaItem
  }
) {
  return request<{ ok: true }>(`/files/${fileId}/share`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// --- Demo Seed ---

export async function seedDemoData() {
  const { DEMO_ACCOUNTS } = await import('@shared/demo-accounts')

  // Create demo volunteers (admin is already created via ADMIN_PUBKEY)
  const nonAdminAccounts = DEMO_ACCOUNTS.filter((a) => !a.roleIds.includes('role-super-admin'))
  for (const account of nonAdminAccounts) {
    try {
      await createVolunteer({
        name: account.name,
        phone: account.phone,
        roleIds: account.roleIds,
        pubkey: account.pubkey,
      })
    } catch {
      /* may already exist */
    }
  }

  // Deactivate Fatima (inactive volunteer demo)
  const fatima = DEMO_ACCOUNTS.find((a) => a.name === 'Fatima Al-Rashid')
  if (fatima) {
    try {
      await request(`/volunteers/${fatima.pubkey}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      })
    } catch {
      /* ignore */
    }
  }

  // Mark all demo profiles as completed and set browser call preference
  for (const account of nonAdminAccounts) {
    try {
      await request(`/volunteers/${account.pubkey}`, {
        method: 'PATCH',
        body: JSON.stringify({
          profileCompleted: true,
          callPreference: 'browser',
          spokenLanguages: account.spokenLanguages,
        }),
      })
    } catch {
      /* ignore */
    }
  }

  // Create shifts
  const maria = DEMO_ACCOUNTS.find((a) => a.name === 'Maria Santos')!
  const james = DEMO_ACCOUNTS.find((a) => a.name === 'James Chen')!
  const shifts = [
    {
      name: 'Morning Team',
      startTime: '08:00',
      endTime: '16:00',
      days: [1, 2, 3, 4, 5],
      volunteerPubkeys: [maria.pubkey, james.pubkey],
      createdAt: new Date().toISOString(),
    },
    {
      name: 'Evening Team',
      startTime: '16:00',
      endTime: '23:59',
      days: [1, 2, 3, 4, 5],
      volunteerPubkeys: [maria.pubkey],
      createdAt: new Date().toISOString(),
    },
    {
      name: 'Weekend Coverage',
      startTime: '10:00',
      endTime: '18:00',
      days: [0, 6],
      volunteerPubkeys: [james.pubkey],
      createdAt: new Date().toISOString(),
    },
  ]
  for (const shift of shifts) {
    try {
      await createShift(shift)
    } catch {
      /* ignore */
    }
  }

  // Add sample bans
  const bans = [
    { phone: '+15559999001', reason: 'Repeated prank calls' },
    { phone: '+15559999002', reason: 'Threatening language towards volunteers' },
  ]
  for (const ban of bans) {
    try {
      await addBan(ban)
    } catch {
      /* ignore */
    }
  }
}

// --- Blasts ---

import type { Blast, BlastContent, BlastSettings, Subscriber } from '@shared/types'
export type { Subscriber, Blast, BlastContent, BlastSettings }

export async function listSubscribers(params?: {
  tag?: string
  channel?: string
  status?: string
}) {
  const searchParams = new URLSearchParams()
  if (params?.tag) searchParams.set('tag', params.tag)
  if (params?.channel) searchParams.set('channel', params.channel)
  if (params?.status) searchParams.set('status', params.status)
  const qs = searchParams.toString()
  return request<{ subscribers: Subscriber[] }>(hp(`/blasts/subscribers${qs ? `?${qs}` : ''}`))
}

export async function importSubscribers(data: {
  subscribers: Array<{ identifier: string; channel: string; tags?: string[]; language?: string }>
}) {
  return request<{ imported: number; skipped: number }>(hp('/blasts/subscribers/import'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function removeSubscriber(id: string) {
  return request<{ ok: boolean }>(hp(`/blasts/subscribers/${id}`), { method: 'DELETE' })
}

export async function getSubscriberStats() {
  return request<{
    total: number
    active: number
    paused: number
    byChannel: Record<string, number>
  }>(hp('/blasts/subscribers/stats'))
}

export async function listBlasts() {
  return request<{ blasts: Blast[] }>(hp('/blasts'))
}

export async function createBlast(data: {
  name: string
  encryptedContent: Ciphertext
  contentEnvelopes: RecipientEnvelope[]
  targetChannels: string[]
  targetTags?: string[]
  targetLanguages?: string[]
}) {
  return request<{ blast: Blast }>(hp('/blasts'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateBlast(id: string, data: Partial<Blast>) {
  return request<{ blast: Blast }>(hp(`/blasts/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteBlast(id: string) {
  return request<{ ok: boolean }>(hp(`/blasts/${id}`), { method: 'DELETE' })
}

export async function sendBlast(id: string) {
  return request<{ blast: Blast }>(hp(`/blasts/${id}/send`), { method: 'POST' })
}

export async function scheduleBlast(id: string, scheduledAt: string) {
  return request<{ blast: Blast }>(hp(`/blasts/${id}/schedule`), {
    method: 'POST',
    body: JSON.stringify({ scheduledAt }),
  })
}

export async function cancelBlast(id: string) {
  return request<{ blast: Blast }>(hp(`/blasts/${id}/cancel`), { method: 'POST' })
}

export async function getBlastSettings() {
  return request<BlastSettings>(hp('/blasts/settings'))
}

export async function updateBlastSettings(data: Partial<BlastSettings>) {
  return request<BlastSettings>(hp('/blasts/settings'), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Hub Management ---

export type { Hub } from '@shared/types'
import type { Hub } from '@shared/types'

export async function listHubs() {
  return request<{ hubs: Hub[] }>('/hubs')
}

export async function createHub(data: {
  name: string
  slug?: string
  description?: string
  phoneNumber?: string
}) {
  return request<{ hub: Hub }>('/hubs', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getHub(hubId: string) {
  return request<{ hub: Hub }>(`/hubs/${hubId}`)
}

export async function updateHub(hubId: string, data: Partial<Hub>) {
  return request<{ hub: Hub }>(`/hubs/${hubId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function addHubMember(hubId: string, pubkey: string, roleIds: string[]) {
  return request<{ ok: true }>(`/hubs/${hubId}/members`, {
    method: 'POST',
    body: JSON.stringify({ pubkey, roleIds }),
  })
}

export async function removeHubMember(hubId: string, pubkey: string) {
  return request<{ ok: true }>(`/hubs/${hubId}/members/${pubkey}`, { method: 'DELETE' })
}

// --- Geocoding ---

import type { GeocodingConfig, GeocodingConfigAdmin, LocationResult } from '@shared/types'
export type { GeocodingConfig, GeocodingConfigAdmin, LocationResult } from '@shared/types'

export async function geocodingAutocomplete(query: string, limit = 5) {
  return request<LocationResult[]>('/geocoding/autocomplete', {
    method: 'POST',
    body: JSON.stringify({ query, limit }),
  })
}

export async function geocodingGeocode(address: string) {
  return request<LocationResult | null>('/geocoding/geocode', {
    method: 'POST',
    body: JSON.stringify({ address }),
  })
}

export async function geocodingReverse(lat: number, lon: number) {
  return request<LocationResult | null>('/geocoding/reverse', {
    method: 'POST',
    body: JSON.stringify({ lat, lon }),
  })
}

export async function getGeocodingConfig() {
  return request<GeocodingConfig>('/geocoding/config')
}

export async function getGeocodingSettings() {
  return request<GeocodingConfigAdmin>('/geocoding/settings')
}

export async function updateGeocodingSettings(config: Partial<GeocodingConfigAdmin>) {
  return request<GeocodingConfigAdmin>('/geocoding/settings', {
    method: 'PATCH',
    body: JSON.stringify(config),
  })
}

export async function testGeocodingProvider() {
  return request<{ ok: boolean; latency: number; error?: string }>('/geocoding/test')
}

// --- Retention Settings (GDPR) ---

import type { RetentionSettings } from '@shared/types'
export type { RetentionSettings }

export async function getRetentionSettings() {
  return request<RetentionSettings>('/settings/retention')
}

export async function updateRetentionSettings(data: Partial<RetentionSettings>) {
  return request<RetentionSettings>('/settings/retention', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// --- Dashboard Analytics ---

export interface CallHourBucket {
  hour: number
  count: number
}

export interface CallVolumeDay {
  date: string
  count: number
  answered: number
  voicemail: number
}

export interface VolunteerStatEntry {
  pubkey: string
  name: string
  callsAnswered: number
  callsHandled: number
  avgDuration: number
  notesCreated: number
}

export async function getCallAnalytics(days?: number) {
  const qs = days ? `?days=${days}` : ''
  return request<{ data: CallVolumeDay[] }>(hp(`/analytics/call-volume${qs}`))
}

export async function getCallHoursAnalytics() {
  return request<{ data: CallHourBucket[] }>(hp('/analytics/call-hours'))
}

export async function getVolunteerStats() {
  return request<{ data: VolunteerStatEntry[] }>(hp('/analytics/volunteer-stats'))
}

// --- Consent (GDPR) ---

export async function getConsentStatus() {
  return request<{ hasConsented: boolean; consentVersion: string }>('/auth/me/consent')
}

export async function submitConsent(version: string) {
  return request<{ ok: true }>('/auth/me/consent', {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

// --- Hub Key Envelopes ---

export async function getMyHubKeyEnvelope(hubId: string) {
  return request<{
    wrappedKey: Ciphertext
    ephemeralPubkey: string
    ephemeralPk?: string
  } | null>(`/hubs/${hubId}/key-envelope`)
}

// --- File Upload Context Binding ---

export async function bindUploadContext(fileId: string, contextType: string, contextId: string) {
  return request<{ ok: true }>(`/files/${fileId}/context`, {
    method: 'PATCH',
    body: JSON.stringify({ contextType, contextId }),
  })
}

// --- Call Detail ---

export async function getCallDetail(callId: string) {
  return request<{
    call: CallRecord
    notes: EncryptedNote[]
    auditEntries: AuditLogEntry[]
  }>(hp(`/calls/${callId}`))
}

// --- Note Detail ---

export async function getNote(noteId: string) {
  return request<{ note: EncryptedNote }>(hp(`/notes/${noteId}`))
}

// --- Account Erasure (GDPR) ---

export interface ErasureRequest {
  id: string
  pubkey: string
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'executed'
  requestedAt: string
  executeAt: string
  scheduledAt?: string
  completedAt?: string
  cancelledAt?: string
}

export async function getMyErasureRequest() {
  const res = await request<{ request: ErasureRequest | null }>('/gdpr/me/erasure')
  return res.request
}

export async function requestAccountErasure() {
  const res = await request<{ request: ErasureRequest }>('/gdpr/me', { method: 'DELETE' })
  return res.request
}

export async function cancelAccountErasure() {
  return request<{ ok: true }>('/gdpr/me/cancel', { method: 'DELETE' })
}

export async function downloadMyData() {
  const headers = getAuthHeaders()
  const res = await fetch(`${API_BASE}/gdpr/export`, { headers })
  if (!res.ok) {
    if (res.status === 401) onAuthExpired?.()
    throw new ApiError(res.status, await res.text())
  }
  onApiActivity?.()
  return res.blob()
}

// --- Invite Delivery ---

export type InviteDeliveryChannel = 'sms' | 'whatsapp' | 'signal' | 'email'

export async function getAvailableInviteChannels() {
  return request<{ signal: boolean; whatsapp: boolean; sms: boolean }>('/invites/channels')
}

export async function sendInvite(
  code: string,
  data: {
    recipientPhone: string
    channel: InviteDeliveryChannel
    acknowledgedInsecure?: boolean
  }
) {
  return request<{ ok: true }>(`/invites/${code}/send`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// --- Volunteer Admin (unmasked) ---

export async function getVolunteerUnmasked(pubkey: string) {
  return request<{ volunteer: Volunteer & { phone: string } }>(`/volunteers/${pubkey}/unmasked`)
}

// --- Hub Archive & Delete ---

export async function archiveHub(hubId: string) {
  return request<{ hub: Hub }>(`/hubs/${hubId}/archive`, { method: 'POST' })
}

export async function deleteHub(hubId: string) {
  return request<{ ok: true }>(`/hubs/${hubId}`, { method: 'DELETE' })
}

export type HubExportCategory =
  | 'notes'
  | 'calls'
  | 'conversations'
  | 'audit'
  | 'voicemails'
  | 'attachments'

export async function exportHubData(hubId: string, categories: HubExportCategory[]) {
  const params = new URLSearchParams({ categories: categories.join(',') })
  const path = `/hubs/${hubId}/export?${params.toString()}`
  const pathOnly = `/hubs/${hubId}/export`
  const headers = getAuthHeaders()
  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) {
    if (res.status === 401) onAuthExpired?.()
    throw new ApiError(res.status, await res.text())
  }
  onApiActivity?.()
  return res.blob()
}

// --- Push Notifications ---

export async function subscribePush(data: {
  endpoint: string
  keys: { p256dh: string; auth: string }
  deviceLabel?: string
}) {
  return request<{ ok: true }>('/notifications/subscribe', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function unsubscribePush(endpoint: string) {
  return request<{ ok: true }>('/notifications/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  })
}

// --- Contacts ---

export interface ContactRecord {
  id: string
  hubId: string
  contactType: string
  riskLevel: string
  tags: string[]
  identifierHash: string | null
  encryptedDisplayName: string
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes: string | null
  notesEnvelopes: RecipientEnvelope[]
  encryptedFullName: string | null
  fullNameEnvelopes: RecipientEnvelope[]
  encryptedPhone: string | null
  phoneEnvelopes: RecipientEnvelope[]
  encryptedPII: string | null
  piiEnvelopes: RecipientEnvelope[]
  createdBy: string
  createdAt: string
  updatedAt: string
  lastInteractionAt: string | null
}

export interface ContactRelationshipRecord {
  id: string
  hubId: string
  encryptedPayload: string
  payloadEnvelopes: RecipientEnvelope[]
  createdBy: string
  createdAt: string
}

export async function listContacts(filters?: {
  contactType?: string
  riskLevel?: string
}): Promise<{ contacts: ContactRecord[]; total: number }> {
  const params = new URLSearchParams()
  if (filters?.contactType) params.set('contactType', filters.contactType)
  if (filters?.riskLevel) params.set('riskLevel', filters.riskLevel)
  const qs = params.toString()
  return request(hp(`/contacts${qs ? `?${qs}` : ''}`))
}

export async function getContact(id: string): Promise<ContactRecord> {
  const data = await request<{ contact: ContactRecord }>(hp(`/contacts/${id}`))
  return data.contact
}

export async function createContact(data: {
  contactType: string
  riskLevel: string
  tags: string[]
  identifierHash?: string
  encryptedDisplayName: string
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes?: string
  notesEnvelopes?: RecipientEnvelope[]
  encryptedFullName?: string
  fullNameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedPII?: string
  piiEnvelopes?: RecipientEnvelope[]
}): Promise<ContactRecord> {
  return request(hp('/contacts'), { method: 'POST', body: JSON.stringify(data) })
}

export async function updateContact(
  id: string,
  data: Record<string, unknown>
): Promise<ContactRecord> {
  return request(hp(`/contacts/${id}`), { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteContact(id: string): Promise<void> {
  return request(hp(`/contacts/${id}`), { method: 'DELETE' })
}

export async function getContactTimeline(id: string): Promise<{
  calls: unknown[]
  conversations: unknown[]
  notes: unknown[]
}> {
  return request(hp(`/contacts/${id}/timeline`))
}

export async function linkToContact(
  contactId: string,
  type: 'call' | 'conversation',
  targetId: string
): Promise<void> {
  return request(hp(`/contacts/${contactId}/link`), {
    method: 'POST',
    body: JSON.stringify({ type, targetId }),
  })
}

export async function checkContactDuplicate(phone: string): Promise<{
  exists: boolean
  contactId?: string
}> {
  return request(hp(`/contacts/check-duplicate?phone=${encodeURIComponent(phone)}`))
}

export async function hashContactPhone(phone: string): Promise<{ identifierHash: string }> {
  return request(hp('/contacts/hash-phone'), {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
}

export async function getContactRecipients(): Promise<{
  summaryPubkeys: string[]
  piiPubkeys: string[]
}> {
  return request(hp('/contacts/recipients'))
}

export async function listContactRelationships(): Promise<ContactRelationshipRecord[]> {
  const data = await request<{ relationships: ContactRelationshipRecord[] }>(
    hp('/contacts/relationships')
  )
  return data.relationships
}

export async function createContactRelationship(data: {
  encryptedPayload: string
  payloadEnvelopes: RecipientEnvelope[]
}): Promise<ContactRelationshipRecord> {
  return request(hp('/contacts/relationships'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteContactRelationship(id: string): Promise<void> {
  return request(hp(`/contacts/relationships/${id}`), { method: 'DELETE' })
}
