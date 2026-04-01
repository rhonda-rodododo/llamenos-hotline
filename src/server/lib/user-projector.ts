/**
 * User PII Projector
 *
 * Controls which user fields are visible based on the requestor's role:
 *   - 'admin' view:  all fields, phone masked by default (unmask requires ?unmask=true + admin role)
 *   - 'self' view:   own data only, phone always masked
 *   - 'public' view: non-sensitive fields only (no name, no phone)
 *
 * NEVER call c.json(user) directly — always project first.
 */
import type { MessagingChannelType, RecipientEnvelope } from '../../shared/types'

// ── Discriminated-union view types ────────────────────────────────────────────

export interface UserPublicView {
  readonly view: 'public'
  pubkey: string
  roles: string[]
  hubRoles?: { hubId: string; roleIds: string[] }[]
  spokenLanguages: string[]
  onBreak: boolean
  active: boolean
  lastSeenAt?: string
  supportedMessagingChannels?: MessagingChannelType[]
  messagingEnabled?: boolean
}

export interface UserSelfView {
  readonly view: 'self'
  pubkey: string
  name: string
  phone: string // always masked
  roles: string[]
  hubRoles?: { hubId: string; roleIds: string[] }[]
  active: boolean
  createdAt: string
  encryptedSecretKey: string
  transcriptionEnabled: boolean
  spokenLanguages: string[]
  uiLanguage: string
  profileCompleted: boolean
  onBreak: boolean
  callPreference: 'phone' | 'browser' | 'both'
  supportedMessagingChannels?: MessagingChannelType[]
  messagingEnabled?: boolean
  // E2EE envelope fields (Phase 2D) — present when phone is envelope-encrypted
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
}

export interface UserAdminView {
  readonly view: 'admin'
  pubkey: string
  name: string
  phone: string // masked unless unmask=true was explicitly requested
  roles: string[]
  hubRoles?: { hubId: string; roleIds: string[] }[]
  active: boolean
  createdAt: string
  encryptedSecretKey: string
  transcriptionEnabled: boolean
  spokenLanguages: string[]
  uiLanguage: string
  profileCompleted: boolean
  onBreak: boolean
  callPreference: 'phone' | 'browser' | 'both'
  supportedMessagingChannels?: MessagingChannelType[]
  messagingEnabled?: boolean
  // E2EE envelope fields (Phase 2D) — present when name/phone is envelope-encrypted
  encryptedName?: string
  nameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
}

// ── Phone masking ──────────────────────────────────────────────────────────────

/**
 * Mask a phone number for display.
 * E.g. "+15555551234" → "+1•••••1234" (last 4 digits visible, everything else except country prefix masked)
 * Falls back gracefully for short/malformed numbers.
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return phone
  return phone.slice(0, 3) + '•'.repeat(phone.length - 5) + phone.slice(-2)
}

// ── User source shape (minimal fields needed for projection) ──────────────

interface UserSource {
  pubkey: string
  name: string
  phone: string
  roles: string[]
  hubRoles?: { hubId: string; roleIds: string[] }[]
  active: boolean
  createdAt: string
  encryptedSecretKey: string
  transcriptionEnabled: boolean
  spokenLanguages: string[]
  uiLanguage: string
  profileCompleted: boolean
  onBreak: boolean
  callPreference: 'phone' | 'browser' | 'both'
  supportedMessagingChannels?: MessagingChannelType[]
  messagingEnabled?: boolean
  // E2EE envelope fields (Phase 2D)
  encryptedName?: string
  nameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
}

// ── Projection function ────────────────────────────────────────────────────────

/**
 * Project a User record into the appropriate view based on who is requesting.
 *
 * @param user              - Full user record from the database
 * @param requestorPubkey   - Pubkey of the authenticated user making the request
 * @param requestorIsAdmin  - Whether the requestor has admin (settings:manage) permission
 * @param unmask            - Admin requested full phone number via ?unmask=true (ignored for non-admins)
 */
export function projectUser(
  user: UserSource,
  requestorPubkey: string,
  requestorIsAdmin: boolean,
  unmask = false
): UserPublicView | UserSelfView | UserAdminView {
  if (requestorIsAdmin) {
    const phone = unmask ? user.phone : maskPhone(user.phone)
    const result: UserAdminView = {
      view: 'admin',
      pubkey: user.pubkey,
      name: user.name,
      phone,
      roles: user.roles,
      hubRoles: user.hubRoles,
      active: user.active,
      createdAt: user.createdAt,
      encryptedSecretKey: user.encryptedSecretKey,
      transcriptionEnabled: user.transcriptionEnabled,
      spokenLanguages: user.spokenLanguages,
      uiLanguage: user.uiLanguage,
      profileCompleted: user.profileCompleted,
      onBreak: user.onBreak,
      callPreference: user.callPreference,
      supportedMessagingChannels: user.supportedMessagingChannels,
      messagingEnabled: user.messagingEnabled,
      // E2EE envelope fields — pass through for client-side decryption
      encryptedName: user.encryptedName,
      nameEnvelopes: user.nameEnvelopes,
      encryptedPhone: user.encryptedPhone,
      phoneEnvelopes: user.phoneEnvelopes,
    }
    return result
  }

  if (user.pubkey === requestorPubkey) {
    const result: UserSelfView = {
      view: 'self',
      pubkey: user.pubkey,
      name: user.name,
      phone: maskPhone(user.phone),
      roles: user.roles,
      hubRoles: user.hubRoles,
      active: user.active,
      createdAt: user.createdAt,
      encryptedSecretKey: user.encryptedSecretKey,
      transcriptionEnabled: user.transcriptionEnabled,
      spokenLanguages: user.spokenLanguages,
      uiLanguage: user.uiLanguage,
      profileCompleted: user.profileCompleted,
      onBreak: user.onBreak,
      callPreference: user.callPreference,
      supportedMessagingChannels: user.supportedMessagingChannels,
      messagingEnabled: user.messagingEnabled,
      // E2EE envelope fields — pass through for client-side decryption
      encryptedPhone: user.encryptedPhone,
      phoneEnvelopes: user.phoneEnvelopes,
    }
    return result
  }

  const result: UserPublicView = {
    view: 'public',
    pubkey: user.pubkey,
    roles: user.roles,
    hubRoles: user.hubRoles,
    spokenLanguages: user.spokenLanguages,
    onBreak: user.onBreak,
    active: user.active,
    supportedMessagingChannels: user.supportedMessagingChannels,
    messagingEnabled: user.messagingEnabled,
  }
  return result
}
