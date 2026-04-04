import type { MessagingChannelType, RecipientEnvelope } from '../../shared/types'

export interface User {
  pubkey: string
  name: string
  phone: string
  roles: string[] // Global role IDs (e.g., ['role-super-admin', 'role-volunteer'])
  hubRoles?: { hubId: string; roleIds: string[] }[] // Per-hub role assignments
  active: boolean
  createdAt: string
  encryptedSecretKey: string // Admin-encrypted copy of the user's nsec
  transcriptionEnabled: boolean
  spokenLanguages: string[] // Languages user can take calls in (e.g. ['en', 'es'])
  uiLanguage: string // Preferred UI language
  profileCompleted: boolean // Whether first-login setup is done
  onBreak: boolean // Temporarily unavailable (still on shift)
  callPreference: 'phone' | 'browser' | 'both' // How to receive calls (default: 'phone')
  // Messaging channel capabilities (Epic 68)
  supportedMessagingChannels?: MessagingChannelType[] // SMS, WhatsApp, Signal, RCS (empty = all)
  messagingEnabled?: boolean // Whether user can handle messaging conversations
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedName?: string // ECIES ciphertext
  nameEnvelopes?: RecipientEnvelope[] // Per-recipient wrapped keys
  encryptedPhone?: string // ECIES ciphertext (when envelope-encrypted)
  phoneEnvelopes?: RecipientEnvelope[] // Per-recipient wrapped keys for phone
}

export interface CreateUserData {
  pubkey: string
  name: string
  phone: string
  roleIds?: string[]
  roles?: string[]
  encryptedSecretKey: string
}

export interface UpdateUserData {
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
  recipientPhoneHash?: string
  deliveryChannel?: string
  deliverySentAt?: string
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedName?: string
  nameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
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

export interface SetHubRoleData {
  pubkey: string
  hubId: string
  roleIds: string[]
}

export interface BanEntry {
  phone: string
  reason: string
  bannedBy: string
  bannedAt: string
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedReason?: string
  reasonEnvelopes?: RecipientEnvelope[]
}

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
