import { CONSENT_VERSION } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { getConsentStatus, submitConsent } from './api'

interface UseConsentResult {
  needsConsent: boolean
  isLoading: boolean
  submitConsentVersion: (version: string) => Promise<void>
}

/**
 * Hook to check and record data processing consent for the authenticated user.
 * Used by ConsentGate to show/hide the consent overlay.
 */
export function useConsent(): UseConsentResult {
  const [needsConsent, setNeedsConsent] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getConsentStatus()
      .then((status) => {
        setNeedsConsent(!status.hasConsented || status.consentVersion !== CONSENT_VERSION)
      })
      .catch(() => {
        // If we can't check consent status, don't block the user
        setNeedsConsent(false)
      })
      .finally(() => setIsLoading(false))
  }, [])

  const submitConsentVersion = useCallback(async (version: string) => {
    await submitConsent(version)
    setNeedsConsent(false)
  }, [])

  return { needsConsent, isLoading, submitConsentVersion }
}
