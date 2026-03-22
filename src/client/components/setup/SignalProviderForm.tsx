import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { testSignalBridge } from '@/lib/api'
import { useToast } from '@/lib/toast'
import type { SignalConfig } from '@shared/types'
import { Copy, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SetupData } from './SetupWizard'

interface Props {
  data: SetupData
  onChange: (patch: Partial<SetupData>) => void
}

export function SignalProviderForm({ data, onChange }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const config = data.signalConfig || {}

  function update(patch: Partial<SignalConfig>) {
    onChange({ signalConfig: { ...config, ...patch }, signalValidated: false })
    setTestResult(null)
  }

  async function handleTest() {
    setTesting(true)
    try {
      const result = await testSignalBridge({
        bridgeUrl: config.bridgeUrl || '',
        bridgeApiKey: config.bridgeApiKey || '',
      })
      setTestResult(result)
      if (result.ok) onChange({ signalValidated: true })
    } catch (err) {
      setTestResult({ ok: false, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  function copyWebhookUrl() {
    const url = `${window.location.origin}/telephony/signal`
    navigator.clipboard.writeText(url)
    toast(t('setup.webhookCopied'), 'success')
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{t('setup.signalProvider')}</h3>
      <p className="text-xs text-muted-foreground">{t('setup.signalDescription')}</p>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label>{t('setup.signalBridgeUrl')}</Label>
          <Input
            value={config.bridgeUrl || ''}
            onChange={(e) => update({ bridgeUrl: e.target.value })}
            placeholder="https://signal-bridge.internal:8080"
          />
        </div>
        <div className="space-y-1">
          <Label>{t('setup.signalApiKey')}</Label>
          <Input
            type="password"
            value={config.bridgeApiKey || ''}
            onChange={(e) => update({ bridgeApiKey: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>{t('setup.signalWebhookSecret')}</Label>
          <Input
            type="password"
            value={config.webhookSecret || ''}
            onChange={(e) => update({ webhookSecret: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>{t('setup.signalRegisteredNumber')}</Label>
          <Input
            value={config.registeredNumber || ''}
            onChange={(e) => update({ registeredNumber: e.target.value })}
            placeholder="+12125551234"
          />
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div
          className={`rounded-lg border p-3 ${testResult.ok ? 'border-green-500/30 bg-green-500/10' : 'border-destructive/30 bg-destructive/10'}`}
        >
          <p
            className={`text-xs ${testResult.ok ? 'text-green-700 dark:text-green-400' : 'text-destructive'}`}
          >
            {testResult.ok
              ? t('telephonyProvider.testSuccess')
              : `${t('telephonyProvider.testFailed')}: ${testResult.error || ''}`}
          </p>
        </div>
      )}

      {/* Webhook URL */}
      {data.signalValidated && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
          <div className="flex-1">
            <p className="text-xs font-medium">{t('setup.webhookUrl')}</p>
            <code className="text-xs text-muted-foreground">
              {window.location.origin}/telephony/signal
            </code>
          </div>
          <Button variant="ghost" size="sm" onClick={copyWebhookUrl}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={testing || !config.bridgeUrl}
      >
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {testing ? t('telephonyProvider.testing') : t('telephonyProvider.testConnection')}
      </Button>
    </div>
  )
}
