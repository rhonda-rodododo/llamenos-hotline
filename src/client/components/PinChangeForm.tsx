import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authFacadeClient } from '@/lib/auth-facade-client'
import { isUnlocked } from '@/lib/key-manager'
import {
  deriveKekProof,
  isValidPin,
  loadEncryptedKeyV2,
  rewrapWithNewPin,
} from '@/lib/key-store-v2'
import { useChangePin } from '@/lib/queries/security-actions'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function PinChangeForm() {
  const { t } = useTranslation()
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const change = useChangePin()

  const submit = async () => {
    setError(null)
    setSuccess(false)
    if (newPin !== confirmPin) {
      setError(t('security.pin.mismatch', 'New PINs do not match'))
      return
    }
    if (!isValidPin(newPin)) {
      setError(t('security.pin.tooShort', 'PIN must be 6-8 digits'))
      return
    }
    const unlocked = await isUnlocked()
    if (!unlocked) {
      setError(t('security.pin.locked', 'Account is locked; unlock first'))
      return
    }
    const blob = loadEncryptedKeyV2()
    if (!blob) {
      setError(t('security.pin.locked', 'Account is locked; unlock first'))
      return
    }
    try {
      const userInfo = await authFacadeClient.getUserInfo()
      if (!userInfo) {
        setError(t('security.pin.locked', 'Account is locked; unlock first'))
        return
      }
      const newCiphertext = await rewrapWithNewPin(newPin, { idpValue: userInfo.nsecSecret }, blob)
      const currentPinProof = deriveKekProof(currentPin)
      const newKekProof = deriveKekProof(newPin)
      await change.mutateAsync({
        currentPinProof,
        newKekProof,
        newEncryptedSecretKey: newCiphertext,
      })
      setSuccess(true)
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN change failed')
    }
  }

  return (
    <div className="space-y-3 max-w-md" data-testid="pin-change-form">
      <h3 className="text-lg font-semibold">{t('security.pin.title', 'Change PIN')}</h3>
      <div className="space-y-2">
        <Label>{t('security.pin.current', 'Current PIN')}</Label>
        <Input
          type="password"
          value={currentPin}
          onChange={(e) => setCurrentPin(e.target.value)}
          data-testid="current-pin"
        />
      </div>
      <div className="space-y-2">
        <Label>{t('security.pin.new', 'New PIN')}</Label>
        <Input
          type="password"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value)}
          data-testid="new-pin"
        />
      </div>
      <div className="space-y-2">
        <Label>{t('security.pin.confirm', 'Confirm new PIN')}</Label>
        <Input
          type="password"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value)}
          data-testid="confirm-pin"
        />
      </div>
      {error && (
        <div className="text-sm text-red-600" data-testid="pin-error">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-600" data-testid="pin-success">
          {t('security.pin.success', 'PIN changed successfully')}
        </div>
      )}
      <Button onClick={submit} disabled={change.isPending} data-testid="submit-pin">
        {change.isPending ? t('common.saving', 'Saving…') : t('security.pin.save', 'Change PIN')}
      </Button>
    </div>
  )
}
