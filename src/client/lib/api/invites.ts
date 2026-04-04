import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { API_BASE, ApiError, request } from './client'
import type { User } from './users'

// --- Types ---

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
  // E2EE envelope-encrypted fields (Phase 2D)
  encryptedName?: Ciphertext
  nameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: Ciphertext
  phoneEnvelopes?: RecipientEnvelope[]
}

export type InviteDeliveryChannel = 'sms' | 'whatsapp' | 'signal' | 'email'

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
  return res.json() as Promise<{ user: User; nsecSecret?: string; accessToken?: string }>
}

// --- Invite Delivery ---

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
