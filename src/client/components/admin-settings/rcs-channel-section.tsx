import { SettingsSection } from '@/components/settings-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { type MessagingConfig, testMessagingChannel, updateMessagingConfig } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { CheckCircle2, Copy, Loader2, MessageSquare, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface RCSChannelSectionProps {
  config: MessagingConfig
  onConfigChange: (config: MessagingConfig) => void
  expanded: boolean
  onToggle: (open: boolean) => void
  statusSummary?: string
}

export function RCSChannelSection({
  config,
  onConfigChange,
  expanded,
  onToggle,
  statusSummary,
}: RCSChannelSectionProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const rcs = config.rcs || {
    agentId: '',
    serviceAccountKey: '',
    webhookSecret: '',
    fallbackToSms: true,
    autoResponse: '',
    afterHoursResponse: '',
  }

  const webhookUrl = `${window.location.origin}/api/messaging/rcs/webhook`

  function updateRcs(updates: Record<string, unknown>) {
    const updated = { ...config, rcs: { ...rcs, ...updates } }
    onConfigChange(updated)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateMessagingConfig({
        ...config,
        enabledChannels: config.enabledChannels.includes('rcs')
          ? config.enabledChannels
          : [...config.enabledChannels, 'rcs'],
        rcs: { ...rcs },
      })
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testMessagingChannel('rcs')
      setTestResult(res.connected)
    } catch {
      setTestResult(false)
    } finally {
      setTesting(false)
    }
  }

  return (
    <SettingsSection
      id="rcs-channel"
      title={t('rcs.title', { defaultValue: 'RCS Channel' })}
      description={t('rcs.description', {
        defaultValue: 'Google RCS Business Messaging for rich messaging experiences.',
      })}
      icon={<MessageSquare className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded}
      onToggle={onToggle}
      statusSummary={statusSummary}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rcs-agent-id">{t('rcs.agentId', { defaultValue: 'Agent ID' })}</Label>
          <Input
            id="rcs-agent-id"
            value={rcs.agentId}
            onChange={(e) => updateRcs({ agentId: e.target.value })}
            placeholder="brands/BRAND_ID/agents/AGENT_ID"
            data-testid="rcs-agent-id"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="rcs-service-key">
            {t('rcs.serviceAccountKey', { defaultValue: 'Service Account Key (JSON)' })}
          </Label>
          <textarea
            id="rcs-service-key"
            value={rcs.serviceAccountKey}
            onChange={(e) => updateRcs({ serviceAccountKey: e.target.value })}
            placeholder='{"type": "service_account", ...}'
            className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
            data-testid="rcs-service-key"
          />
        </div>

        <div className="space-y-2">
          <Label>{t('rcs.webhookUrl', { defaultValue: 'Webhook URL' })}</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">
              {webhookUrl}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl)
                toast(t('common.success'), 'success')
              }}
              aria-label={t('a11y.copyToClipboard')}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="rcs-webhook-secret">
            {t('rcs.webhookSecret', { defaultValue: 'Webhook Secret' })}
          </Label>
          <Input
            id="rcs-webhook-secret"
            type="password"
            value={rcs.webhookSecret || ''}
            onChange={(e) => updateRcs({ webhookSecret: e.target.value })}
            data-testid="rcs-webhook-secret"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label>{t('rcs.fallbackToSms', { defaultValue: 'Fallback to SMS' })}</Label>
            <p className="text-xs text-muted-foreground">
              {t('rcs.fallbackToSmsDesc', {
                defaultValue: 'Send via SMS when RCS is unavailable for the recipient.',
              })}
            </p>
          </div>
          <Switch
            checked={rcs.fallbackToSms}
            onCheckedChange={(checked) => updateRcs({ fallbackToSms: checked })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="rcs-auto-response">
            {t('rcs.autoResponse', { defaultValue: 'Auto-Response' })}
          </Label>
          <Input
            id="rcs-auto-response"
            value={rcs.autoResponse || ''}
            onChange={(e) => updateRcs({ autoResponse: e.target.value })}
            placeholder={t('setup.autoResponsePlaceholder')}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving || !rcs.agentId}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || !rcs.agentId}>
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t('telephonyProvider.testing')}
              </>
            ) : (
              t('telephonyProvider.testConnection')
            )}
          </Button>
          {testResult !== null && (
            <Badge variant="outline" className={testResult ? 'text-green-600' : 'text-red-600'}>
              {testResult ? (
                <>
                  <CheckCircle2 className="h-3 w-3" /> {t('telephonyProvider.testSuccess')}
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3" /> {t('telephonyProvider.testFailed')}
                </>
              )}
            </Badge>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}
