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

    // Build unified volunteer list with phone and/or browser identity per volunteer
    const toRing = available
      .filter((v) => {
        const pref = v.callPreference ?? 'phone'
        return (
          ((pref === 'phone' || pref === 'both') && v.phone) ||
          pref === 'browser' ||
          pref === 'both'
        )
      })
      .map((v) => {
        const pref = v.callPreference ?? 'phone'
        return {
          pubkey: v.pubkey,
          phone: (pref === 'phone' || pref === 'both') && v.phone ? v.phone : undefined,
          browserIdentity:
            pref === 'browser' || pref === 'both' ? `vol_${v.pubkey.slice(0, 16)}` : undefined,
        }
      })

    // Count phone vs browser for logging
    const phoneCount = toRing.filter((v) => v.phone).length
    const browserCount = toRing.filter((v) => v.browserIdentity).length

    if (available.length === 0) {
      console.log('[ringing] no available volunteers — skipping')
      return
    }

    console.log(
      `[ringing] callSid=${callSid} total=${available.length} phone=${phoneCount} browser=${browserCount}`
    )

    // Record incoming call in the call service (includes all available volunteers for WebSocket)
    await services.calls.createActiveCall({
      callSid,
      hubId: hubId ?? 'global',
      callerNumber,
      status: 'ringing',
    })

    // Publish call:ring event to Nostr relay for real-time client notification
    publishNostrEvent(
      env,
      KIND_CALL_RING,
      {
        type: 'call:ring',
        callId: callSid,
        callSid,
        hubId: hubId ?? 'global',
        startedAt: new Date().toISOString(),
      },
      hubId
    )

    // Send Web Push notifications to all available volunteers (fire-and-forget)
    const availablePubkeys = available.map((v) => v.pubkey)
    services.push
      .sendPushToVolunteers(
        availablePubkeys,
        { type: 'call:ring', callSid, hubId: hubId ?? 'global' },
        env
      )
      .catch((err) => console.warn('[ringing] push notification failed:', err))

    // Create browser call legs for volunteers with browser identity
    for (const vol of toRing.filter((v) => v.browserIdentity)) {
      await services.calls.createCallLeg({
        legSid: `browser_${callSid}_${vol.pubkey.slice(0, 8)}`,
        callSid,
        hubId: hubId ?? 'global',
        volunteerPubkey: vol.pubkey,
        type: 'browser',
      })
    }

    // Ring volunteers via telephony adapter (handles both phone and browser legs)
    if (toRing.length > 0) {
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
          volunteers: toRing,
          callbackUrl: origin,
          hubId,
        })
      }
    }
  } catch (err) {
    console.error('[ringing] startParallelRinging failed:', err)
  }
}
