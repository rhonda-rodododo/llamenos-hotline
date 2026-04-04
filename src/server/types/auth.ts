import type { RecipientEnvelope } from '../../shared/types'

/** @deprecated Use roles array + permission system instead */
export type UserRole = 'volunteer' | 'admin' | 'reporter'

export interface AuthPayload {
  pubkey: string
  timestamp: number
  token: string
}

export interface ServerSession {
  token: string // Random 256-bit hex
  pubkey: string // Which user
  createdAt: string
  expiresAt: string // 8-hour expiry
}

export interface WebAuthnCredential {
  id: string // Base64URL credential ID
  publicKey: string // Base64URL public key bytes
  counter: number // Signature counter (clone detection)
  transports: string[] // ['internal', 'hybrid', etc.]
  backedUp: boolean // Cloud-synced passkey
  label: string // User-assigned name ("My Phone") — '[encrypted]' when E2EE
  createdAt: string
  lastUsedAt: string
  // E2EE envelope-encrypted label (Phase 2D)
  encryptedLabel?: string
  labelEnvelopes?: RecipientEnvelope[]
}

export interface WebAuthnSettings {
  requireForAdmins: boolean
  requireForUsers: boolean
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

export interface CreateSessionData {
  pubkey: string
}

export interface CreateWebAuthnChallengeData {
  id: string
  challenge: string
  pubkey?: string
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
