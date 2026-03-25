import { SettingsSection } from '@/components/settings-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type CallSettings, updateCallSettings } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { PhoneForwarded } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  settings: CallSettings
  onChange: (settings: CallSettings) => void
  expanded: boolean
  onToggle: (open: boolean) => void
  statusSummary?: string
}

export function CallSettingsSection({
  settings,
  onChange,
  expanded,
  onToggle,
  statusSummary,
}: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()

  return (
    <SettingsSection
      id="call-settings"
      title={t('callSettings.title')}
      description={t('callSettings.description')}
      icon={<PhoneForwarded className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded}
      onToggle={onToggle}
      basePath="/admin/settings"
      statusSummary={statusSummary}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>{t('callSettings.voicemailMode')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('callSettings.voicemailModeDescription')}
          </p>
          <Select
            value={settings.voicemailMode}
            onValueChange={async (val) => {
              try {
                const res = await updateCallSettings({
                  voicemailMode: val as 'auto' | 'always' | 'never',
                })
                onChange(res)
              } catch {
                toast(t('common.error'), 'error')
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('callSettings.voicemailModeAuto')}</SelectItem>
              <SelectItem value="always">{t('callSettings.voicemailModeAlways')}</SelectItem>
              <SelectItem value="never">{t('callSettings.voicemailModeNever')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="queue-timeout">{t('callSettings.queueTimeout')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('callSettings.queueTimeoutDescription')}
          </p>
          <Input
            id="queue-timeout"
            type="number"
            value={settings.queueTimeoutSeconds}
            onChange={async (e) => {
              try {
                const val = Number.parseInt(e.target.value) || 90
                const res = await updateCallSettings({ queueTimeoutSeconds: val })
                onChange(res)
              } catch {
                toast(t('common.error'), 'error')
              }
            }}
            min={30}
            max={300}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voicemail-max">{t('callSettings.voicemailMax')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('callSettings.voicemailMaxDescription')}
          </p>
          <Input
            id="voicemail-max"
            type="number"
            value={settings.voicemailMaxSeconds}
            onChange={async (e) => {
              try {
                const val = Number.parseInt(e.target.value) || 120
                const res = await updateCallSettings({ voicemailMaxSeconds: val })
                onChange(res)
              } catch {
                toast(t('common.error'), 'error')
              }
            }}
            min={30}
            max={300}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('callSettings.retentionDays')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('callSettings.retentionDaysDescription')}
          </p>
          <Input
            type="number"
            value={settings.voicemailRetentionDays ?? ''}
            placeholder="∞"
            disabled
          />
          <p className="text-xs text-amber-600">{t('callSettings.retentionNotYetActive')}</p>
        </div>
      </div>
    </SettingsSection>
  )
}
