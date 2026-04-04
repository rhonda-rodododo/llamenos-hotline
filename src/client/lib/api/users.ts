import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { request } from './client'

// --- Types ---

export interface User {
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
  messagingEnabled?: boolean // Whether user can handle messaging conversations
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedName?: Ciphertext
  nameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: Ciphertext
  phoneEnvelopes?: RecipientEnvelope[]
}

export interface UserPresence {
  pubkey: string
  status: 'available' | 'on-call' | 'online'
}

// --- Users (admin only) ---

export async function listUsers() {
  return request<{ users: User[] }>('/users')
}

export async function createUser(data: {
  name: string
  phone: string
  roleIds: string[]
  pubkey: string
}) {
  return request<{ user: User }>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateUser(
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
  return request<{ user: User }>(`/users/${pubkey}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteUser(pubkey: string) {
  return request<{ ok: true }>(`/users/${pubkey}`, { method: 'DELETE' })
}

// --- User Admin (unmasked) ---

export async function getUserUnmasked(pubkey: string) {
  return request<{ user: User & { phone: string } }>(`/users/${pubkey}/unmasked`)
}

// --- User Presence (admin only) ---

export async function getUserPresence() {
  return request<{ users: UserPresence[] }>('/calls/presence')
}
