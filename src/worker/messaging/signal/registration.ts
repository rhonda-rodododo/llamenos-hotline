import type { MessagingConfig, SignalRegistrationPending } from '../../../shared/types'
import type { DOStub } from '../../types'

const SIGNAL_VERIFICATION_PATTERN = /^Your Signal code: \d{6}/
const SIGNAL_CODE_PATTERN = /Your Signal code: (\d{6})/

/**
 * Check if an SMS body is a Signal verification code message.
 * No side effects — purely a pattern match.
 */
export function isSignalVerificationSMS(body: string): boolean {
  return SIGNAL_VERIFICATION_PATTERN.test(body)
}

/**
 * Extract the 6-digit verification code from a Signal verification SMS.
 * Throws if no match — caller should guard with `isSignalVerificationSMS` first.
 */
export function extractSignalCode(body: string): string {
  const match = body.match(SIGNAL_CODE_PATTERN)
  if (!match) {
    throw new Error('No Signal verification code found in message body')
  }
  return match[1]
}

/**
 * Complete Signal registration by verifying the code with the bridge,
 * then persisting the Signal config to SettingsDO.
 *
 * Never throws — errors are written back to SettingsDO as `status: 'failed'`.
 */
export async function completeSignalRegistration(
  pending: SignalRegistrationPending,
  code: string,
  settings: DOStub
): Promise<void> {
  try {
    // SSRF allow-list validation: ensure pending.bridgeUrl matches configured bridge URL
    const messagingRes = await settings.fetch(new Request('http://do/settings/messaging'))
    const messagingConfig = (await messagingRes.json()) as MessagingConfig | null
    const configuredBridgeUrl = messagingConfig?.signal?.bridgeUrl

    if (configuredBridgeUrl) {
      // Validate against configured bridge URL
      if (pending.bridgeUrl !== configuredBridgeUrl) {
        await settings.fetch(
          new Request('http://do/settings/signal-registration-pending', {
            method: 'DELETE',
          })
        )
        return
      }
    }
    // If no configured signal config yet, the bridge URL was already validated
    // at registration initiation time (HTTPS check + SSRF guard in route handler)

    // Call the bridge to verify the code
    const verifyUrl = `${pending.bridgeUrl}/v1/register/${encodeURIComponent(pending.number)}/verify/${encodeURIComponent(code)}`
    const bridgeRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (bridgeRes.ok) {
      // Build SignalConfig from pending state and persist it
      const signalConfig = {
        bridgeUrl: pending.bridgeUrl,
        bridgeApiKey: '', // Will be set separately by the admin
        webhookSecret: '', // Will be set separately by the admin
        registeredNumber: pending.number,
      }

      // Read current messaging config and merge in the new signal config
      const currentRes = await settings.fetch(new Request('http://do/settings/messaging'))
      const currentConfig = (await currentRes.json()) as MessagingConfig
      const updatedConfig: MessagingConfig = {
        ...currentConfig,
        signal: {
          ...signalConfig,
          // Preserve existing API key and webhook secret if they were already configured
          bridgeApiKey: currentConfig.signal?.bridgeApiKey || '',
          webhookSecret: currentConfig.signal?.webhookSecret || '',
        },
        enabledChannels: currentConfig.enabledChannels.includes('signal')
          ? currentConfig.enabledChannels
          : [...currentConfig.enabledChannels, 'signal'],
      }

      await settings.fetch(
        new Request('http://do/settings/messaging', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedConfig),
        })
      )

      // Mark registration as complete then clear
      await settings.fetch(
        new Request('http://do/settings/signal-registration-pending', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...pending, status: 'complete' }),
        })
      )
    } else {
      // Bridge returned error — write failure state
      const errorText = await bridgeRes.text().catch(() => `HTTP ${bridgeRes.status}`)
      await settings.fetch(
        new Request('http://do/settings/signal-registration-pending', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...pending,
            status: 'failed',
            error: errorText,
          } satisfies SignalRegistrationPending),
        })
      )
    }
  } catch (err) {
    // Never throw — write error back to SettingsDO
    const errorMsg = err instanceof Error ? err.message : String(err)
    try {
      await settings.fetch(
        new Request('http://do/settings/signal-registration-pending', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...pending,
            status: 'failed',
            error: errorMsg,
          } satisfies SignalRegistrationPending),
        })
      )
    } catch {
      // Last resort — can't even write back to DO
      console.error('[signal-registration] Failed to write error state:', errorMsg)
    }
  }
}
