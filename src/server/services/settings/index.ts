import type { Ciphertext } from '@shared/crypto-types'
import type { Role } from '../../../shared/permissions'
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
} from '../../../shared/types'
import type { Database } from '../../db'
import {
  callSettings as callSettingsTable,
  captchaState,
  customFieldDefinitions,
  fallbackGroup as fallbackGroupTable,
  geocodingConfig as geocodingConfigTable,
  hubKeys,
  hubs,
  ivrAudio,
  ivrLanguages,
  messagingConfig as messagingConfigTable,
  rateLimitCounters,
  reportCategories as reportCategoriesTable,
  reportTypes,
  roles as rolesTable,
  setupState as setupStateTable,
  spamSettings as spamSettingsTable,
  telephonyConfig as telephonyConfigTable,
  transcriptionSettings as transcriptionSettingsTable,
} from '../../db/schema'
import { TtlCache } from '../../lib/cache'
import type { CryptoService } from '../../lib/crypto-service'
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
} from '../../types'

import * as callSettingsMod from './call-settings'
import * as customFieldsMod from './custom-fields'
import * as fallbackGroupMod from './fallback-group'
import * as geocodingConfigMod from './geocoding-config'
import * as hubMgmt from './hub-management'
import * as ivrSettingsMod from './ivr-settings'
import * as messagingConfigMod from './messaging-config'
import type { ProviderCaches } from './provider-config'
import * as providerConfigMod from './provider-config'
import * as roleMgmt from './role-management'
import * as spamMod from './spam-settings'

export class SettingsService {
  private hubKeyCache = new TtlCache<Uint8Array | null>(30_000)
  private roleCache = new TtlCache<Role[]>(10_000) // 10s TTL
  private telephonyConfigCache = new TtlCache<TelephonyProviderConfig | null>(30_000) // 30s TTL
  private phoneToHubCache = new TtlCache<string | null>(60_000) // 60s TTL

  private providerCaches: ProviderCaches

  constructor(
    protected readonly db: Database,
    private readonly crypto: CryptoService
  ) {
    this.providerCaches = {
      telephonyConfigCache: this.telephonyConfigCache,
      phoneToHubCache: this.phoneToHubCache,
    }
  }

  // ------------------------------------------------------------------ Hub Key Helper

  /** @internal Hub key lookup for dependent services. Uses shared TTL cache. */
  getHubKey(hubId: string): Promise<Uint8Array | null> {
    return hubMgmt.getHubKeyRaw(this.db, this.crypto, this.hubKeyCache, hubId)
  }

  /** Invalidate cached hub key (call after key rotation). */
  invalidateHubKey(hubId: string): void {
    this.hubKeyCache.delete(hubId)
  }

  // ------------------------------------------------------------------ Spam Settings

  getSpamSettings(hubId?: string): Promise<SpamSettings> {
    return spamMod.getSpamSettings(this.db, hubId)
  }

  updateSpamSettings(data: Partial<SpamSettings>, hubId?: string): Promise<SpamSettings> {
    return spamMod.updateSpamSettings(this.db, data, hubId)
  }

  checkRateLimit(key: string, maxPerMinute: number): Promise<boolean> {
    return spamMod.checkRateLimit(this.db, key, maxPerMinute)
  }

  storeCaptcha(callSid: string, expectedDigits: string, preserveAttempts = false): Promise<void> {
    return spamMod.storeCaptcha(this.db, callSid, expectedDigits, preserveAttempts)
  }

  verifyCaptcha(
    callSid: string,
    digits: string,
    maxAttempts = 3
  ): Promise<{
    match: boolean
    expected: string
    shouldRetry: boolean
    remainingAttempts: number
  }> {
    return spamMod.verifyCaptcha(this.db, callSid, digits, maxAttempts)
  }

  // ------------------------------------------------------------------ Call Settings

  getCallSettings(hubId?: string): Promise<CallSettings> {
    return callSettingsMod.getCallSettings(this.db, hubId)
  }

  updateCallSettings(data: Partial<CallSettings>, hubId?: string): Promise<CallSettings> {
    return callSettingsMod.updateCallSettings(this.db, data, hubId)
  }

  getTranscriptionSettings(hubId?: string): Promise<TranscriptionSettings> {
    return callSettingsMod.getTranscriptionSettings(this.db, hubId)
  }

  updateTranscriptionSettings(
    data: Partial<TranscriptionSettings>,
    hubId?: string
  ): Promise<TranscriptionSettings> {
    return callSettingsMod.updateTranscriptionSettings(this.db, data, hubId)
  }

  // ------------------------------------------------------------------ IVR Languages & Audio

  getIvrLanguages(hubId?: string): Promise<string[]> {
    return ivrSettingsMod.getIvrLanguages(this.db, hubId)
  }

  updateIvrLanguages(langs: string[], hubId?: string): Promise<string[]> {
    return ivrSettingsMod.updateIvrLanguages(this.db, langs, hubId)
  }

  getIvrAudioList(hubId?: string): Promise<IvrAudioMeta[]> {
    return ivrSettingsMod.getIvrAudioList(this.db, hubId)
  }

  getIvrAudio(promptType: string, language: string, hubId?: string): Promise<IvrAudioEntry | null> {
    return ivrSettingsMod.getIvrAudio(this.db, this.crypto, promptType, language, hubId)
  }

  upsertIvrAudio(entry: IvrAudioEntry): Promise<void> {
    return ivrSettingsMod.upsertIvrAudio(this.db, this.crypto, entry)
  }

  deleteIvrAudio(promptType: string, language: string, hubId?: string): Promise<void> {
    return ivrSettingsMod.deleteIvrAudio(this.db, promptType, language, hubId)
  }

  // ------------------------------------------------------------------ Custom Fields

  getCustomFields(role: string, hubId?: string): Promise<CustomFieldDefinition[]> {
    return customFieldsMod.getCustomFields(this.db, role, hubId)
  }

  updateCustomFields(
    fields: CustomFieldDefinition[],
    hubId?: string
  ): Promise<CustomFieldDefinition[]> {
    return customFieldsMod.updateCustomFields(
      this.db,
      this.crypto,
      (hId) => this.getHubKey(hId),
      fields,
      hubId
    )
  }

  // ------------------------------------------------------------------ Telephony Provider

  getTelephonyProvider(hubId?: string): Promise<TelephonyProviderConfig | null> {
    return providerConfigMod.getTelephonyProvider(this.db, this.crypto, this.providerCaches, hubId)
  }

  updateTelephonyProvider(
    config: TelephonyProviderConfig,
    hubId?: string
  ): Promise<TelephonyProviderConfig> {
    return providerConfigMod.updateTelephonyProvider(
      this.db,
      this.crypto,
      this.providerCaches,
      config,
      hubId
    )
  }

  getHubByPhone(phone: string): Promise<Hub | null> {
    return providerConfigMod.getHubByPhone(this.db, this.crypto, this.providerCaches, phone, (id) =>
      this.getHub(id)
    )
  }

  getProviderConfig(): Promise<ProviderConfig | null> {
    return providerConfigMod.getProviderConfig(this.db, this.crypto)
  }

  setProviderConfig(config: ProviderConfig, encryptedCredentials?: string): Promise<void> {
    return providerConfigMod.setProviderConfig(this.db, this.crypto, config, encryptedCredentials)
  }

  getEncryptedCredentials(): Promise<string | null> {
    return providerConfigMod.getEncryptedCredentials(this.db)
  }

  setOAuthState(state: OAuthState): Promise<void> {
    return providerConfigMod.setOAuthState(this.db, state)
  }

  getOAuthState(provider: string): Promise<OAuthState | null> {
    return providerConfigMod.getOAuthState(this.db, provider)
  }

  clearOAuthState(provider: string): Promise<void> {
    return providerConfigMod.clearOAuthState(this.db, provider)
  }

  getSignalRegistrationPending(): Promise<SignalRegistrationPending | null> {
    return providerConfigMod.getSignalRegistrationPending(this.db, this.crypto)
  }

  setSignalRegistrationPending(pending: SignalRegistrationPending): Promise<void> {
    return providerConfigMod.setSignalRegistrationPending(this.db, this.crypto, pending)
  }

  clearSignalRegistrationPending(): Promise<void> {
    return providerConfigMod.clearSignalRegistrationPending(this.db)
  }

  // ------------------------------------------------------------------ Messaging Config

  getMessagingConfig(hubId?: string): Promise<MessagingConfig> {
    return messagingConfigMod.getMessagingConfig(this.db, this.crypto, hubId)
  }

  updateMessagingConfig(data: Partial<MessagingConfig>, hubId?: string): Promise<MessagingConfig> {
    return messagingConfigMod.updateMessagingConfig(this.db, this.crypto, data, hubId)
  }

  getSetupState(hubId?: string): Promise<SetupState> {
    return messagingConfigMod.getSetupState(this.db, hubId)
  }

  updateSetupState(data: Partial<SetupState>, hubId?: string): Promise<SetupState> {
    return messagingConfigMod.updateSetupState(this.db, data, hubId)
  }

  getEnabledChannels(hubId?: string): Promise<EnabledChannels> {
    return messagingConfigMod.getEnabledChannels(
      this.db,
      this.crypto,
      (hId) => this.getTelephonyProvider(hId),
      hubId
    )
  }

  getReportCategories(
    hubId?: string
  ): Promise<{ categories: string[]; encryptedCategories?: string }> {
    return messagingConfigMod.getReportCategories(this.db, hubId)
  }

  updateReportCategories(encryptedCategoriesBlob: Ciphertext, hubId?: string): Promise<void> {
    return messagingConfigMod.updateReportCategories(this.db, encryptedCategoriesBlob, hubId)
  }

  // ------------------------------------------------------------------ Fallback Group

  getFallbackGroup(hubId?: string): Promise<string[]> {
    return fallbackGroupMod.getFallbackGroup(this.db, hubId)
  }

  setFallbackGroup(pubkeys: string[], hubId?: string): Promise<void> {
    return fallbackGroupMod.setFallbackGroup(this.db, pubkeys, hubId)
  }

  // ------------------------------------------------------------------ Roles

  listRoles(hubId?: string): Promise<Role[]> {
    return roleMgmt.listRoles(this.db, this.crypto, this.roleCache, this.hubKeyCache, hubId)
  }

  createRole(data: CreateRoleData): Promise<Role> {
    return roleMgmt.createRole(this.db, this.roleCache, data)
  }

  updateRole(id: string, data: UpdateRoleData): Promise<Role> {
    return roleMgmt.updateRole(this.db, this.roleCache, id, data)
  }

  deleteRole(id: string): Promise<void> {
    return roleMgmt.deleteRole(this.db, this.roleCache, id)
  }

  // ------------------------------------------------------------------ Hubs

  getHubs(): Promise<Hub[]> {
    return hubMgmt.getHubs(this.db)
  }

  getHub(id: string): Promise<Hub | null> {
    return hubMgmt.getHub(this.db, id)
  }

  createHub(data: CreateHubData): Promise<Hub> {
    return hubMgmt.createHub(this.db, data)
  }

  updateHub(id: string, data: Partial<Hub>): Promise<Hub> {
    return hubMgmt.updateHub(this.db, id, data)
  }

  archiveHub(id: string): Promise<void> {
    return hubMgmt.archiveHub(this.db, id)
  }

  deleteHub(id: string): Promise<void> {
    return hubMgmt.deleteHub(this.db, id)
  }

  // ------------------------------------------------------------------ Hub Key Envelopes

  getHubKeyEnvelopes(hubId: string): Promise<HubKeyEntry[]> {
    return hubMgmt.getHubKeyEnvelopes(this.db, hubId)
  }

  setHubKeyEnvelopes(hubId: string, envelopes: HubKeyEntry[]): Promise<void> {
    return hubMgmt.setHubKeyEnvelopes(this.db, this.hubKeyCache, hubId, envelopes)
  }

  // ------------------------------------------------------------------ Geocoding Config

  getGeocodingConfig(): Promise<GeocodingConfigAdmin> {
    return geocodingConfigMod.getGeocodingConfig(this.db, this.crypto)
  }

  updateGeocodingConfig(data: Partial<GeocodingConfigAdmin>): Promise<GeocodingConfigAdmin> {
    return geocodingConfigMod.updateGeocodingConfig(this.db, this.crypto, data)
  }

  // ------------------------------------------------------------------ Test Reset

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
    await this.db.delete(reportCategoriesTable)
    await this.db.delete(customFieldDefinitions)
    await this.db.delete(fallbackGroupTable)
    // Reset settings to defaults by deleting stored overrides
    await this.db.delete(spamSettingsTable)
    await this.db.delete(transcriptionSettingsTable)
    await this.db.delete(callSettingsTable)
    await this.db.delete(ivrLanguages)
    await this.db.delete(messagingConfigTable)
    await this.db.delete(telephonyConfigTable)
    await this.db.delete(geocodingConfigTable)
    await this.db.delete(setupStateTable)
    // Delete all roles — DEFAULT_ROLES are re-seeded on first use via getRole/listRoles
    await this.db.delete(rolesTable)
  }
}
