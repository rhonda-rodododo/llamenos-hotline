import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { CryptoService } from '../../lib/crypto-service'
import { SignalWireSMSAdapter } from './signalwire'

const TEST_ACCOUNT_SID = 'SWtest00000000000000000000000000'
const TEST_AUTH_TOKEN = 'sw_auth_token_abc123'
const TEST_PHONE = '+15551234567'
const TEST_SPACE = 'myspace'

function makeCryptoService(): CryptoService {
  return {
    hmac: mock((input: string, label: string) => `hmac:${label}:${input}`),
  } as unknown as CryptoService
}

function makeFormRequest(
  fields: Record<string, string>,
  url = 'https://example.com/api/messaging/sms/webhook'
): Request {
  const body = new URLSearchParams(fields)
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

describe('SignalWireSMSAdapter', () => {
  let adapter: SignalWireSMSAdapter
  let cryptoService: CryptoService
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    cryptoService = makeCryptoService()
    adapter = new SignalWireSMSAdapter(
      TEST_ACCOUNT_SID,
      TEST_AUTH_TOKEN,
      TEST_PHONE,
      TEST_SPACE,
      cryptoService
    )
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    process.env.BASE_URL = undefined as unknown as string
  })

  // ─── API URL ──────────────────────────────────────────────────

  describe('API URL', () => {
    it('uses SignalWire-specific space URL instead of api.twilio.com', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SW_SENT_001' }), { status: 200 })
      )

      await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toContain(`${TEST_SPACE}.signalwire.com`)
      expect(url).toBe(
        `https://${TEST_SPACE}.signalwire.com/api/laml/2010-04-01/Accounts/${TEST_ACCOUNT_SID}/Messages.json`
      )
      expect(url).not.toContain('api.twilio.com')
    })
  })

  // ─── parseIncomingMessage (inherited from Twilio) ─────────────

  describe('parseIncomingMessage', () => {
    it('parses form-encoded webhooks same as Twilio', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Body: 'Hello from SignalWire',
        MessageSid: 'SW-MSG-001',
        NumMedia: '0',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('sms')
      expect(msg.externalId).toBe('SW-MSG-001')
      expect(msg.senderIdentifier).toBe('+14155551234')
      expect(msg.body).toBe('Hello from SignalWire')
      expect(msg.metadata).toEqual({ to: '+15551234567' })
    })

    it('hashes sender identifier via CryptoService.hmac with HMAC_PHONE_PREFIX', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Body: 'test',
        MessageSid: 'SW-MSG-002',
        NumMedia: '0',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:+14155551234`)
      expect(cryptoService.hmac).toHaveBeenCalledWith('+14155551234', HMAC_PHONE_PREFIX)
    })

    it('parses media attachments', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Body: 'See attached',
        MessageSid: 'SW-MSG-003',
        NumMedia: '1',
        MediaUrl0: 'https://signalwire.com/media/img0.jpg',
        MediaContentType0: 'image/jpeg',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.mediaUrls).toEqual(['https://signalwire.com/media/img0.jpg'])
      expect(msg.mediaTypes).toEqual(['image/jpeg'])
    })
  })

  // ─── sendMessage ──────────────────────────────────────────────

  describe('sendMessage', () => {
    it('sends POST to SignalWire Messages API with correct params', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SW_SENT_001' }), { status: 200 })
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'Your call has been received',
      })

      expect(result).toEqual({ success: true, externalId: 'SW_SENT_001' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        `https://${TEST_SPACE}.signalwire.com/api/laml/2010-04-01/Accounts/${TEST_ACCOUNT_SID}/Messages.json`
      )
      expect(opts.method).toBe('POST')

      // Verify Basic auth header
      const expectedAuth = `Basic ${btoa(`${TEST_ACCOUNT_SID}:${TEST_AUTH_TOKEN}`)}`
      expect((opts.headers as Record<string, string>).Authorization).toBe(expectedAuth)

      // Verify form body params
      const sentBody = new URLSearchParams(opts.body as string)
      expect(sentBody.get('To')).toBe('+14155559999')
      expect(sentBody.get('From')).toBe(TEST_PHONE)
      expect(sentBody.get('Body')).toBe('Your call has been received')
    })

    it('returns error on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid phone number' }), { status: 400 })
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: 'bad-number',
        body: 'test',
      })

      expect(result.success).toBe(false)
    })
  })

  // ─── validateWebhook ──────────────────────────────────────────

  describe('validateWebhook', () => {
    it('returns false when neither X-SignalWire-Signature nor X-Twilio-Signature is present', async () => {
      const request = makeFormRequest({ Body: 'test', From: '+14155551234' })
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('accepts X-SignalWire-Signature header', async () => {
      const url = 'https://example.com/api/messaging/sms/webhook'
      const fields: Record<string, string> = { Body: 'Hello', From: '+14155551234' }
      const params = new URLSearchParams(fields)

      // Build data string: full URL + sorted form key-value pairs
      let dataString = url
      const sortedKeys = Array.from(params.keys()).sort()
      for (const key of sortedKeys) {
        dataString += key + params.get(key)
      }

      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(TEST_AUTH_TOKEN),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(dataString))
      const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))

      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-SignalWire-Signature': signature,
        },
        body: params.toString(),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(true)
    })

    it('accepts X-Twilio-Signature header as fallback', async () => {
      const url = 'https://example.com/api/messaging/sms/webhook'
      const fields: Record<string, string> = { Body: 'Hello', From: '+14155551234' }
      const params = new URLSearchParams(fields)

      let dataString = url
      const sortedKeys = Array.from(params.keys()).sort()
      for (const key of sortedKeys) {
        dataString += key + params.get(key)
      }

      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(TEST_AUTH_TOKEN),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(dataString))
      const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))

      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': signature,
        },
        body: params.toString(),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(true)
    })

    it('rejects an incorrectly signed webhook', async () => {
      const request = new Request('https://example.com/api/messaging/sms/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-SignalWire-Signature': 'invalid_signature_base64==',
        },
        body: new URLSearchParams({ Body: 'test', From: '+14155551234' }).toString(),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })
  })

  // ─── getChannelStatus ─────────────────────────────────────────

  describe('getChannelStatus', () => {
    it('returns connected status with SignalWire-specific details', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'active', friendly_name: 'Crisis Hotline' }), {
          status: 200,
        })
      )

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details).toEqual({
        provider: 'signalwire',
        channel: 'sms',
        space: TEST_SPACE,
        accountStatus: 'active',
        accountName: 'Crisis Hotline',
        phoneNumber: TEST_PHONE,
      })

      // Verify GET to SignalWire account endpoint
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        `https://${TEST_SPACE}.signalwire.com/api/laml/2010-04-01/Accounts/${TEST_ACCOUNT_SID}.json`
      )
    })

    it('returns disconnected on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('SignalWire API returned 401')
    })

    it('returns disconnected on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network unreachable'))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Network unreachable')
    })

    it('returns generic error for non-Error throws', async () => {
      fetchSpy.mockRejectedValueOnce('some string error')

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Unknown error connecting to SignalWire')
    })
  })

  // ─── deleteMessage (inherited from Twilio) ────────────────────

  describe('deleteMessage', () => {
    it('sends DELETE to SignalWire message endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))

      await adapter.deleteMessage('SW_DEL_001')

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        `https://${TEST_SPACE}.signalwire.com/api/laml/2010-04-01/Accounts/${TEST_ACCOUNT_SID}/Messages/SW_DEL_001.json`
      )
      expect(opts.method).toBe('DELETE')
    })
  })
})
