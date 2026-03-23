import { KIND_CALL_RING } from '@shared/nostr-events'
import type { Services } from '../services'
import type { Env } from '../types'
import { getTelephony } from './adapters'
import { publishNostrEvent } from './nostr-events'

export async function startParallelRinging(
  callSid: string,
  callerNumber: string,
  origin: string,
  env: Env,
  services: Services,
  hubId?: string
) {
  try {
    // Get on-shift volunteers
    let onShiftPubkeys = await services.shifts.getEffectiveVolunteers(hubId)

    // If no one is on shift, use fallback group
    if (onShiftPubkeys.length === 0) {
      onShiftPubkeys = await services.settings.getFallbackGroup(hubId)
    }

    console.log(`[ringing] callSid=${callSid} onShift=${onShiftPubkeys.length}`)

    if (onShiftPubkeys.length === 0) {
      console.log('[ringing] no volunteers on shift or in fallback — skipping')
      return
    }

    // Get volunteer details (including call preference)
    const allVolunteers = await services.identity.getVolunteers()

    // All available on-shift volunteers (for WebSocket notification)
    const available = allVolunteers.filter(
      (v) => onShiftPubkeys.includes(v.pubkey) && v.active && !v.onBreak
    )

    // Only ring phones for volunteers with phone or both preference (and who have a phone number)
    const toRingPhone = available
      .filter((v) => {
        const pref = v.callPreference ?? 'phone'
        return (pref === 'phone' || pref === 'both') && v.phone
      })
      .map((v) => ({ pubkey: v.pubkey, phone: v.phone }))

    // Browser-only volunteers still get notified via WebSocket (handled by call service)
    const browserOnly = available.filter((v) => (v.callPreference ?? 'phone') === 'browser')

    if (available.length === 0) {
      console.log('[ringing] no available volunteers — skipping')
      return
    }

    console.log(
      `[ringing] callSid=${callSid} total=${available.length} phone=${toRingPhone.length} browser=${browserOnly.length}`
    )

    // Record incoming call in the call service (includes all available volunteers for WebSocket)
    await services.calls.createActiveCall({
      callSid,
      hubId: hubId ?? 'global',
      callerNumber,
      status: 'ringing',
    })

    // Publish call:ring event to Nostr relay for real-time client notification
    publishNostrEvent(env, KIND_CALL_RING, {
      type: 'call:ring',
      callSid,
      hubId: hubId ?? 'global',
    }, hubId)

    // Ring phone volunteers via telephony adapter (skip if no one needs phone ringing)
    if (toRingPhone.length > 0) {
      const adapter = await getTelephony(services.settings, hubId, {
        TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
      })
      if (!adapter) {
        console.warn('[ringing] no telephony adapter configured — phone volunteers cannot be rung')
        // Don't return — browser-only volunteers can still handle the call via WebSocket
      } else {
        await adapter.ringVolunteers({
          callSid,
          callerNumber,
          volunteers: toRingPhone,
          callbackUrl: origin,
          hubId,
        })
      }
    }
  } catch (err) {
    console.error('[ringing] startParallelRinging failed:', err)
  }
}
