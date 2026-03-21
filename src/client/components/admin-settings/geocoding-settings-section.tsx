import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { GeocodingConfigAdmin } from '@protocol/schemas/geocoding'

export function GeocodingSettingsSection() {
  const [config, setConfig] = useState<GeocodingConfigAdmin>({
    provider: null, apiKey: '', countries: [], enabled: false,
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; latency: number } | null>(null)

  useEffect(() => {
    fetch('/api/settings/geocoding', { credentials: 'include' })
      .then(r => r.json())
      .then((data: unknown) => setConfig(c => ({ ...c, ...(data as Omit<GeocodingConfigAdmin, 'apiKey'>) })))
  }, [])

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/settings/geocoding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      })
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/settings/geocoding/test', { credentials: 'include' })
      setTestResult(await res.json() as { ok: boolean; latency: number })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Geocoding</CardTitle>
        <CardDescription>
          Address autocomplete and reverse geocoding for location fields.
          API keys are stored server-side and never sent to clients.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="geocoding-enabled"
            checked={config.enabled}
            onCheckedChange={enabled => setConfig(c => ({ ...c, enabled }))}
          />
          <Label htmlFor="geocoding-enabled">Enable geocoding</Label>
        </div>

        <div className="space-y-2">
          <Label>Provider</Label>
          <Select
            value={config.provider ?? ''}
            onValueChange={v => setConfig(c => ({ ...c, provider: v as GeocodingConfigAdmin['provider'] }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opencage">OpenCage (EU, GDPR-compliant)</SelectItem>
              <SelectItem value="geoapify">Geoapify (EU, GDPR-compliant)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>API Key</Label>
          <Input
            type="password"
            value={config.apiKey}
            onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
            placeholder="Enter API key…"
          />
        </div>

        <div className="space-y-2">
          <Label>Country Restriction (ISO codes, comma-separated)</Label>
          <Input
            value={config.countries.join(', ')}
            onChange={e => setConfig(c => ({
              ...c,
              countries: e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
            }))}
            placeholder="US, MX, DE"
          />
          <p className="text-xs text-muted-foreground">
            Restricts geocoding results to these countries. Leave blank for worldwide.
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" onClick={test} disabled={testing || !config.enabled}>
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
        </div>

        {testResult && (
          <p className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {testResult.ok ? `Connected (${testResult.latency}ms)` : `Connection failed (${testResult.latency}ms)`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
