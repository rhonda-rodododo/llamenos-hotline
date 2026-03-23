import type { APIRequestContext } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8787'
const TEST_SECRET = process.env.E2E_TEST_SECRET ?? process.env.DEV_RESET_SECRET ?? ''

export interface SimulateCallParams {
  callSid?: string
  callerNumber?: string
  calledNumber?: string
  digits?: string
  status?: string
  parentCallSid?: string
  volunteerPubkey?: string
  recordingSid?: string
  hubId?: string
}

export interface SimulateMessageParams {
  messageSid?: string
  senderNumber?: string
  body?: string
  mediaUrl?: string
  mediaType?: string
  status?: string
  errorCode?: string
  hubId?: string
}

type TelephonyProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk'
type MessagingProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'meta'
type MessagingChannel = 'sms' | 'whatsapp' | 'signal' | 'rcs'

function headers() {
  return { 'X-Test-Secret': TEST_SECRET }
}

export async function simulateIncomingCall(
  request: APIRequestContext,
  provider: TelephonyProvider,
  params: SimulateCallParams = {}
): Promise<{ status: number; body: string }> {
  const res = await request.post(
    `${BASE_URL}/api/test-simulate/incoming-call?provider=${provider}`,
    { data: params, headers: headers() }
  )
  return { status: res.status(), body: await res.text() }
}

export async function simulateAnswerCall(
  request: APIRequestContext,
  provider: TelephonyProvider,
  params: SimulateCallParams = {}
): Promise<{ status: number; body: string }> {
  const res = await request.post(
    `${BASE_URL}/api/test-simulate/answer-call?provider=${provider}`,
    { data: params, headers: headers() }
  )
  return { status: res.status(), body: await res.text() }
}

export async function simulateEndCall(
  request: APIRequestContext,
  provider: TelephonyProvider,
  params: SimulateCallParams = {}
): Promise<{ status: number; body: string }> {
  const res = await request.post(
    `${BASE_URL}/api/test-simulate/end-call?provider=${provider}`,
    { data: params, headers: headers() }
  )
  return { status: res.status(), body: await res.text() }
}

export async function simulateVoicemail(
  request: APIRequestContext,
  provider: TelephonyProvider,
  params: SimulateCallParams = {}
): Promise<{ status: number; body: string }> {
  const res = await request.post(
    `${BASE_URL}/api/test-simulate/voicemail?provider=${provider}`,
    { data: params, headers: headers() }
  )
  return { status: res.status(), body: await res.text() }
}

export async function simulateIncomingMessage(
  request: APIRequestContext,
  provider: MessagingProvider,
  channel: MessagingChannel,
  params: SimulateMessageParams = {}
): Promise<{ status: number; body: string }> {
  const res = await request.post(
    `${BASE_URL}/api/test-simulate/incoming-message?provider=${provider}&channel=${channel}`,
    { data: params, headers: headers() }
  )
  return { status: res.status(), body: await res.text() }
}

export async function simulateDeliveryStatus(
  request: APIRequestContext,
  provider: MessagingProvider,
  channel: MessagingChannel,
  params: SimulateMessageParams = {}
): Promise<{ status: number; body: string }> {
  const res = await request.post(
    `${BASE_URL}/api/test-simulate/delivery-status?provider=${provider}&channel=${channel}`,
    { data: params, headers: headers() }
  )
  return { status: res.status(), body: await res.text() }
}
