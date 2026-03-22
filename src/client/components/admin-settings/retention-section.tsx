import { SettingsSection } from '@/components/settings-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type RetentionSettings, updateRetentionSettings } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { Database } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  settings: RetentionSettings
  onChange: (settings: RetentionSettings) => void
  expanded: boolean
  onToggle: (open: boolean) => void
}

export function RetentionSection({ settings, onChange, expanded, onToggle }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [draft, setDraft] = useState<RetentionSettings>({ ...settings })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await updateRetentionSettings(draft)
      onChange(updated)
      setDraft(updated)
      toast(t('gdpr.retentionSaved'), 'success')
    } catch {
      toast(t('gdpr.retentionSaveError'), 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleChange(key: keyof RetentionSettings, raw: string) {
    const val = Number.parseInt(raw, 10)
    if (!Number.isNaN(val)) {
      setDraft((d) => ({ ...d, [key]: val }))
    }
  }

  const fields: { key: keyof RetentionSettings; label: string; min: number; max: number }[] = [
    { key: 'callRecordsDays', label: t('gdpr.retentionCallRecords'), min: 30, max: 3650 },
    { key: 'notesDays', label: t('gdpr.retentionNotes'), min: 30, max: 3650 },
    { key: 'messagesDays', label: t('gdpr.retentionMessages'), min: 30, max: 3650 },
    { key: 'auditLogDays', label: t('gdpr.retentionAuditLog'), min: 365, max: 3650 },
  ]

  return (
    <SettingsSection
      id="retention"
      title={t('gdpr.retentionTitle')}
      description={t('gdpr.retentionDescription')}
      icon={<Database className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map(({ key, label, min, max }) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={`retention-${key}`}>{label}</Label>
            <Input
              id={`retention-${key}`}
              type="number"
              min={min}
              max={max}
              value={draft[key]}
              onChange={(e) => handleChange(key, e.target.value)}
              data-testid={`retention-${key}`}
            />
            <p className="text-xs text-muted-foreground">
              {min}–{max} {t('common.days', { defaultValue: 'days' })}
            </p>
          </div>
        ))}
      </div>
      <Button onClick={handleSave} disabled={saving} data-testid="retention-save-button">
        {saving ? t('common.loading') : t('common.save')}
      </Button>
    </SettingsSection>
  )
}
