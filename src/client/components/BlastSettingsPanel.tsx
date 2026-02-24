import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getBlastSettings, updateBlastSettings } from '@/lib/api'
import type { BlastSettings } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Settings2 } from 'lucide-react'
import { DEFAULT_BLAST_SETTINGS } from '@shared/types'

export function BlastSettingsPanel() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [settings, setSettings] = useState<BlastSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getBlastSettings()
      .then(setSettings)
      .catch(() => {
        // Use defaults if not configured yet
        setSettings({ ...DEFAULT_BLAST_SETTINGS })
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    try {
      const updated = await updateBlastSettings(settings)
      setSettings(updated)
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !settings) return <div className="text-muted-foreground">{t('common.loading')}</div>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4" />
          {t('blasts.blastSettings')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('blasts.subscribeKeyword')}</Label>
            <Input value={settings.subscribeKeyword} onChange={e => setSettings({ ...settings, subscribeKeyword: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>{t('blasts.unsubscribeKeyword')}</Label>
            <Input value={settings.unsubscribeKeyword} onChange={e => setSettings({ ...settings, unsubscribeKeyword: e.target.value })} disabled />
            <p className="text-xs text-muted-foreground">{t('blasts.stopRequired')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('blasts.confirmationMsg')}</Label>
          <Input value={settings.confirmationMessage} onChange={e => setSettings({ ...settings, confirmationMessage: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label>{t('blasts.unsubscribeMsg')}</Label>
          <Input value={settings.unsubscribeMessage} onChange={e => setSettings({ ...settings, unsubscribeMessage: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label>{t('blasts.optOutFooter')}</Label>
          <Input value={settings.optOutFooter} onChange={e => setSettings({ ...settings, optOutFooter: e.target.value })} />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <Label>{t('blasts.doubleOptIn')}</Label>
            <p className="text-xs text-muted-foreground">{t('blasts.doubleOptInDesc')}</p>
          </div>
          <Switch checked={settings.doubleOptIn} onCheckedChange={c => setSettings({ ...settings, doubleOptIn: c })} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('blasts.maxPerDay')}</Label>
            <Input type="number" value={settings.maxBlastsPerDay} onChange={e => setSettings({ ...settings, maxBlastsPerDay: parseInt(e.target.value) || 10 })} />
          </div>
          <div className="space-y-2">
            <Label>{t('blasts.rateLimit')}</Label>
            <Input type="number" value={settings.rateLimitPerSecond} onChange={e => setSettings({ ...settings, rateLimitPerSecond: parseInt(e.target.value) || 10 })} />
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </CardContent>
    </Card>
  )
}
