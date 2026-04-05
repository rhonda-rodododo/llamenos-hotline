import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authFacadeClient } from '@/lib/auth-facade-client'
import { generateRecoveryKey } from '@/lib/backup'
import { isUnlocked } from '@/lib/key-manager'
import { deriveKekProof, loadEncryptedKeyV2, rewrapWithNewRecoveryKey } from '@/lib/key-store-v2'
import { useRotateRecovery } from '@/lib/queries/security-actions'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function RecoveryRotateForm() {
  const { t } = useTranslation()
  const [pin, setPin] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rotate = useRotateRecovery()

  const submit = async () => {
    setError(null)
    const unlocked = await isUnlocked()
    if (!unlocked) {
      setError(t('security.recovery.locked', 'Unlock first'))
      return
    }
    const blob = loadEncryptedKeyV2()
    if (!blob) {
      setError(t('security.recovery.locked', 'Unlock first'))
      return
    }
    try {
      const userInfo = await authFacadeClient.getUserInfo()
      if (!userInfo) {
        setError(t('security.recovery.locked', 'Unlock first'))
        return
      }
      const key = generateRecoveryKey()
      const newCiphertext = await rewrapWithNewRecoveryKey(
        pin,
        { idpValue: userInfo.nsecSecret },
        blob
      )
      const currentPinProof = deriveKekProof(pin)
      await rotate.mutateAsync({ currentPinProof, newEncryptedSecretKey: newCiphertext })
      setNewKey(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rotation failed')
    }
  }

  const downloadKey = () => {
    if (!newKey) return
    const blob = new Blob([newKey], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `recovery-key-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3 max-w-md" data-testid="recovery-rotate-form">
      <h3 className="text-lg font-semibold">
        {t('security.recovery.title', 'Rotate recovery key')}
      </h3>
      {newKey ? (
        <div className="space-y-3">
          <div className="p-3 bg-yellow-50 border border-yellow-300 rounded text-sm">
            {t('security.recovery.warning', 'Save this key now. It will not be shown again.')}
          </div>
          <code
            className="block p-3 bg-muted rounded font-mono text-sm break-all"
            data-testid="new-recovery-key"
          >
            {newKey}
          </code>
          <Button onClick={downloadKey} data-testid="download-recovery-key">
            {t('security.recovery.download', 'Download')}
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label>{t('security.pin.current', 'Current PIN')}</Label>
            <Input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              data-testid="recovery-pin"
            />
          </div>
          {error && (
            <div className="text-sm text-red-600" data-testid="recovery-error">
              {error}
            </div>
          )}
          <Button onClick={submit} disabled={rotate.isPending || !pin} data-testid="submit-rotate">
            {rotate.isPending
              ? t('common.generating', 'Generating…')
              : t('security.recovery.rotate', 'Rotate recovery key')}
          </Button>
        </>
      )}
    </div>
  )
}
