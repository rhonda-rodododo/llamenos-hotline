import { and, eq, sql } from 'drizzle-orm'
import { IVR_LANGUAGES } from '../../shared/languages'
import { DEFAULT_ROLES } from '../../shared/permissions'
import type { Role } from '../../shared/permissions'
import type {
  CustomFieldDefinition,
  EnabledChannels,
  Hub,
  MessagingConfig,
  SetupState,
  TelephonyProviderConfig,
} from '../../shared/types'
import {
  DEFAULT_MESSAGING_CONFIG,
  DEFAULT_SETUP_STATE,
} from '../../shared/types'
import {
  callSettings,
  captchaState,
  customFieldDefinitions,
  fallbackGroup,
  hubKeys,
  hubs,
  ivrAudio,
  ivrLanguages,
  messagingConfig,
  rateLimitCounters,
  reportCategories,
  roles,
  setupState,
  spamSettings,
  telephonyConfig,
  transcriptionSettings,
} from '../db/schema'
import type { Database } from '../db'
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
  constructor(protected readonly db: Database) {}

  // ------------------------------------------------------------------ Spam Settings

  async getSpamSettings(hubId?: string): Promise<SpamSettings> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(spamSettings)
      .where(eq(spamSettings.hubId, hId))
      .limit(1)
    const row = rows[0]
    return {
      voiceCaptchaEnabled: row?.voiceCaptchaEnabled ?? false,
      rateLimitEnabled: row?.rateLimitEnabled ?? true,
      maxCallsPerMinute: row?.maxCallsPerMinute ?? 3,
      blockDurationMinutes: row?.blockDurationMinutes ?? 30,
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
      allowVolunteerOptOut: row?.allowVolunteerOptOut ?? false,
    }
  }

  async updateTranscriptionSettings(
    data: Partial<TranscriptionSettings>,
    hubId?: string,
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
    const row = rows[0]
    return {
      queueTimeoutSeconds: row?.queueTimeoutSeconds ?? 90,
      voicemailMaxSeconds: row?.voicemailMaxSeconds ?? 120,
    }
  }

  async updateCallSettings(data: Partial<CallSettings>, hubId?: string): Promise<CallSettings> {
    const hId = hubId ?? 'global'
    const current = await this.getCallSettings(hId)
    const clamp = (v: number) => Math.max(30, Math.min(300, v))
    const updated: CallSettings = {
      queueTimeoutSeconds:
        data.queueTimeoutSeconds !== undefined
          ? clamp(data.queueTimeoutSeconds)
          : current.queueTimeoutSeconds,
      voicemailMaxSeconds:
        data.voicemailMaxSeconds !== undefined
          ? clamp(data.voicemailMaxSeconds)
          : current.voicemailMaxSeconds,
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

    const fields = rows
      .sort((a, b) => a.order - b.order)
      .map((r) => this.#rowToCustomField(r))

    return role !== 'admin' ? fields.filter((f) => f.visibleToVolunteers) : fields
  }

  async updateCustomFields(fields: CustomFieldDefinition[], hubId?: string): Promise<CustomFieldDefinition[]> {
    const hId = hubId ?? null

    // Delete existing
    if (hId) {
      await this.db
        .delete(customFieldDefinitions)
        .where(eq(customFieldDefinitions.hubId, hId))
    } else {
      await this.db
        .delete(customFieldDefinitions)
        .where(sql`${customFieldDefinitions.hubId} IS NULL`)
    }

    if (fields.length === 0) return []

    const rows = await this.db
      .insert(customFieldDefinitions)
      .values(
        fields.map((f, i) => ({
          id: f.id || crypto.randomUUID(),
          hubId: hId,
          fieldName: f.name,
          label: f.label,
          fieldType: f.type,
          options: f.options ?? [],
          required: f.required,
          showInVolunteerView: f.visibleToVolunteers,
          order: i,
        })),
      )
      .returning()
    return rows.map((r) => this.#rowToCustomField(r))
  }

  // ------------------------------------------------------------------ Telephony Provider

  async getTelephonyProvider(hubId?: string): Promise<TelephonyProviderConfig | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(telephonyConfig)
      .where(eq(telephonyConfig.hubId, hId))
      .limit(1)
    if (!rows[0]) return null
    return rows[0].config as unknown as TelephonyProviderConfig
  }

  async updateTelephonyProvider(config: TelephonyProviderConfig, hubId?: string): Promise<TelephonyProviderConfig> {
    const hId = hubId ?? 'global'
    const configRecord = config as unknown as Record<string, unknown>
    await this.db
      .insert(telephonyConfig)
      .values({ hubId: hId, config: configRecord })
      .onConflictDoUpdate({
        target: telephonyConfig.hubId,
        set: { config: configRecord, updatedAt: new Date() },
      })
    return config
  }

  async getHubByPhone(phone: string): Promise<Hub | null> {
    // Fetch all telephony configs and filter by phone in config JSON
    const rows = await this.db.select().from(telephonyConfig)
    for (const row of rows) {
      const cfg = row.config as Record<string, unknown>
      if (cfg.phoneNumber === phone) {
        // Look up the hub
        const hubRows = await this.db
          .select()
          .from(hubs)
          .where(eq(hubs.id, row.hubId))
          .limit(1)
        if (hubRows[0]) return hubRows[0] as unknown as Hub
      }
    }
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

  async getIvrAudio(promptType: string, language: string, hubId?: string): Promise<IvrAudioEntry | null> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(ivrAudio)
      .where(
        and(
          eq(ivrAudio.hubId, hId),
          eq(ivrAudio.promptType, promptType),
          eq(ivrAudio.language, language),
        ),
      )
      .limit(1)
    if (!rows[0]) return null
    return {
      hubId: rows[0].hubId,
      promptType: rows[0].promptType,
      language: rows[0].language,
      audioData: rows[0].audioData,
      mimeType: rows[0].mimeType,
    }
  }

  async upsertIvrAudio(entry: IvrAudioEntry): Promise<void> {
    await this.db
      .insert(ivrAudio)
      .values(entry)
      .onConflictDoUpdate({
        target: [ivrAudio.hubId, ivrAudio.promptType, ivrAudio.language],
        set: {
          audioData: entry.audioData,
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
          eq(ivrAudio.language, language),
        ),
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
    if (!rows[0]) return { ...DEFAULT_MESSAGING_CONFIG }
    return rows[0].config as unknown as MessagingConfig
  }

  async updateMessagingConfig(data: Partial<MessagingConfig>, hubId?: string): Promise<MessagingConfig> {
    const hId = hubId ?? 'global'
    const current = await this.getMessagingConfig(hId)
    const updated = { ...current, ...data }
    const updatedRecord = updated as unknown as Record<string, unknown>
    await this.db
      .insert(messagingConfig)
      .values({ hubId: hId, config: updatedRecord })
      .onConflictDoUpdate({
        target: messagingConfig.hubId,
        set: { config: updatedRecord, updatedAt: new Date() },
      })
    return updated
  }

  // ------------------------------------------------------------------ Setup State

  async getSetupState(hubId?: string): Promise<SetupState> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(setupState)
      .where(eq(setupState.hubId, hId))
      .limit(1)
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

  async getReportCategories(hubId?: string): Promise<string[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(reportCategories)
      .where(eq(reportCategories.hubId, hId))
      .limit(1)
    return (rows[0]?.categories as string[]) ?? ['Incident Report', 'Field Observation', 'Evidence', 'Other']
  }

  async updateReportCategories(categories: string[], hubId?: string): Promise<string[]> {
    const hId = hubId ?? 'global'
    const capped = categories.slice(0, 50)
    await this.db
      .insert(reportCategories)
      .values({ hubId: hId, categories: capped })
      .onConflictDoUpdate({
        target: reportCategories.hubId,
        set: { categories: capped, updatedAt: new Date() },
      })
    return capped
  }

  // ------------------------------------------------------------------ Fallback Group

  async getFallbackGroup(hubId?: string): Promise<string[]> {
    const hId = hubId ?? 'global'
    const rows = await this.db
      .select()
      .from(fallbackGroup)
      .where(eq(fallbackGroup.hubId, hId))
      .limit(1)
    return (rows[0]?.volunteerPubkeys as string[]) ?? []
  }

  async setFallbackGroup(pubkeys: string[], hubId?: string): Promise<void> {
    const hId = hubId ?? 'global'
    await this.db
      .insert(fallbackGroup)
      .values({ hubId: hId, volunteerPubkeys: pubkeys })
      .onConflictDoUpdate({
        target: fallbackGroup.hubId,
        set: { volunteerPubkeys: pubkeys },
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

  async storeCaptcha(callSid: string, expectedDigits: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    await this.db
      .insert(captchaState)
      .values({ callSid, expectedDigits, expiresAt })
      .onConflictDoUpdate({
        target: captchaState.callSid,
        set: { expectedDigits, expiresAt },
      })
  }

  async verifyCaptcha(callSid: string, digits: string): Promise<{ match: boolean; expected: string }> {
    const rows = await this.db
      .select()
      .from(captchaState)
      .where(eq(captchaState.callSid, callSid))
      .limit(1)
    // One-shot: delete after read
    await this.db.delete(captchaState).where(eq(captchaState.callSid, callSid))

    const row = rows[0]
    if (!row) return { match: false, expected: '' }
    if (row.expiresAt < new Date()) return { match: false, expected: row.expectedDigits }

    // Constant-time comparison
    const expected = row.expectedDigits
    let match = expected.length === digits.length ? 1 : 0
    for (let i = 0; i < expected.length; i++) {
      match &= expected.charCodeAt(i) === digits.charCodeAt(i) ? 1 : 0
    }
    return { match: match === 1, expected }
  }

  // ------------------------------------------------------------------ Roles

  async listRoles(hubId?: string): Promise<Role[]> {
    const hId = hubId ?? null
    const rows = hId
      ? await this.db.select().from(roles).where(eq(roles.hubId, hId))
      : await this.db.select().from(roles).where(sql`${roles.hubId} IS NULL`)

    if (rows.length === 0) {
      // Seed default roles on first call — use onConflictDoNothing to make concurrent first-calls idempotent
      const now = new Date()
      const seeded = await this.db
        .insert(roles)
        .values(
          DEFAULT_ROLES.map((r) => ({
            id: r.id,
            hubId: hId,
            name: r.name,
            slug: r.slug,
            permissions: r.permissions,
            isDefault: r.isDefault,
            createdAt: now,
          })),
        )
        .onConflictDoNothing()
        .returning()
      // Re-fetch in case another concurrent request already seeded (returning() may be empty)
      if (seeded.length === 0) {
        const refetched = hId
          ? await this.db.select().from(roles).where(eq(roles.hubId, hId))
          : await this.db.select().from(roles).where(sql`${roles.hubId} IS NULL`)
        return refetched.map((r) => this.#rowToRole(r))
      }
      return seeded.map((r) => this.#rowToRole(r))
    }
    return rows.map((r) => this.#rowToRole(r))
  }

  async createRole(data: CreateRoleData): Promise<Role> {
    const hubId = data.hubId ?? null
    const existing = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(
        hubId
          ? and(eq(roles.slug, data.slug), eq(roles.hubId, hubId))
          : and(eq(roles.slug, data.slug), sql`${roles.hubId} IS NULL`),
      )
      .limit(1)
    if (existing[0]) throw new AppError(409, `Role slug "${data.slug}" already exists`)

    const id = `role-${crypto.randomUUID()}`
    const [row] = await this.db
      .insert(roles)
      .values({
        id,
        hubId,
        name: data.name,
        slug: data.slug,
        permissions: data.permissions,
        isDefault: false,
        createdAt: new Date(),
      })
      .returning()
    return this.#rowToRole(row)
  }

  async updateRole(id: string, data: UpdateRoleData): Promise<Role> {
    const rows = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1)
    const role = rows[0]
    if (!role) throw new AppError(404, 'Role not found')
    // Super-admin role cannot be modified
    if (role.id === 'role-super-admin') {
      throw new AppError(403, 'Cannot modify the super-admin role')
    }

    const [updated] = await this.db
      .update(roles)
      .set({
        ...(data.name ? { name: data.name } : {}),
        ...(data.permissions ? { permissions: data.permissions } : {}),
      })
      .where(eq(roles.id, id))
      .returning()
    return this.#rowToRole(updated)
  }

  async deleteRole(id: string): Promise<void> {
    const rows = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1)
    const role = rows[0]
    if (!role) throw new AppError(404, 'Role not found')
    if (role.isDefault) throw new AppError(403, 'Cannot delete default roles')
    await this.db.delete(roles).where(eq(roles.id, id))
  }

  // ------------------------------------------------------------------ Hubs

  async getHubs(): Promise<Hub[]> {
    const rows = await this.db.select().from(hubs)
    return rows as unknown as Hub[]
  }

  async getHub(id: string): Promise<Hub | null> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    return rows[0] ? (rows[0] as unknown as Hub) : null
  }

  async createHub(data: CreateHubData): Promise<Hub> {
    const [row] = await this.db
      .insert(hubs)
      .values({
        id: data.id || crypto.randomUUID(),
        name: data.name,
        nostrPubkey: null,
      })
      .returning()
    return row as unknown as Hub
  }

  async updateHub(id: string, data: Partial<Hub>): Promise<Hub> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Hub not found')
    const [row] = await this.db
      .update(hubs)
      .set({ name: data.name ?? rows[0].name })
      .where(eq(hubs.id, id))
      .returning()
    return row as unknown as Hub
  }

  async archiveHub(id: string): Promise<void> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Hub not found')
    throw new AppError(501, 'Hub archiving not yet implemented — schema migration pending')
  }

  // ------------------------------------------------------------------ Hub Key Envelopes

  async getHubKeyEnvelopes(hubId: string): Promise<HubKeyEntry[]> {
    const rows = await this.db.select().from(hubKeys).where(eq(hubKeys.hubId, hubId))
    return rows.map((r) => ({
      pubkey: r.pubkey,
      wrappedKey: r.encryptedKey,
      ephemeralPubkey: '', // stored flat in DB; ephemeralPubkey is embedded in encryptedKey
    }))
  }

  async setHubKeyEnvelopes(hubId: string, envelopes: HubKeyEntry[]): Promise<void> {
    // Verify hub exists
    const hubRows = await this.db.select({ id: hubs.id }).from(hubs).where(eq(hubs.id, hubId)).limit(1)
    if (!hubRows[0]) throw new AppError(404, 'Hub not found')

    // Replace all envelopes for this hub
    await this.db.delete(hubKeys).where(eq(hubKeys.hubId, hubId))
    if (envelopes.length > 0) {
      await this.db.insert(hubKeys).values(
        envelopes.map((e) => ({
          hubId,
          pubkey: e.pubkey,
          encryptedKey: e.wrappedKey,
        })),
      )
    }
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToCustomField(r: typeof customFieldDefinitions.$inferSelect): CustomFieldDefinition {
    return {
      id: r.id,
      name: r.fieldName,
      label: r.label,
      type: r.fieldType as CustomFieldDefinition['type'],
      required: r.required,
      options: r.options as string[],
      visibleToVolunteers: r.showInVolunteerView,
      editableByVolunteers: r.showInVolunteerView,
      context: 'all',
      order: r.order,
      createdAt: r.createdAt.toISOString(),
    }
  }

  #rowToRole(r: typeof roles.$inferSelect): Role {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      permissions: r.permissions as string[],
      isDefault: r.isDefault,
      isSystem: r.id === 'role-super-admin',
      description: '',
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.createdAt.toISOString(),
    }
  }
}
