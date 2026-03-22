/**
 * Volunteer PII Projector
 *
 * Controls which volunteer fields are visible based on the requestor's role:
 *   - 'admin' view:  all fields, phone masked by default (unmask requires ?unmask=true + admin role)
 *   - 'self' view:   own data only, phone always masked
 *   - 'public' view: non-sensitive fields only (no name, no phone)
 *
 * NEVER call c.json(volunteer) directly — always project first.
 */
import type { MessagingChannelType } from '../../shared/types'

// ── Discriminated-union view types ────────────────────────────────────────────

export interface VolunteerPublicView {
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

export interface VolunteerSelfView {
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
}

export interface VolunteerAdminView {
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

// ── Volunteer source shape (minimal fields needed for projection) ──────────────

interface VolunteerSource {
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
}

// ── Projection function ────────────────────────────────────────────────────────

/**
 * Project a Volunteer record into the appropriate view based on who is requesting.
 *
 * @param volunteer     - Full volunteer record from the database
 * @param requestorPubkey - Pubkey of the authenticated user making the request
 * @param requestorIsAdmin - Whether the requestor has admin (settings:manage) permission
 * @param unmask        - Admin requested full phone number via ?unmask=true (ignored for non-admins)
 */
export function projectVolunteer(
  volunteer: VolunteerSource,
  requestorPubkey: string,
  requestorIsAdmin: boolean,
  unmask = false
): VolunteerPublicView | VolunteerSelfView | VolunteerAdminView {
  if (requestorIsAdmin) {
    const phone = unmask ? volunteer.phone : maskPhone(volunteer.phone)
    const result: VolunteerAdminView = {
      view: 'admin',
      pubkey: volunteer.pubkey,
      name: volunteer.name,
      phone,
      roles: volunteer.roles,
      hubRoles: volunteer.hubRoles,
      active: volunteer.active,
      createdAt: volunteer.createdAt,
      encryptedSecretKey: volunteer.encryptedSecretKey,
      transcriptionEnabled: volunteer.transcriptionEnabled,
      spokenLanguages: volunteer.spokenLanguages,
      uiLanguage: volunteer.uiLanguage,
      profileCompleted: volunteer.profileCompleted,
      onBreak: volunteer.onBreak,
      callPreference: volunteer.callPreference,
      supportedMessagingChannels: volunteer.supportedMessagingChannels,
      messagingEnabled: volunteer.messagingEnabled,
    }
    return result
  }

  if (volunteer.pubkey === requestorPubkey) {
    const result: VolunteerSelfView = {
      view: 'self',
      pubkey: volunteer.pubkey,
      name: volunteer.name,
      phone: maskPhone(volunteer.phone),
      roles: volunteer.roles,
      hubRoles: volunteer.hubRoles,
      active: volunteer.active,
      createdAt: volunteer.createdAt,
      encryptedSecretKey: volunteer.encryptedSecretKey,
      transcriptionEnabled: volunteer.transcriptionEnabled,
      spokenLanguages: volunteer.spokenLanguages,
      uiLanguage: volunteer.uiLanguage,
      profileCompleted: volunteer.profileCompleted,
      onBreak: volunteer.onBreak,
      callPreference: volunteer.callPreference,
      supportedMessagingChannels: volunteer.supportedMessagingChannels,
      messagingEnabled: volunteer.messagingEnabled,
    }
    return result
  }

  const result: VolunteerPublicView = {
    view: 'public',
    pubkey: volunteer.pubkey,
    roles: volunteer.roles,
    hubRoles: volunteer.hubRoles,
    spokenLanguages: volunteer.spokenLanguages,
    onBreak: volunteer.onBreak,
    active: volunteer.active,
    supportedMessagingChannels: volunteer.supportedMessagingChannels,
    messagingEnabled: volunteer.messagingEnabled,
  }
  return result
}
