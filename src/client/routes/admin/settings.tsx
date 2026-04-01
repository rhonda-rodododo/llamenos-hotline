import { CallSettingsSection } from '@/components/admin-settings/call-settings-section'
import { ChannelSettings } from '@/components/admin-settings/channel-settings'
import { CustomFieldsSection } from '@/components/admin-settings/custom-fields-section'
import { GeocodingSettingsSection } from '@/components/admin-settings/geocoding-settings-section'
import { IvrLanguagesSection } from '@/components/admin-settings/ivr-languages-section'
import { PasskeyPolicySection } from '@/components/admin-settings/passkey-policy-section'
import { RCSChannelSection } from '@/components/admin-settings/rcs-channel-section'
import { ReportTypesSection } from '@/components/admin-settings/report-types-section'
import { RolesSection } from '@/components/admin-settings/roles-section'
import { SignalChannelSection } from '@/components/admin-settings/signal-channel-section'
import { SpamSection } from '@/components/admin-settings/spam-section'
import { TelephonyProviderSection } from '@/components/admin-settings/telephony-provider-section'
import { TranscriptionSection } from '@/components/admin-settings/transcription-section'
import { VoicePromptsSection } from '@/components/admin-settings/voice-prompts-section'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { usePersistedExpanded } from '@/components/settings-section'
import {
  type CallSettings,
  type CustomFieldDefinition,
  type GeocodingConfigAdmin,
  type IvrAudioRecording,
  type SpamSettings,
  type TelephonyProviderConfig,
  type WebAuthnSettings,
  updateSpamSettings,
  updateTranscriptionSettings,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { queryKeys } from '@/lib/queries/keys'
import { useReportTypes } from '@/lib/queries/reports'
import {
  useCallSettings,
  useCustomFields,
  useGeocodingConfig,
  useIvrAudio,
  useIvrLanguages,
  useMessagingConfig,
  useProviderConfig,
  useSpamSettings,
  useTranscriptionSettings,
  useWebAuthnSettings,
} from '@/lib/queries/settings'
import { useToast } from '@/lib/toast'
import { IVR_LANGUAGES } from '@shared/languages'
import {
  GEOCODING_PROVIDER_LABELS,
  type MessagingConfig,
  type ReportType,
  type TelephonyProviderDraft,
} from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    section: (search.section as string) || '',
  }),
})

function AdminSettingsPage() {
  const { t } = useTranslation()
  const { section } = useSearch({ from: '/admin/settings' })
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // UI-only state
  const [confirmToggle, setConfirmToggle] = useState<{ key: string; newValue: boolean } | null>(
    null
  )
  // Local draft state for provider (section manages its own draft edits)
  const [providerDraft, setProviderDraft] = useState<TelephonyProviderDraft>({ type: 'twilio' })

  // Settings queries
  const { data: spam } = useSpamSettings()
  const { data: callSet } = useCallSettings()
  const { data: transcriptionSettings } = useTranscriptionSettings()
  const { data: ivrEnabledData } = useIvrLanguages()
  const { data: ivrAudio = [] } = useIvrAudio()
  const { data: webauthnSettings } = useWebAuthnSettings()
  const { data: customFieldDefs = [] } = useCustomFields()
  const { data: providerConfig } = useProviderConfig()
  const { data: messagingConfig } = useMessagingConfig()
  const { data: geocodingConfig } = useGeocodingConfig()
  const { data: reportTypesData } = useReportTypes()

  const ivrEnabled = ivrEnabledData ?? [...IVR_LANGUAGES]
  const globalTranscription = transcriptionSettings?.globalEnabled ?? false
  const allowVolunteerOptOut = transcriptionSettings?.allowVolunteerOptOut ?? false
  const reportTypes = reportTypesData ?? []

  // Sync provider draft when config loads
  useEffect(() => {
    if (providerConfig) {
      setProviderDraft(providerConfig)
    }
  }, [providerConfig])

  // Show loading until the core settings are available
  const isLoading =
    spam === undefined && callSet === undefined && transcriptionSettings === undefined

  const { expanded, toggleSection } = usePersistedExpanded(
    'settings-expanded:/admin/settings',
    ['passkey-policy'],
    section || undefined
  )
  const scrolledRef = useRef(false)

  useEffect(() => {
    if (!isLoading && section && !scrolledRef.current) {
      scrolledRef.current = true
      requestAnimationFrame(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [isLoading, section])

  function handleConfirmToggle(key: string, newValue: boolean) {
    setConfirmToggle({ key, newValue })
  }

  async function applyConfirmToggle() {
    if (!confirmToggle) return
    const { key, newValue } = confirmToggle
    try {
      if (key === 'transcription') {
        const res = await updateTranscriptionSettings({ globalEnabled: newValue })
        queryClient.setQueryData(queryKeys.settings.transcription(), res)
      } else if (key === 'captcha') {
        const res = await updateSpamSettings({ voiceCaptchaEnabled: newValue })
        queryClient.setQueryData(queryKeys.settings.spam(), res)
      } else if (key === 'rateLimit') {
        const res = await updateSpamSettings({ rateLimitEnabled: newValue })
        queryClient.setQueryData(queryKeys.settings.spam(), res)
      }
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  const confirmTitles: Record<string, string> = {
    transcription: t('confirm.transcriptionTitle'),
    captcha: t('confirm.captchaTitle'),
    rateLimit: t('confirm.rateLimitTitle'),
  }

  const confirmDescriptions: Record<string, string> = {
    transcription: confirmToggle?.newValue
      ? t('confirm.transcriptionEnable')
      : t('confirm.transcriptionDisable'),
    captcha: confirmToggle?.newValue ? t('confirm.captchaEnable') : t('confirm.captchaDisable'),
    rateLimit: confirmToggle?.newValue
      ? t('confirm.rateLimitEnable')
      : t('confirm.rateLimitDisable'),
  }

  // Compute status summaries for collapsed sections
  const passkeyStatus = webauthnSettings
    ? webauthnSettings.requireForAdmins && webauthnSettings.requireForVolunteers
      ? t('webauthn.requiredAll', { defaultValue: 'Required for all' })
      : webauthnSettings.requireForAdmins
        ? t('webauthn.requiredAdmins', { defaultValue: 'Required for admins' })
        : webauthnSettings.requireForVolunteers
          ? t('webauthn.requiredVolunteers', { defaultValue: 'Required for volunteers' })
          : t('webauthn.notRequired', { defaultValue: 'Not required' })
    : undefined

  const telephonyStatus = providerConfig?.type
    ? providerConfig.type.charAt(0).toUpperCase() + providerConfig.type.slice(1)
    : t('settings.notConfigured', { defaultValue: 'Not configured' })

  const transcriptionStatus = globalTranscription
    ? t('common.enabled', { defaultValue: 'Enabled' })
    : t('common.disabled', { defaultValue: 'Disabled' })

  const ivrStatus = `${ivrEnabled.length} ${t('settings.languages', { defaultValue: 'languages' })}`

  const callStatus = callSet
    ? `${t('settings.queue', { defaultValue: 'Queue' })}: ${callSet.queueTimeoutSeconds || 180}s, ${t('settings.voicemail', { defaultValue: 'VM' })}: ${callSet.voicemailMaxSeconds}s`
    : undefined

  const customFieldsStatus =
    customFieldDefs.length > 0
      ? `${customFieldDefs.length} ${t('settings.fields', { defaultValue: 'fields' })}`
      : t('common.none', { defaultValue: 'None' })

  const reportTypesStatus =
    reportTypes.filter((rt) => !rt.archivedAt).length > 0
      ? `${reportTypes.filter((rt) => !rt.archivedAt).length} ${t('settings.types', { defaultValue: 'types' })}`
      : t('common.none', { defaultValue: 'None' })

  const spamStatus = spam
    ? `${t('settings.captcha', { defaultValue: 'CAPTCHA' })}: ${spam.voiceCaptchaEnabled ? t('common.on', { defaultValue: 'on' }) : t('common.off', { defaultValue: 'off' })}, ${t('settings.rateLimit', { defaultValue: 'Rate limit' })}: ${spam.rateLimitEnabled ? t('common.on', { defaultValue: 'on' }) : t('common.off', { defaultValue: 'off' })}`
    : undefined

  if (!isAdmin) return <div className="text-muted-foreground">{t('common.error')}</div>
  if (isLoading) return <div className="text-muted-foreground">{t('common.loading')}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold sm:text-2xl">{t('settings.hubTitle')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('settings.hubDescription')}</p>

      <ChannelSettings
        expanded={expanded.has('channel-settings')}
        onToggle={(open) => toggleSection('channel-settings', open)}
        statusSummary={t('channelSettings.summary', { defaultValue: 'Manage channels' })}
      />

      {webauthnSettings && (
        <PasskeyPolicySection
          settings={webauthnSettings}
          onChange={(updated: WebAuthnSettings) =>
            queryClient.setQueryData(queryKeys.settings.webauthn(), updated)
          }
          expanded={expanded.has('passkey-policy')}
          onToggle={(open) => toggleSection('passkey-policy', open)}
          statusSummary={passkeyStatus}
        />
      )}

      <RolesSection
        expanded={expanded.has('roles')}
        onToggle={(open) => toggleSection('roles', open)}
        statusSummary={t('roles.summary', { defaultValue: 'Manage roles' })}
      />

      <TelephonyProviderSection
        config={providerConfig ?? null}
        draft={providerDraft}
        onConfigChange={(updated: TelephonyProviderConfig | null) =>
          queryClient.setQueryData(queryKeys.settings.provider(), updated)
        }
        onDraftChange={setProviderDraft}
        expanded={expanded.has('telephony-provider')}
        onToggle={(open) => toggleSection('telephony-provider', open)}
        statusSummary={telephonyStatus}
      />

      <TranscriptionSection
        globalEnabled={globalTranscription}
        allowOptOut={allowVolunteerOptOut}
        onGlobalChange={(enabled: boolean) =>
          queryClient.setQueryData(queryKeys.settings.transcription(), {
            ...transcriptionSettings,
            globalEnabled: enabled,
          })
        }
        onOptOutChange={(enabled: boolean) =>
          queryClient.setQueryData(queryKeys.settings.transcription(), {
            ...transcriptionSettings,
            allowVolunteerOptOut: enabled,
          })
        }
        onConfirmToggle={handleConfirmToggle}
        expanded={expanded.has('transcription')}
        onToggle={(open) => toggleSection('transcription', open)}
        statusSummary={transcriptionStatus}
      />

      <IvrLanguagesSection
        enabled={ivrEnabled}
        onChange={(langs: string[]) =>
          queryClient.setQueryData(queryKeys.settings.ivrLanguages(), langs)
        }
        expanded={expanded.has('ivr-languages')}
        onToggle={(open) => toggleSection('ivr-languages', open)}
        statusSummary={ivrStatus}
      />

      {callSet && (
        <CallSettingsSection
          settings={callSet}
          onChange={(updated: CallSettings) =>
            queryClient.setQueryData(queryKeys.settings.call(), updated)
          }
          expanded={expanded.has('call-settings')}
          onToggle={(open) => toggleSection('call-settings', open)}
          statusSummary={callStatus}
        />
      )}

      <VoicePromptsSection
        ivrEnabled={ivrEnabled}
        recordings={ivrAudio}
        onRecordingsChange={(updated: IvrAudioRecording[]) =>
          queryClient.setQueryData(queryKeys.settings.ivrAudio(), updated)
        }
        expanded={expanded.has('voice-prompts')}
        onToggle={(open) => toggleSection('voice-prompts', open)}
        statusSummary={
          ivrAudio.length > 0
            ? t('settings.customized', { defaultValue: 'Customized' })
            : t('settings.default', { defaultValue: 'Default' })
        }
      />

      <CustomFieldsSection
        fields={customFieldDefs}
        onChange={(updated: CustomFieldDefinition[]) =>
          queryClient.setQueryData(queryKeys.settings.customFields(), updated)
        }
        expanded={expanded.has('custom-fields')}
        onToggle={(open) => toggleSection('custom-fields', open)}
        statusSummary={customFieldsStatus}
      />

      <ReportTypesSection
        reportTypes={reportTypes}
        customFields={customFieldDefs}
        onChange={(updated: ReportType[]) =>
          queryClient.setQueryData(queryKeys.settings.reportTypes(), updated)
        }
        expanded={expanded.has('report-types')}
        onToggle={(open) => toggleSection('report-types', open)}
        statusSummary={reportTypesStatus}
      />

      {geocodingConfig && (
        <GeocodingSettingsSection
          config={geocodingConfig}
          onChange={(updated: GeocodingConfigAdmin) =>
            queryClient.setQueryData(queryKeys.settings.geocoding(), updated)
          }
          expanded={expanded.has('geocoding')}
          onToggle={(open) => toggleSection('geocoding', open)}
          statusSummary={
            geocodingConfig.enabled && geocodingConfig.provider
              ? GEOCODING_PROVIDER_LABELS[geocodingConfig.provider]
              : t('common.disabled')
          }
        />
      )}

      {spam && (
        <SpamSection
          settings={spam}
          onChange={(updated: SpamSettings) =>
            queryClient.setQueryData(queryKeys.settings.spam(), updated)
          }
          onConfirmToggle={handleConfirmToggle}
          expanded={expanded.has('spam')}
          onToggle={(open) => toggleSection('spam', open)}
          statusSummary={spamStatus}
        />
      )}

      {messagingConfig && (
        <RCSChannelSection
          config={messagingConfig}
          onConfigChange={(updated: MessagingConfig) =>
            queryClient.setQueryData(queryKeys.settings.messaging(), updated)
          }
          expanded={expanded.has('rcs-channel')}
          onToggle={(open) => toggleSection('rcs-channel', open)}
          statusSummary={
            messagingConfig.rcs
              ? t('common.configured', { defaultValue: 'Configured' })
              : t('settings.notConfigured', { defaultValue: 'Not configured' })
          }
        />
      )}

      {messagingConfig && (
        <SignalChannelSection
          config={messagingConfig}
          onConfigChange={(updated: MessagingConfig) =>
            queryClient.setQueryData(queryKeys.settings.messaging(), updated)
          }
          expanded={expanded.has('signal-channel')}
          onToggle={(open) => toggleSection('signal-channel', open)}
          statusSummary={
            messagingConfig.signal
              ? t('common.configured', { defaultValue: 'Configured' })
              : t('settings.notConfigured', { defaultValue: 'Not configured' })
          }
        />
      )}

      <ConfirmDialog
        open={!!confirmToggle}
        onOpenChange={(open) => {
          if (!open) setConfirmToggle(null)
        }}
        title={confirmToggle ? confirmTitles[confirmToggle.key] : ''}
        description={confirmToggle ? confirmDescriptions[confirmToggle.key] : ''}
        variant="default"
        onConfirm={applyConfirmToggle}
      />
    </div>
  )
}
