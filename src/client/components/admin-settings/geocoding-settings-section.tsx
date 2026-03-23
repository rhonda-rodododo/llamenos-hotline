import { SettingsSection } from '@/components/settings-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  type GeocodingConfigAdmin,
  testGeocodingProvider,
  updateGeocodingSettings,
} from '@/lib/api'
import { useToast } from '@/lib/toast'
import type { GeocodingProvider } from '@shared/types'
import { GEOCODING_PROVIDER_LABELS } from '@shared/types'
import { Loader2, MapPin, Save, TestTube2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  config: GeocodingConfigAdmin
  onChange: (config: GeocodingConfigAdmin) => void
  expanded: boolean
  onToggle: (open: boolean) => void
  statusSummary?: string
}

export function GeocodingSettingsSection({
  config,
  onChange,
  expanded,
  onToggle,
  statusSummary,
}: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [draft, setDraft] = useState<GeocodingConfigAdmin>(config)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    latency?: number
    error?: string
  } | null>(null)

  function updateDraft(patch: Partial<GeocodingConfigAdmin>) {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await updateGeocodingSettings(draft)
      onChange(updated)
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    // Save first, then test
    setTesting(true)
    setTestResult(null)
    try {
      await updateGeocodingSettings(draft)
      const result = await testGeocodingProvider()
      setTestResult(result)
      if (result.ok) {
        toast(t('geocoding.testSuccess', { latency: result.latency }), 'success')
      } else {
        toast(result.error || t('geocoding.testFailed'), 'error')
      }
    } catch {
      setTestResult({ ok: false, error: 'Connection failed' })
      toast(t('geocoding.testFailed'), 'error')
    } finally {
      setTesting(false)
    }
  }

  const providerOptions: Array<{ value: GeocodingProvider | ''; label: string }> = [
    { value: '', label: t('common.disabled') },
    ...Object.entries(GEOCODING_PROVIDER_LABELS).map(([value, label]) => ({
      value: value as GeocodingProvider,
      label,
    })),
  ]

  return (
    <SettingsSection
      id="geocoding"
      title={t('geocoding.title')}
      description={t('geocoding.description')}
      icon={<MapPin className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded}
      onToggle={onToggle}
      basePath="/admin/settings"
      statusSummary={statusSummary}
    >
      <div className="space-y-4">
        {/* Provider selection */}
        <div className="space-y-1">
          <Label>{t('geocoding.provider')}</Label>
          <select
            data-testid="geocoding-provider-select"
            value={draft.provider ?? ''}
            onChange={(e) => {
              const val = e.target.value as GeocodingProvider | ''
              updateDraft({
                provider: val || null,
                enabled: !!val,
              })
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {providerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* API key */}
        {draft.provider && (
          <>
            <div className="space-y-1">
              <Label htmlFor="geocoding-api-key">{t('geocoding.apiKey')}</Label>
              <Input
                id="geocoding-api-key"
                data-testid="geocoding-api-key-input"
                type="password"
                value={draft.apiKey}
                onChange={(e) => updateDraft({ apiKey: e.target.value })}
                placeholder={t('geocoding.apiKeyPlaceholder')}
              />
            </div>

            {/* Countries filter */}
            <div className="space-y-1">
              <Label htmlFor="geocoding-countries">{t('geocoding.countries')}</Label>
              <Input
                id="geocoding-countries"
                data-testid="geocoding-countries-input"
                value={draft.countries.join(', ')}
                onChange={(e) =>
                  updateDraft({
                    countries: e.target.value
                      .split(',')
                      .map((c) => c.trim().toLowerCase())
                      .filter((c) => c.length === 2),
                  })
                }
                placeholder={t('geocoding.countriesPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('geocoding.countriesHelp')}</p>
            </div>

            {/* Enable/disable toggle */}
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(checked) => updateDraft({ enabled: checked })}
              />
              <Label className="text-sm">{t('geocoding.enabled')}</Label>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button data-testid="geocoding-save-btn" disabled={saving} onClick={handleSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? t('common.loading') : t('common.save')}
          </Button>
          {draft.provider && draft.apiKey && (
            <Button
              data-testid="geocoding-test-btn"
              variant="outline"
              disabled={testing}
              onClick={handleTest}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <TestTube2 className="h-4 w-4" />
              )}
              {t('geocoding.testConnection')}
            </Button>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <p className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {testResult.ok
              ? t('geocoding.testSuccess', { latency: testResult.latency })
              : testResult.error || t('geocoding.testFailed')}
          </p>
        )}
      </div>
    </SettingsSection>
  )
}
