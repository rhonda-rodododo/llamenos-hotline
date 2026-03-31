import {
  LABEL_IVR_AUDIO,
  LABEL_PROVIDER_CREDENTIAL_WRAP,
  LABEL_STORAGE_CREDENTIAL_WRAP,
} from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { IVR_LANGUAGES } from '../../shared/languages'
import { DEFAULT_ROLES } from '../../shared/permissions'
import type { Role } from '../../shared/permissions'
import type {
  CustomFieldDefinition,
  EnabledChannels,
  GeocodingConfigAdmin,
  Hub,
  MessagingConfig,
  OAuthState,
  ProviderConfig,
  SetupState,
  SignalRegistrationPending,
  TelephonyProviderConfig,
} from '../../shared/types'
import { DEFAULT_MESSAGING_CONFIG, DEFAULT_SETUP_STATE } from '../../shared/types'
import type { Database } from '../db'
import {
  activeCalls,
  activeShifts,
  auditLog,
  bans,
  blastDeliveries,
  blasts,
  callLegs,
  callRecords,
  callSettings,
  callTokens,
  captchaState,
  conversations,
  customFieldDefinitions,
  fallbackGroup,
  fileRecords,
  geocodingConfig,
  hubKeys,
  hubStorageCredentials,
  hubStorageSettings,
  hubs,
  ivrAudio,
  ivrLanguages,
  messageEnvelopes,
  messagingConfig,
  noteEnvelopes,
  oauthState,
  providerConfig,
  rateLimitCounters,
  reportCategories,
  reportTypes,
  ringGroups,
  roles,
  setupState,
  shiftOverrides,
  shiftSchedules,
  signalRegistrationPending,
  spamSettings,
  subscribers,
  telephonyConfig,
  transcriptionSettings,
  users,
} from '../db/schema'
import { TtlCache } from '../lib/cache'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import type {
  CallSettings,
  CreateHubData,
  CreateRoleData,
  HubKeyEntry,
  IvrAudioEntry,
  IvrAudioMeta,
  SpamSettings,
  TranscriptionSettings,
  UpdateRoleData,
} from '../types'

export class SettingsService {
  private hubKeyCache = new TtlCache<Uint8Array | null>(30_000)
  private roleCache = new TtlCache<Role[]>(10_000) // 10s TTL
  private telephonyConfigCache = new TtlCache<TelephonyProviderConfig | null>(30_000) // 30s TTL
  private phoneToHubCache = new TtlCache<string | null>(60_000) // 60s TTL

  constructor(
    protected readonly db: Database,
    private readonly crypto: CryptoService
  ) {}

  // ------------------------------------------------------------------ Hub Key Helper

  async #getHubKey(hubId: string): Promise<Uint8Array | null> {
    if (!hubId || hubId === 'global') return null
    return this.hubKeyCache.getOrSet(hubId, async () => {
      const envelopes = await this.db.select().from(hubKeys).where(eq(hubKeys.hubId, hubId))
      if (envelopes.length === 0) return null
      try {
        return this.crypto.unwrapHubKey(
          envelopes.map((r) => ({
            pubkey: r.pubkey,
            wrappedKey: r.encryptedKey,
            ephemeralPubkey: r.ephemeralPubkey ?? '',
          }))
        )
      } catch {
        return null // Server not in hub key envelope list
      }
    })
  }

  /** @internal Hub key lookup for dependent services. Uses shared TTL cache. */
  getHubKey(hubId: string): Promise<Uint8Array | null> {
    return this.#getHubKey(hubId)
  }

  /** Invalidate cached hub key (call after key rotation). */
  invalidateHubKey(hubId: string): void {
    this.hubKeyCache.delete(hubId)
  }

  // ------------------------------------------------------------------ Spam Settings

  async getSpamSettings(hubId?: string): Promise<SpamSettings> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(spamSettings)
      .where(eq(spamSettings.hubId, hId))
      .limit(1)
    let row = rows[0]
    // Fall back to global settings when hub-specific settings don't exist
    if (!row && hId !== 'global') {
      const globalRows = await this.db
        .select()
        .from(spamSettings)
        .where(eq(spamSettings.hubId, 'global'))
        .limit(1)
      row = globalRows[0]
    }
    return {
      voiceCaptchaEnabled: row?.voiceCaptchaEnabled ?? false,
      rateLimitEnabled: row?.rateLimitEnabled ?? true,
      maxCallsPerMinute: row?.maxCallsPerMinute ?? 3,
      blockDurationMinutes: row?.blockDurationMinutes ?? 30,
      captchaMaxAttempts: row?.captchaMaxAttempts ?? 3,
    }
  }

  async updateSpamSettings(data: Partial<SpamSettings>, hubId?: string): Promise<SpamSettings> {
    const hId = hubId ?? 'global'
    const current = await this.getSpamSettings(hId)
    const updated = { ...current, ...data }
    await this.db
      .insert(spamSettings)
      .values({ hubId: hId, ...updated })
      .onConflictDoUpdate({
        target: spamSettings.hubId,
        set: updated,
      })
    return updated
  }

  // ------------------------------------------------------------------ Transcription Settings

  async getTranscriptionSettings(hubId?: string): Promise<TranscriptionSettings> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(transcriptionSettings)
      .where(eq(transcriptionSettings.hubId, hId))
      .limit(1)
    const row = rows[0]
    return {
      globalEnabled: row?.globalEnabled ?? true,
      allowUserOptOut: row?.allowUserOptOut ?? false,
    }
  }

  async updateTranscriptionSettings(
    data: Partial<TranscriptionSettings>,
    hubId?: string
  ): Promise<TranscriptionSettings> {
    const hId = hubId ?? 'global'
    const current = await this.getTranscriptionSettings(hId)
    const updated = { ...current, ...data }
    await this.db
      .insert(transcriptionSettings)
      .values({ hubId: hId, ...updated })
      .onConflictDoUpdate({
        target: transcriptionSettings.hubId,
        set: updated,
      })
    return updated
  }

  // ------------------------------------------------------------------ Call Settings

  async getCallSettings(hubId?: string): Promise<CallSettings> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(callSettings)
      .where(eq(callSettings.hubId, hId))
      .limit(1)
    let row = rows[0]

    // Fall back to global settings when no hub-specific row exists
    if (!row && hId !== 'global') {
      const globalRows = await this.db
        .select()
        .from(callSettings)
        .where(eq(callSettings.hubId, 'global'))
        .limit(1)
      row = globalRows[0]
    }

    return {
      queueTimeoutSeconds: row?.queueTimeoutSeconds ?? 90,
      voicemailMaxSeconds: row?.voicemailMaxSeconds ?? 120,
      voicemailMaxBytes: row?.voicemailMaxBytes ?? 2097152,
      voicemailMode: (row?.voicemailMode as 'auto' | 'always' | 'never') ?? 'auto',
      voicemailRetentionDays: row?.voicemailRetentionDays ?? null,
      callRecordingMaxBytes: row?.callRecordingMaxBytes ?? 20971520,
    }
  }

  async updateCallSettings(data: Partial<CallSettings>, hubId?: string): Promise<CallSettings> {
    const hId = hubId ?? 'global'
    const current = await this.getCallSettings(hId)
    const clamp = (v: number) => Math.max(30, Math.min(300, v))
    const clampBytes = (v: number) => Math.max(102400, Math.min(52428800, v)) // 100KB–50MB
    const validVoicemailModes = ['auto', 'always', 'never'] as const
    const updated: CallSettings = {
      queueTimeoutSeconds:
        data.queueTimeoutSeconds !== undefined
          ? clamp(data.queueTimeoutSeconds)
          : current.queueTimeoutSeconds,
      voicemailMaxSeconds:
        data.voicemailMaxSeconds !== undefined
          ? clamp(data.voicemailMaxSeconds)
          : current.voicemailMaxSeconds,
      voicemailMaxBytes:
        data.voicemailMaxBytes !== undefined
          ? clampBytes(data.voicemailMaxBytes)
          : current.voicemailMaxBytes,
      voicemailMode:
        data.voicemailMode !== undefined && validVoicemailModes.includes(data.voicemailMode)
          ? data.voicemailMode
          : current.voicemailMode,
      voicemailRetentionDays:
        data.voicemailRetentionDays !== undefined
          ? data.voicemailRetentionDays
          : current.voicemailRetentionDays,
      callRecordingMaxBytes:
        data.callRecordingMaxBytes !== undefined
          ? clampBytes(data.callRecordingMaxBytes)
          : current.callRecordingMaxBytes,
    }
    await this.db
      .insert(callSettings)
      .values({ hubId: hId, ...updated })
      .onConflictDoUpdate({
        target: callSettings.hubId,
        set: updated,
      })
    return updated
  }

  // ------------------------------------------------------------------ IVR Languages

  async getIvrLanguages(hubId?: string): Promise<string[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(ivrLanguages)
      .where(eq(ivrLanguages.hubId, hId))
      .limit(1)
    return (rows[0]?.languages as string[]) ?? [...IVR_LANGUAGES]
  }

  async updateIvrLanguages(langs: string[], hubId?: string): Promise<string[]> {
    const hId = hubId ?? 'global'
    const valid = langs.filter((code) => IVR_LANGUAGES.includes(code))
    if (valid.length === 0) throw new AppError(400, 'No valid IVR language codes provided')
    await this.db
      .insert(ivrLanguages)
      .values({ hubId: hId, languages: valid })
      .onConflictDoUpdate({
        target: ivrLanguages.hubId,
        set: { languages: valid },
      })
    return valid
  }

  // ------------------------------------------------------------------ Custom Fields

  async getCustomFields(role: string, hubId?: string): Promise<CustomFieldDefinition[]> {
    const hId = hubId ?? null
    const rows = hId
      ? await this.db
          .select()
          .from(customFieldDefinitions)
          .where(eq(customFieldDefinitions.hubId, hId))
      : await this.db
          .select()
          .from(customFieldDefinitions)
          .where(sql`${customFieldDefinitions.hubId} IS NULL`)

    // Client decrypts with hub key — server returns ciphertext pass-through
    const sorted = rows.sort((a, b) => a.order - b.order)
    const fields = sorted.map((r) => this.#rowToCustomField(r))

    return role !== 'admin'
      ? fields.filter((f) => f.visibleTo === 'contacts:envelope-summary')
      : fields
  }

  async updateCustomFields(
    fields: CustomFieldDefinition[],
    hubId?: string
  ): Promise<CustomFieldDefinition[]> {
    const hId = hubId ?? null

    // Delete existing
    if (hId) {
      await this.db.delete(customFieldDefinitions).where(eq(customFieldDefinitions.hubId, hId))
    } else {
      await this.db
        .delete(customFieldDefinitions)
        .where(sql`${customFieldDefinitions.hubId} IS NULL`)
    }

    if (fields.length === 0) return []

    // Client provides hub-key encrypted values; hub-encrypt fallback for server-initiated ops
    const hubKey = hId ? await this.#getHubKey(hId) : null

    const encryptOrPassthrough = (
      encrypted: Ciphertext | undefined,
      plaintext: string
    ): Ciphertext =>
      encrypted ?? (hubKey ? this.crypto.hubEncrypt(plaintext, hubKey) : (plaintext as Ciphertext))

    const rows = await this.db
      .insert(customFieldDefinitions)
      .values(
        fields.map((f, i) => ({
          id: f.id || crypto.randomUUID(),
          hubId: hId,
          fieldType: f.type,
          required: f.required,
          visibleTo: f.visibleTo ?? 'contacts:envelope-summary',
          order: i,
          encryptedFieldName: encryptOrPassthrough(f.encryptedFieldName, f.name),
          encryptedLabel: encryptOrPassthrough(f.encryptedLabel, f.label),
          encryptedOptions:
            f.encryptedOptions ??
            (f.options && f.options.length > 0
              ? hubKey
                ? this.crypto.hubEncrypt(JSON.stringify(f.options), hubKey)
                : (JSON.stringify(f.options) as Ciphertext)
              : null),
        }))
      )
      .returning()
    return rows.map((r) => this.#rowToCustomField(r))
  }

  // ------------------------------------------------------------------ Telephony Provider

  async getTelephonyProvider(hubId?: string): Promise<TelephonyProviderConfig | null> {
    const hId = hubId ?? 'global'
    return this.telephonyConfigCache.getOrSet(hId, async () => {
      const rows = await this.db
        .select()
        .from(telephonyConfig)
        .where(eq(telephonyConfig.hubId, hId))
        .limit(1)
      if (!rows[0]) return null
      const configStr = rows[0].config
      if (!configStr) return null
      let json: string
      try {
        json = this.crypto.serverDecrypt(configStr as Ciphertext, LABEL_PROVIDER_CREDENTIAL_WRAP)
      } catch {
        // Legacy plaintext — re-encrypt and update
        json = configStr
        const encrypted = this.crypto.serverEncrypt(json, LABEL_PROVIDER_CREDENTIAL_WRAP)
        await this.db
          .update(telephonyConfig)
          .set({ config: encrypted })
          .where(eq(telephonyConfig.hubId, hId))
      }
      return JSON.parse(json) as TelephonyProviderConfig
    })
  }

  async updateTelephonyProvider(
    config: TelephonyProviderConfig,
    hubId?: string
  ): Promise<TelephonyProviderConfig> {
    const hId = hubId ?? 'global'
    this.telephonyConfigCache.delete(hId)
    this.phoneToHubCache.clear() // phone mapping may have changed
    const encrypted = this.crypto.serverEncrypt(
      JSON.stringify(config),
      LABEL_PROVIDER_CREDENTIAL_WRAP
    )
    await this.db
      .insert(telephonyConfig)
      .values({ hubId: hId, config: encrypted })
      .onConflictDoUpdate({
        target: telephonyConfig.hubId,
        set: { config: encrypted, updatedAt: new Date() },
      })
    return config
  }

  async getHubByPhone(phone: string): Promise<Hub | null> {
    const cachedHubId = this.phoneToHubCache.get(phone)
    if (cachedHubId !== undefined) {
      return cachedHubId ? this.getHub(cachedHubId) : null
    }

    // Fetch all telephony configs and filter by phone in decrypted config
    const rows = await this.db.select().from(telephonyConfig)
    for (const row of rows) {
      if (!row.config) continue
      let cfg: Record<string, unknown>
      try {
        cfg = JSON.parse(
          this.crypto.serverDecrypt(row.config as Ciphertext, LABEL_PROVIDER_CREDENTIAL_WRAP)
        ) as Record<string, unknown>
      } catch {
        try {
          cfg = JSON.parse(row.config) as Record<string, unknown>
        } catch {
          continue
        }
      }
      if (cfg.phoneNumber === phone) {
        this.phoneToHubCache.set(phone, row.hubId)
        return this.getHub(row.hubId)
      }
    }
    this.phoneToHubCache.set(phone, null)
    return null
  }

  // ------------------------------------------------------------------ IVR Audio

  async getIvrAudioList(hubId?: string): Promise<IvrAudioMeta[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select({
        promptType: ivrAudio.promptType,
        language: ivrAudio.language,
        mimeType: ivrAudio.mimeType,
      })
      .from(ivrAudio)
      .where(eq(ivrAudio.hubId, hId))
    return rows
  }

  async getIvrAudio(
    promptType: string,
    language: string,
    hubId?: string
  ): Promise<IvrAudioEntry | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(ivrAudio)
      .where(
        and(
          eq(ivrAudio.hubId, hId),
          eq(ivrAudio.promptType, promptType),
          eq(ivrAudio.language, language)
        )
      )
      .limit(1)
    if (!rows[0]) return null
    const audioData = this.crypto.serverDecrypt(
      rows[0].encryptedAudioData as Ciphertext,
      LABEL_IVR_AUDIO
    )
    return {
      hubId: rows[0].hubId,
      promptType: rows[0].promptType,
      language: rows[0].language,
      audioData,
      mimeType: rows[0].mimeType,
    }
  }

  async upsertIvrAudio(entry: IvrAudioEntry): Promise<void> {
    const encryptedAudioData = this.crypto.serverEncrypt(entry.audioData, LABEL_IVR_AUDIO)

    await this.db
      .insert(ivrAudio)
      .values({
        hubId: entry.hubId,
        promptType: entry.promptType,
        language: entry.language,
        mimeType: entry.mimeType,
        encryptedAudioData,
      })
      .onConflictDoUpdate({
        target: [ivrAudio.hubId, ivrAudio.promptType, ivrAudio.language],
        set: {
          encryptedAudioData,
          mimeType: entry.mimeType,
          createdAt: new Date(),
        },
      })
  }

  async deleteIvrAudio(promptType: string, language: string, hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'
    await this.db
      .delete(ivrAudio)
      .where(
        and(
          eq(ivrAudio.hubId, hId),
          eq(ivrAudio.promptType, promptType),
          eq(ivrAudio.language, language)
        )
      )
  }

  // ------------------------------------------------------------------ Messaging Config

  async getMessagingConfig(hubId?: string): Promise<MessagingConfig> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(messagingConfig)
      .where(eq(messagingConfig.hubId, hId))
      .limit(1)
    if (!rows[0] || !rows[0].config) return { ...DEFAULT_MESSAGING_CONFIG }
    const configStr = rows[0].config
    let json: string
    try {
      json = this.crypto.serverDecrypt(configStr as Ciphertext, LABEL_PROVIDER_CREDENTIAL_WRAP)
    } catch {
      // Legacy plaintext — re-encrypt and update
      json = configStr
      const encrypted = this.crypto.serverEncrypt(json, LABEL_PROVIDER_CREDENTIAL_WRAP)
      await this.db
        .update(messagingConfig)
        .set({ config: encrypted })
        .where(eq(messagingConfig.hubId, hId))
    }
    return JSON.parse(json) as MessagingConfig
  }

  async updateMessagingConfig(
    data: Partial<MessagingConfig>,
    hubId?: string
  ): Promise<MessagingConfig> {
    const hId = hubId ?? 'global'
    const current = await this.getMessagingConfig(hId)
    const updated = { ...current, ...data }
    const encrypted = this.crypto.serverEncrypt(
      JSON.stringify(updated),
      LABEL_PROVIDER_CREDENTIAL_WRAP
    )
    await this.db
      .insert(messagingConfig)
      .values({ hubId: hId, config: encrypted })
      .onConflictDoUpdate({
        target: messagingConfig.hubId,
        set: { config: encrypted, updatedAt: new Date() },
      })
    return updated
  }

  // ------------------------------------------------------------------ Setup State

  async getSetupState(hubId?: string): Promise<SetupState> {
    const hId = hubId ?? 'global'
    const rows = await this.db.select().from(setupState).where(eq(setupState.hubId, hId)).limit(1)
    if (!rows[0]) return { ...DEFAULT_SETUP_STATE }
    return rows[0].state as unknown as SetupState
  }

  async updateSetupState(data: Partial<SetupState>, hubId?: string): Promise<SetupState> {
    const hId = hubId ?? 'global'
    const current = await this.getSetupState(hId)
    const updated = { ...current, ...data }
    const updatedRecord = updated as unknown as Record<string, unknown>
    await this.db
      .insert(setupState)
      .values({ hubId: hId, state: updatedRecord })
      .onConflictDoUpdate({
        target: setupState.hubId,
        set: { state: updatedRecord, updatedAt: new Date() },
      })
    return updated
  }

  // ------------------------------------------------------------------ Enabled Channels

  async getEnabledChannels(hubId?: string): Promise<EnabledChannels> {
    const hId = hubId ?? 'global'
    const [tConfig, mConfig, sState] = await Promise.all([
      this.getTelephonyProvider(hId),
      this.getMessagingConfig(hId),
      this.getSetupState(hId),
    ])
    const voiceEnabled = !!tConfig
    return {
      voice: voiceEnabled,
      sms: mConfig.enabledChannels.includes('sms'),
      whatsapp: mConfig.enabledChannels.includes('whatsapp'),
      signal: mConfig.enabledChannels.includes('signal'),
      rcs: mConfig.enabledChannels.includes('rcs'),
      reports: sState.selectedChannels.includes('reports'),
    }
  }

  // ------------------------------------------------------------------ Report Categories

  async getReportCategories(
    hubId?: string
  ): Promise<{ categories: string[]; encryptedCategories?: string }> {
    const hId = hubId ?? 'global'
    const defaults = ['Incident Report', 'Field Observation', 'Evidence', 'Other']
    const rows = await this.db
      .select()
      .from(reportCategories)
      .where(eq(reportCategories.hubId, hId))
      .limit(1)
    const row = rows[0]
    if (!row?.encryptedCategories) return { categories: defaults }

    // Client decrypts encryptedCategories with hub key
    return { categories: defaults, encryptedCategories: row.encryptedCategories }
  }

  async updateReportCategories(encryptedCategoriesBlob: Ciphertext, hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'

    // Client provides hub-key encrypted categories blob — store as-is
    await this.db
      .insert(reportCategories)
      .values({ hubId: hId, encryptedCategories: encryptedCategoriesBlob })
      .onConflictDoUpdate({
        target: reportCategories.hubId,
        set: { encryptedCategories: encryptedCategoriesBlob, updatedAt: new Date() },
      })
  }

  // ------------------------------------------------------------------ Fallback Group

  async getFallbackGroup(hubId?: string): Promise<string[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(fallbackGroup)
      .where(eq(fallbackGroup.hubId, hId))
      .limit(1)
    if (rows[0]) return (rows[0].userPubkeys as string[]) ?? []
    // Fall back to global fallback group when hub-specific is not configured
    if (hId !== 'global') {
      const globalRows = await this.db
        .select()
        .from(fallbackGroup)
        .where(eq(fallbackGroup.hubId, 'global'))
        .limit(1)
      return (globalRows[0]?.userPubkeys as string[]) ?? []
    }
    return []
  }

  async setFallbackGroup(pubkeys: string[], hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'
    await this.db
      .insert(fallbackGroup)
      .values({ hubId: hId, userPubkeys: pubkeys })
      .onConflictDoUpdate({
        target: fallbackGroup.hubId,
        set: { userPubkeys: pubkeys },
      })
  }

  // ------------------------------------------------------------------ Rate Limiting

  async checkRateLimit(key: string, maxPerMinute: number): Promise<boolean> {
    const now = new Date()
    const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000) // floor to current minute

    const [result] = await this.db
      .insert(rateLimitCounters)
      .values({ key, count: 1, windowStart })
      .onConflictDoUpdate({
        target: rateLimitCounters.key,
        set: {
          count: sql`CASE WHEN ${rateLimitCounters.windowStart} < ${windowStart}
            THEN 1
            ELSE ${rateLimitCounters.count} + 1
          END`,
          windowStart: sql`CASE WHEN ${rateLimitCounters.windowStart} < ${windowStart}
            THEN ${windowStart}
            ELSE ${rateLimitCounters.windowStart}
          END`,
        },
      })
      .returning()

    return result.count > maxPerMinute
  }

  // ------------------------------------------------------------------ CAPTCHA

  async storeCaptcha(
    callSid: string,
    expectedDigits: string,
    preserveAttempts = false
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    await this.db
      .insert(captchaState)
      .values({ callSid, expectedDigits, attempts: 0, expiresAt })
      .onConflictDoUpdate({
        target: captchaState.callSid,
        set: preserveAttempts
          ? { expectedDigits, expiresAt }
          : { expectedDigits, attempts: 0, expiresAt },
      })
  }

  async verifyCaptcha(
    callSid: string,
    digits: string,
    maxAttempts = 3
  ): Promise<{
    match: boolean
    expected: string
    shouldRetry: boolean
    remainingAttempts: number
  }> {
    const rows = await this.db
      .select()
      .from(captchaState)
      .where(eq(captchaState.callSid, callSid))
      .limit(1)

    const row = rows[0]
    if (!row) return { match: false, expected: '', shouldRetry: false, remainingAttempts: 0 }
    if (row.expiresAt < new Date()) {
      // Expired — delete and reject
      await this.db.delete(captchaState).where(eq(captchaState.callSid, callSid))
      return {
        match: false,
        expected: row.expectedDigits,
        shouldRetry: false,
        remainingAttempts: 0,
      }
    }

    // Constant-time comparison
    const expected = row.expectedDigits
    let match = expected.length === digits.length ? 1 : 0
    for (let i = 0; i < expected.length; i++) {
      match &= expected.charCodeAt(i) === digits.charCodeAt(i) ? 1 : 0
    }

    if (match === 1) {
      // Correct — delete and pass
      await this.db.delete(captchaState).where(eq(captchaState.callSid, callSid))
      return { match: true, expected, shouldRetry: false, remainingAttempts: 0 }
    }

    // Wrong — increment attempts
    const newAttempts = (row.attempts ?? 0) + 1
    if (newAttempts >= maxAttempts) {
      // Max attempts reached — delete and reject
      await this.db.delete(captchaState).where(eq(captchaState.callSid, callSid))
      return { match: false, expected, shouldRetry: false, remainingAttempts: 0 }
    }

    // Still has retries — update attempt count, keep record
    await this.db
      .update(captchaState)
      .set({ attempts: newAttempts })
      .where(eq(captchaState.callSid, callSid))
    return {
      match: false,
      expected,
      shouldRetry: true,
      remainingAttempts: maxAttempts - newAttempts,
    }
  }

  // ------------------------------------------------------------------ Roles

  async listRoles(hubId?: string): Promise<Role[]> {
    const cacheKey = hubId ?? '__global__'
    const cached = this.roleCache.get(cacheKey)
    if (cached) return cached

    const hId = hubId ?? null
    const rows = hId
      ? await this.db.select().from(roles).where(eq(roles.hubId, hId))
      : await this.db.select().from(roles).where(sql`${roles.hubId} IS NULL`)

    if (rows.length === 0) {
      // Seed default roles on first call — use onConflictDoNothing to make concurrent first-calls idempotent
      const now = new Date()
      // Encrypt default role names with hub key (server-initiated seeding)
      const hubKey = hId ? await this.#getHubKey(hId) : null
      const seeded = await this.db
        .insert(roles)
        .values(
          DEFAULT_ROLES.map((r) => ({
            id: r.id,
            hubId: hId,
            encryptedName: hubKey ? this.crypto.hubEncrypt(r.name, hubKey) : (r.name as Ciphertext), // Plaintext until hub key available (pre-production)
            encryptedDescription: r.description
              ? hubKey
                ? this.crypto.hubEncrypt(r.description, hubKey)
                : (r.description as Ciphertext)
              : null,
            permissions: r.permissions,
            isDefault: r.isDefault,
            createdAt: now,
          }))
        )
        .onConflictDoNothing()
        .returning()
      // Re-fetch in case another concurrent request already seeded (returning() may be empty)
      if (seeded.length === 0) {
        const refetched = hId
          ? await this.db.select().from(roles).where(eq(roles.hubId, hId))
          : await this.db.select().from(roles).where(sql`${roles.hubId} IS NULL`)
        const result = this.#mapRoleRows(refetched)
        this.roleCache.set(cacheKey, result)
        return result
      }
      const result = seeded.map((r) => this.#rowToRole(r))
      this.roleCache.set(cacheKey, result)
      return result
    }
    const result = this.#mapRoleRows(rows)
    this.roleCache.set(cacheKey, result)
    return result
  }

  async createRole(data: CreateRoleData): Promise<Role> {
    this.roleCache.clear()
    const hubId = data.hubId ?? null

    // Client provides hub-key encrypted name/description
    const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
    const encryptedDescription = (data.encryptedDescription ??
      data.description ??
      null) as Ciphertext | null

    const id = `role-${crypto.randomUUID()}`
    const [row] = await this.db
      .insert(roles)
      .values({
        id,
        hubId,
        encryptedName,
        encryptedDescription,
        permissions: data.permissions,
        isDefault: false,
        createdAt: new Date(),
      })
      .returning()
    return this.#rowToRole(row)
  }

  async updateRole(id: string, data: UpdateRoleData): Promise<Role> {
    this.roleCache.clear()
    const rows = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1)
    const role = rows[0]
    if (!role) throw new AppError(404, 'Role not found')
    // Super-admin role cannot be modified
    if (role.id === 'role-super-admin') {
      throw new AppError(403, 'Cannot modify the super-admin role')
    }

    // Client provides hub-key encrypted name/description
    const encFields: Record<string, unknown> = {}
    if (data.encryptedName) {
      encFields.encryptedName = data.encryptedName
    }
    if (data.encryptedDescription !== undefined) {
      encFields.encryptedDescription = data.encryptedDescription ?? null
    }

    const [updated] = await this.db
      .update(roles)
      .set({
        ...(data.permissions ? { permissions: data.permissions } : {}),
        ...encFields,
      })
      .where(eq(roles.id, id))
      .returning()
    return this.#rowToRole(updated)
  }

  async deleteRole(id: string): Promise<void> {
    this.roleCache.clear()
    const rows = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1)
    const role = rows[0]
    if (!role) throw new AppError(404, 'Role not found')
    if (role.isDefault) throw new AppError(403, 'Cannot delete default roles')
    await this.db.delete(roles).where(eq(roles.id, id))
  }

  // ------------------------------------------------------------------ Hubs

  async getHubs(): Promise<Hub[]> {
    const rows = await this.db.select().from(hubs)
    // Client decrypts encryptedName/encryptedDescription with hub key
    return rows.map((r) => this.#rowToHub(r))
  }

  async getHub(id: string): Promise<Hub | null> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    if (!rows[0]) return null
    // Client decrypts encryptedName/encryptedDescription with hub key
    return this.#rowToHub(rows[0])
  }

  async createHub(data: CreateHubData): Promise<Hub> {
    const now = new Date()
    const hubId = data.id || crypto.randomUUID()

    // Client provides hub-key encrypted name/description
    const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
    const encryptedDescription = (data.encryptedDescription ??
      data.description ??
      null) as Ciphertext | null

    const [row] = await this.db
      .insert(hubs)
      .values({
        id: hubId,
        encryptedName,
        encryptedDescription,
        status: data.status ?? 'active',
        phoneNumber: data.phoneNumber ?? null,
        createdBy: data.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return this.#rowToHub(row)
  }

  async updateHub(id: string, data: Partial<Hub>): Promise<Hub> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Hub not found')

    // Client provides hub-key encrypted name/description
    const encFields: Record<string, unknown> = {}
    if (data.encryptedName !== undefined) {
      encFields.encryptedName = data.encryptedName
    }
    if (data.encryptedDescription !== undefined) {
      encFields.encryptedDescription = data.encryptedDescription ?? null
    }

    const [row] = await this.db
      .update(hubs)
      .set({
        ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.allowSuperAdminAccess !== undefined && {
          allowSuperAdminAccess: data.allowSuperAdminAccess,
        }),
        ...encFields,
        updatedAt: new Date(),
      })
      .where(eq(hubs.id, id))
      .returning()
    // Client decrypts encryptedName/encryptedDescription with hub key
    return this.#rowToHub(row)
  }

  async archiveHub(id: string): Promise<void> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Hub not found')
    await this.db
      .update(hubs)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(hubs.id, id))
  }

  /**
   * Cascade-delete a hub and all hub-scoped data.
   *
   * Order matters: delete children before parents to avoid FK violations.
   * Runs inside a single transaction for atomicity.
   */
  async deleteHub(id: string): Promise<void> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Hub not found')

    await this.db.transaction(async (tx) => {
      // --- Storage settings + credentials ---
      await tx.delete(hubStorageCredentials).where(eq(hubStorageCredentials.hubId, id))
      await tx.delete(hubStorageSettings).where(eq(hubStorageSettings.hubId, id))

      // --- Settings singletons (hub-scoped) ---
      await tx.delete(spamSettings).where(eq(spamSettings.hubId, id))
      await tx.delete(transcriptionSettings).where(eq(transcriptionSettings.hubId, id))
      await tx.delete(callSettings).where(eq(callSettings.hubId, id))
      await tx.delete(messagingConfig).where(eq(messagingConfig.hubId, id))
      await tx.delete(telephonyConfig).where(eq(telephonyConfig.hubId, id))
      await tx.delete(setupState).where(eq(setupState.hubId, id))
      await tx.delete(fallbackGroup).where(eq(fallbackGroup.hubId, id))
      await tx.delete(customFieldDefinitions).where(eq(customFieldDefinitions.hubId, id))
      await tx.delete(ivrLanguages).where(eq(ivrLanguages.hubId, id))
      await tx.delete(ivrAudio).where(eq(ivrAudio.hubId, id))
      await tx.delete(reportCategories).where(eq(reportCategories.hubId, id))
      await tx.delete(roles).where(eq(roles.hubId, id))
      await tx.delete(hubKeys).where(eq(hubKeys.hubId, id))

      // --- Shift data ---
      await tx.delete(shiftSchedules).where(eq(shiftSchedules.hubId, id))
      await tx.delete(shiftOverrides).where(eq(shiftOverrides.hubId, id))
      await tx.delete(ringGroups).where(eq(ringGroups.hubId, id))
      await tx.delete(activeShifts).where(eq(activeShifts.hubId, id))

      // --- Call data ---
      await tx.delete(callTokens).where(eq(callTokens.hubId, id))
      await tx.delete(callLegs).where(eq(callLegs.hubId, id))
      await tx.delete(activeCalls).where(eq(activeCalls.hubId, id))

      // --- Records data ---
      await tx.delete(bans).where(eq(bans.hubId, id))
      await tx.delete(auditLog).where(eq(auditLog.hubId, id))
      await tx.delete(callRecords).where(eq(callRecords.hubId, id))
      await tx.delete(noteEnvelopes).where(eq(noteEnvelopes.hubId, id))

      // --- Blasts (delete deliveries via blastId before blasts) ---
      const hubBlasts = await tx.select({ id: blasts.id }).from(blasts).where(eq(blasts.hubId, id))
      if (hubBlasts.length > 0) {
        const blastIds = hubBlasts.map((b) => b.id)
        await tx.delete(blastDeliveries).where(inArray(blastDeliveries.blastId, blastIds))
      }
      await tx.delete(subscribers).where(eq(subscribers.hubId, id))
      await tx.delete(blasts).where(eq(blasts.hubId, id))

      // --- Conversations + messages + file records ---
      const hubConvs = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.hubId, id))
      if (hubConvs.length > 0) {
        const convIds = hubConvs.map((c) => c.id)
        await tx.delete(messageEnvelopes).where(inArray(messageEnvelopes.conversationId, convIds))
        await tx.delete(fileRecords).where(inArray(fileRecords.conversationId, convIds))
      }
      await tx.delete(conversations).where(eq(conversations.hubId, id))

      // --- Remove hub from volunteers' hubRoles JSONB arrays ---
      await tx.execute(
        sql`UPDATE users
          SET hub_roles = COALESCE(
            (SELECT jsonb_agg(elem)
             FROM jsonb_array_elements(hub_roles) AS elem
             WHERE elem->>'hubId' != ${id}),
            '[]'::jsonb
          )
          WHERE hub_roles @> ${JSON.stringify([{ hubId: id }])}::jsonb`
      )

      // --- Finally delete the hub record ---
      await tx.delete(hubs).where(eq(hubs.id, id))
    })
  }

  // ------------------------------------------------------------------ Hub Key Envelopes

  async getHubKeyEnvelopes(hubId: string): Promise<HubKeyEntry[]> {
    const rows = await this.db.select().from(hubKeys).where(eq(hubKeys.hubId, hubId))
    return rows.map((r) => ({
      pubkey: r.pubkey,
      wrappedKey: r.encryptedKey,
      ephemeralPubkey: r.ephemeralPubkey ?? '',
    }))
  }

  async setHubKeyEnvelopes(hubId: string, envelopes: HubKeyEntry[]): Promise<void> {
    this.hubKeyCache.delete(hubId)
    // Verify hub exists
    const hubRows = await this.db
      .select({ id: hubs.id })
      .from(hubs)
      .where(eq(hubs.id, hubId))
      .limit(1)
    if (!hubRows[0]) throw new AppError(404, 'Hub not found')

    // Replace all envelopes for this hub
    await this.db.delete(hubKeys).where(eq(hubKeys.hubId, hubId))
    if (envelopes.length > 0) {
      await this.db.insert(hubKeys).values(
        envelopes.map((e) => ({
          hubId,
          pubkey: e.pubkey,
          encryptedKey: e.wrappedKey,
          ephemeralPubkey: e.ephemeralPubkey || null,
        }))
      )
    }
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToCustomField(r: typeof customFieldDefinitions.$inferSelect): CustomFieldDefinition {
    return {
      id: r.id,
      name: '', // Client decrypts encryptedFieldName with hub key
      label: '', // Client decrypts encryptedLabel with hub key
      type: r.fieldType as CustomFieldDefinition['type'],
      required: r.required,
      options: [], // Client decrypts encryptedOptions with hub key
      encryptedFieldName: r.encryptedFieldName ?? undefined,
      encryptedLabel: r.encryptedLabel ?? undefined,
      encryptedOptions: r.encryptedOptions ?? undefined,
      visibleTo: r.visibleTo,
      context: 'all',
      order: r.order,
      createdAt: r.createdAt.toISOString(),
    }
  }

  async resetForTest(): Promise<void> {
    // Clear all runtime caches
    this.hubKeyCache.clear()
    this.roleCache.clear()
    this.telephonyConfigCache.clear()
    this.phoneToHubCache.clear()
    // Clear runtime state only — preserve system roles (they are code defaults, not user data)
    await this.db.delete(captchaState)
    await this.db.delete(rateLimitCounters)
    await this.db.delete(hubKeys)
    await this.db.delete(reportTypes) // FK: report_types.hub_id → hubs.id — must delete before hubs
    await this.db.delete(hubs)
    await this.db.delete(ivrAudio)
    await this.db.delete(reportCategories)
    await this.db.delete(customFieldDefinitions)
    await this.db.delete(fallbackGroup)
    // Reset settings to defaults by deleting stored overrides
    await this.db.delete(spamSettings)
    await this.db.delete(transcriptionSettings)
    await this.db.delete(callSettings)
    await this.db.delete(ivrLanguages)
    await this.db.delete(messagingConfig)
    await this.db.delete(telephonyConfig)
    await this.db.delete(geocodingConfig)
    await this.db.delete(setupState)
    // Delete all roles — DEFAULT_ROLES are re-seeded on first use via getRole/listRoles
    await this.db.delete(roles)
  }

  #mapRoleRows(rows: (typeof roles.$inferSelect)[]): Role[] {
    // Client decrypts encryptedName/encryptedDescription with hub key
    return rows.map((r) => this.#rowToRole(r))
  }

  #rowToRole(r: typeof roles.$inferSelect): Role {
    return {
      id: r.id,
      name: '', // Client decrypts encryptedName with hub key
      permissions: r.permissions as string[],
      isDefault: r.isDefault,
      isSystem: r.id === 'role-super-admin',
      description: '', // Client decrypts encryptedDescription with hub key
      encryptedName: r.encryptedName ?? undefined,
      encryptedDescription: r.encryptedDescription ?? undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.createdAt.toISOString(),
    }
  }

  #rowToHub(r: typeof hubs.$inferSelect): Hub {
    return {
      id: r.id,
      name: '', // Client decrypts encryptedName with hub key
      description: undefined, // Client decrypts encryptedDescription with hub key
      encryptedName: r.encryptedName ?? undefined,
      encryptedDescription: r.encryptedDescription ?? undefined,
      status: r.status as Hub['status'],
      phoneNumber: r.phoneNumber ?? undefined,
      createdBy: r.createdBy,
      allowSuperAdminAccess: r.allowSuperAdminAccess,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  // --- OAuth State (Provider Auto-Config) ---

  async setOAuthState(state: OAuthState): Promise<void> {
    await this.db
      .insert(oauthState)
      .values({
        provider: state.provider,
        state: state.state,
        expiresAt: new Date(state.expiresAt),
      })
      .onConflictDoUpdate({
        target: oauthState.provider,
        set: { state: state.state, expiresAt: new Date(state.expiresAt) },
      })
  }

  async getOAuthState(provider: string): Promise<OAuthState | null> {
    const rows = await this.db.select().from(oauthState).where(eq(oauthState.provider, provider))
    if (!rows[0]) return null
    if (rows[0].expiresAt < new Date()) {
      await this.db.delete(oauthState).where(eq(oauthState.provider, provider))
      return null
    }
    return {
      state: rows[0].state,
      provider: rows[0].provider as OAuthState['provider'],
      expiresAt: rows[0].expiresAt.getTime(),
    }
  }

  async clearOAuthState(provider: string): Promise<void> {
    await this.db.delete(oauthState).where(eq(oauthState.provider, provider))
  }

  // --- Provider Config ---

  async getProviderConfig(): Promise<ProviderConfig | null> {
    const rows = await this.db.select().from(providerConfig)
    if (!rows[0]) return null
    const r = rows[0]

    const brandSid = r.encryptedBrandSid
      ? this.crypto.serverDecrypt(r.encryptedBrandSid as Ciphertext, LABEL_PROVIDER_CREDENTIAL_WRAP)
      : undefined
    const campaignSid = r.encryptedCampaignSid
      ? this.crypto.serverDecrypt(
          r.encryptedCampaignSid as Ciphertext,
          LABEL_PROVIDER_CREDENTIAL_WRAP
        )
      : undefined
    const messagingServiceSid = r.encryptedMessagingServiceSid
      ? this.crypto.serverDecrypt(
          r.encryptedMessagingServiceSid as Ciphertext,
          LABEL_PROVIDER_CREDENTIAL_WRAP
        )
      : undefined

    return {
      provider: r.provider as ProviderConfig['provider'],
      connected: r.connected,
      phoneNumber: r.phoneNumber ?? undefined,
      webhooksConfigured: r.webhooksConfigured,
      sipConfigured: r.sipConfigured,
      a2pStatus: (r.a2pStatus ?? 'not_started') as ProviderConfig['a2pStatus'],
      brandSid: brandSid ?? undefined,
      campaignSid: campaignSid ?? undefined,
      messagingServiceSid: messagingServiceSid ?? undefined,
    }
  }

  async setProviderConfig(config: ProviderConfig, encryptedCredentials?: string): Promise<void> {
    // Encrypt SIDs with server key
    const encryptedBrandSid = config.brandSid
      ? this.crypto.serverEncrypt(config.brandSid, LABEL_PROVIDER_CREDENTIAL_WRAP)
      : null
    const encryptedCampaignSid = config.campaignSid
      ? this.crypto.serverEncrypt(config.campaignSid, LABEL_PROVIDER_CREDENTIAL_WRAP)
      : null
    const encryptedMessagingServiceSid = config.messagingServiceSid
      ? this.crypto.serverEncrypt(config.messagingServiceSid, LABEL_PROVIDER_CREDENTIAL_WRAP)
      : null

    const values = {
      id: 'global' as const,
      provider: config.provider,
      connected: config.connected,
      phoneNumber: config.phoneNumber ?? null,
      webhooksConfigured: config.webhooksConfigured,
      sipConfigured: config.sipConfigured,
      a2pStatus: config.a2pStatus ?? 'not_started',
      encryptedBrandSid,
      encryptedCampaignSid,
      encryptedMessagingServiceSid,
      encryptedCredentials: (encryptedCredentials ?? null) as Ciphertext | null,
      updatedAt: new Date(),
    }
    await this.db
      .insert(providerConfig)
      .values(values)
      .onConflictDoUpdate({ target: providerConfig.id, set: values })
  }

  async getEncryptedCredentials(): Promise<string | null> {
    const rows = await this.db
      .select({ creds: providerConfig.encryptedCredentials })
      .from(providerConfig)
    return rows[0]?.creds ?? null
  }

  // --- Geocoding Config ---

  async getGeocodingConfig(): Promise<GeocodingConfigAdmin> {
    const rows = await this.db.select().from(geocodingConfig)
    if (!rows[0]) return { provider: null, apiKey: '', countries: [], enabled: false }
    const r = rows[0]

    const apiKey = this.crypto.serverDecrypt(
      r.encryptedApiKey as Ciphertext,
      LABEL_PROVIDER_CREDENTIAL_WRAP
    )

    return {
      provider: r.provider as GeocodingConfigAdmin['provider'],
      apiKey,
      countries: r.countries,
      enabled: r.enabled,
    }
  }

  async updateGeocodingConfig(data: Partial<GeocodingConfigAdmin>): Promise<GeocodingConfigAdmin> {
    const current = await this.getGeocodingConfig()
    const updated = { ...current, ...data }

    // Encrypt API key with server key
    const encryptedApiKey = this.crypto.serverEncrypt(
      updated.apiKey ?? '',
      LABEL_PROVIDER_CREDENTIAL_WRAP
    )

    await this.db
      .insert(geocodingConfig)
      .values({
        id: 'global',
        provider: updated.provider,
        encryptedApiKey,
        countries: updated.countries,
        enabled: updated.enabled,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: geocodingConfig.id,
        set: {
          provider: updated.provider,
          encryptedApiKey,
          countries: updated.countries,
          enabled: updated.enabled,
          updatedAt: new Date(),
        },
      })
    return updated
  }

  // --- Signal Registration Pending ---

  async getSignalRegistrationPending(): Promise<SignalRegistrationPending | null> {
    const rows = await this.db.select().from(signalRegistrationPending)
    if (!rows[0]) return null
    if (rows[0].expiresAt < new Date()) {
      await this.db
        .delete(signalRegistrationPending)
        .where(eq(signalRegistrationPending.id, 'global'))
      return null
    }
    const r = rows[0]

    const number = this.crypto.serverDecrypt(
      r.encryptedNumber as Ciphertext,
      LABEL_PROVIDER_CREDENTIAL_WRAP
    )

    return {
      number,
      bridgeUrl: r.bridgeUrl,
      method: r.method as SignalRegistrationPending['method'],
      status: r.status as SignalRegistrationPending['status'],
      error: r.error ?? undefined,
      expiresAt: r.expiresAt.toISOString(),
    }
  }

  async setSignalRegistrationPending(pending: SignalRegistrationPending): Promise<void> {
    // Encrypt phone number with server key
    const encryptedNumber = this.crypto.serverEncrypt(
      pending.number,
      LABEL_PROVIDER_CREDENTIAL_WRAP
    )

    await this.db
      .insert(signalRegistrationPending)
      .values({
        id: 'global',
        encryptedNumber,
        bridgeUrl: pending.bridgeUrl,
        method: pending.method,
        status: pending.status,
        error: pending.error ?? null,
        expiresAt: new Date(pending.expiresAt),
      })
      .onConflictDoUpdate({
        target: signalRegistrationPending.id,
        set: {
          encryptedNumber,
          bridgeUrl: pending.bridgeUrl,
          method: pending.method,
          status: pending.status,
          error: pending.error ?? null,
          expiresAt: new Date(pending.expiresAt),
        },
      })
  }

  async clearSignalRegistrationPending(): Promise<void> {
    await this.db
      .delete(signalRegistrationPending)
      .where(eq(signalRegistrationPending.id, 'global'))
  }
}
