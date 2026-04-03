export interface SpamSettings {
  voiceCaptchaEnabled: boolean
  rateLimitEnabled: boolean
  maxCallsPerMinute: number
  blockDurationMinutes: number
  captchaMaxAttempts: number
}

export interface CallSettings {
  queueTimeoutSeconds: number // 30-300, default 90
  voicemailMaxSeconds: number // 30-300, default 120
  voicemailMaxBytes: number // 100KB-50MB, default 2MB (2097152)
  voicemailMode: 'auto' | 'always' | 'never' // default 'auto'
  voicemailRetentionDays: number | null // null = no explicit limit
  callRecordingMaxBytes: number // 100KB-50MB, default 20MB (20971520)
}

export interface TranscriptionSettings {
  globalEnabled: boolean
  allowUserOptOut: boolean
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
  permissions: string[]
  description: string
  hubId?: string
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
  /** Hub-key encrypted description (client provides). */
  encryptedDescription?: string
}

export interface UpdateRoleData {
  name?: string
  description?: string
  permissions?: string[]
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
  /** Hub-key encrypted description (client provides). */
  encryptedDescription?: string
}

export interface CreateHubData {
  id: string
  /** Plaintext name (legacy / server-side fallback). Prefer encryptedName for new clients. */
  name?: string
  description?: string
  status?: 'active' | 'suspended' | 'archived'
  phoneNumber?: string
  createdBy: string
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
  /** Hub-key encrypted description (client provides). */
  encryptedDescription?: string
}

export interface HubKeyEntry {
  pubkey: string
  wrappedKey: string
  ephemeralPubkey: string
}
