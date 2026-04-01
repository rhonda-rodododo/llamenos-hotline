import type { APIRequestContext, Page } from '@playwright/test'

export interface MockCallOptions {
  callSid: string
  /** Caller phone number (e.g. "+15555550001") */
  from: string
  /** Hotline phone number */
  to: string
  /** Telephony provider format to mimic (default: 'twilio') */
  provider?: 'twilio' | 'vonage' | 'plivo' | 'asterisk'
}

/**
 * Build a Twilio-style application/x-www-form-urlencoded body string.
 */
function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

/**
 * Simulate an inbound call by posting a webhook payload to the telephony route.
 * Signature validation is skipped in development/test mode (localhost).
 *
 * Returns the HTTP status code. Callers should skip the test if 404 is returned
 * (telephony not configured in dev env).
 */
export async function simulateInboundCall(
  request: APIRequestContext,
  options: MockCallOptions
): Promise<Response & { status(): number; ok(): boolean }> {
  const { callSid, from, to, provider = 'twilio' } = options

  let payload: Record<string, string>
  if (provider === 'twilio') {
    payload = {
      CallSid: callSid,
      From: from,
      To: to,
      CallStatus: 'ringing',
      Direction: 'inbound',
    }
  } else if (provider === 'vonage') {
    payload = {
      uuid: callSid,
      from,
      to,
      status: 'ringing',
      direction: 'inbound',
    }
  } else if (provider === 'plivo') {
    payload = {
      CallUUID: callSid,
      From: from,
      To: to,
      CallStatus: 'ringing',
      Direction: 'inbound',
    }
  } else {
    // asterisk — ARI format
    payload = {
      type: 'StasisStart',
      channel: JSON.stringify({ id: callSid, caller: { number: from }, dialplan: { exten: to } }),
    }
  }

  // Telephony routes are at /telephony/* (top-level, not /api/telephony/*)
  return request.post('/telephony/incoming', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: formEncode(payload),
  }) as unknown as Response & { status(): number; ok(): boolean }
}

/**
 * Simulate a user answering a call.
 * Posts an answer webhook indicating the call is now in-progress.
 */
export async function simulateCallAnswered(
  request: APIRequestContext,
  callSid: string,
  answeredByPhone?: string
): Promise<void> {
  const res = await request.post('/telephony/user-answer', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: formEncode({
      CallSid: callSid,
      ...(answeredByPhone ? { To: answeredByPhone } : {}),
      CallStatus: 'in-progress',
    }),
  })
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(`simulateCallAnswered failed: ${res.status()} ${body}`)
  }
}

/**
 * Simulate a call ending (hangup by either party).
 */
export async function simulateCallHungUp(
  request: APIRequestContext,
  callSid: string
): Promise<void> {
  const res = await request.post('/telephony/call-status', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: formEncode({
      CallSid: callSid,
      CallStatus: 'completed',
      CallDuration: '0',
    }),
  })
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(`simulateCallHungUp failed: ${res.status()} ${body}`)
  }
}

/**
 * Simulate a voicemail recording being available after a missed call.
 */
export async function simulateVoicemail(
  request: APIRequestContext,
  callSid: string,
  recordingUrl: string
): Promise<void> {
  const res = await request.post(`/telephony/voicemail-recording?callSid=${callSid}`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: formEncode({
      CallSid: callSid,
      RecordingUrl: recordingUrl,
      RecordingSid: `RE${callSid.replace(/\D/g, '')}`,
      RecordingDuration: '30',
      CallStatus: 'completed',
    }),
  })
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(`simulateVoicemail failed: ${res.status()} ${body}`)
  }
}

/**
 * Wait until a call with the given SID appears in the active calls list with
 * the specified status. Polls GET /api/calls/active via the browser page context.
 */
export async function waitForCallState(
  page: Page,
  callSid: string,
  state: 'ringing' | 'active' | 'completed',
  timeoutMs = 10_000
): Promise<void> {
  await page.waitForFunction(
    ({ sid, expectedState }) => {
      const fetch = (window as any).__authedFetch ?? window.fetch
      return fetch('/api/calls/active')
        .then((r: Response) => r.json())
        .then((data: { calls?: Array<{ id: string; status: string }> }) => {
          const call = data.calls?.find((c) => c.id === sid)
          return call?.status === expectedState
        })
        .catch(() => false)
    },
    { sid: callSid, expectedState: state },
    { timeout: timeoutMs, polling: 1000 }
  )
}
