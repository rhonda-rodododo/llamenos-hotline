import type { SipTrunkConfig } from '../../shared/types'

// --- Result types ---

export interface OAuthStartResult {
  authUrl: string
}

export interface ConfigureResult {
  ok: true
}

export interface SelectNumberResult {
  ok: true
  webhooksConfigured: true
  sipTrunk?: SipTrunkConfig
}

export interface ProvisionNumberResult {
  phoneNumber: string
  sid?: string
}

export interface A2pBrandResult {
  brandSid: string
  status: 'pending'
}

export interface A2pCampaignResult {
  campaignSid: string
  status: 'pending'
}

export interface A2pStatusResult {
  brandStatus: 'pending' | 'approved' | 'failed'
  campaignStatus?: 'pending' | 'approved' | 'failed'
  campaignSid?: string
}

// --- Credential shapes (plaintext, only live in memory, never persisted) ---

export interface TwilioCredentials {
  accountSid: string
  accessToken: string
  refreshToken: string
  subAccountSid?: string
}

export interface TelnyxCredentials {
  accessToken: string
}

export interface ApiKeyCredentials {
  [key: string]: string
}

// --- Error types ---

export class ProviderApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(message)
    this.name = 'ProviderApiError'
  }
}

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthStateError'
  }
}
