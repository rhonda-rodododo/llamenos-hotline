import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { CryptoService } from '../../lib/crypto-service'
import { PlivoSMSAdapter } from './plivo'

const TEST_AUTH_ID = 'PLIVO_AUTH_ID_TEST'
const TEST_AUTH_TOKEN = 'plivo_auth_token_abc123'
const TEST_PHONE = '+15551234567'

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

describe('PlivoSMSAdapter', () => {
  let adapter: PlivoSMSAdapter
  let cryptoService: CryptoService
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    cryptoService = makeCryptoService()
    adapter = new PlivoSMSAdapter(TEST_AUTH_ID, TEST_AUTH_TOKEN, TEST_PHONE, cryptoService)
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // ─── parseIncomingMessage ─────────────────────────────────────

  describe('parseIncomingMessage', () => {
    it('parses standard Plivo SMS webhook fields', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Text: 'Hello, I need help',
        MessageUUID: 'PLIVO-UUID-001',
        Type: 'sms',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('sms')
      expect(msg.externalId).toBe('PLIVO-UUID-001')
      expect(msg.senderIdentifier).toBe('+14155551234')
      expect(msg.body).toBe('Hello, I need help')
      expect(msg.mediaUrls).toBeUndefined()
      expect(msg.metadata).toEqual({ to: '+15551234567', type: 'sms' })
      expect(msg.timestamp).toBeTruthy()
    })

    it('hashes sender identifier via CryptoService.hmac with HMAC_PHONE_PREFIX', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Text: 'test',
        MessageUUID: 'PLIVO-UUID-002',
        Type: 'sms',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:+14155551234`)
      expect(cryptoService.hmac).toHaveBeenCalledWith('+14155551234', HMAC_PHONE_PREFIX)
    })

    it('parses media attachments from Media0, Media1, etc.', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Text: 'See attached',
        MessageUUID: 'PLIVO-UUID-003',
        Type: 'mms',
        Media0: 'https://plivo.com/media/img0.jpg',
        Media1: 'https://plivo.com/media/doc1.pdf',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.mediaUrls).toEqual([
        'https://plivo.com/media/img0.jpg',
        'https://plivo.com/media/doc1.pdf',
      ])
    })

    it('handles missing Text field gracefully (returns undefined)', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        MessageUUID: 'PLIVO-UUID-004',
        Type: 'sms',
      })

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.body).toBeUndefined()
    })

    it('handles missing fields with empty string defaults', async () => {
      const request = makeFormRequest({})

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifier).toBe('')
      expect(msg.externalId).toBe('')
      expect(msg.metadata).toEqual({ to: '', type: 'sms' })
    })

    it('defaults Type to sms when missing', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Text: 'test',
        MessageUUID: 'PLIVO-UUID-005',
      })

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.metadata).toEqual({ to: '+15551234567', type: 'sms' })
    })
  })

  // ─── sendMessage ──────────────────────────────────────────────

  describe('sendMessage', () => {
    it('sends POST to Plivo Messages API with correct params', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message_uuid: ['PLIVO-SENT-001'], api_id: 'api-001' }), {
          status: 200,
        })
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'Your call has been received',
      })

      expect(result).toEqual({ success: true, externalId: 'PLIVO-SENT-001' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://api.plivo.com/v1/Account/${TEST_AUTH_ID}/Message/`)
      expect(opts.method).toBe('POST')

      // Verify Basic auth header
      const expectedAuth = `Basic ${btoa(`${TEST_AUTH_ID}:${TEST_AUTH_TOKEN}`)}`
      expect((opts.headers as Record<string, string>).Authorization).toBe(expectedAuth)

      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.dst).toBe('+14155559999')
      expect(sentBody.src).toBe(TEST_PHONE)
      expect(sentBody.text).toBe('Your call has been received')
    })

    it('returns error on non-OK response with Plivo error message', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Invalid destination number' }), { status: 400 })
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: 'bad-number',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid destination number')
    })

    it('returns generic error when Plivo response body is not JSON', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Plivo SMS API returned 500')
    })

    it('returns error on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection refused')
    })
  })

  // ─── sendMediaMessage ─────────────────────────────────────────

  describe('sendMediaMessage', () => {
    it('includes media_urls and type mms in the request body', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message_uuid: ['PLIVO-MMS-001'] }), { status: 200 })
      )

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'Here is an image',
        mediaUrl: 'https://storage.example.com/photo.jpg',
        mediaType: 'image/jpeg',
      })

      expect(result).toEqual({ success: true, externalId: 'PLIVO-MMS-001' })

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.media_urls).toEqual(['https://storage.example.com/photo.jpg'])
      expect(sentBody.type).toBe('mms')
      expect(sentBody.text).toBe('Here is an image')
    })
  })

  // ─── validateWebhook ──────────────────────────────────────────

  describe('validateWebhook', () => {
    it('returns false when X-Plivo-Signature-V3 header is missing', async () => {
      const request = makeFormRequest({ Text: 'test', From: '+14155551234' })
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('returns false when X-Plivo-Signature-V3-Nonce header is missing', async () => {
      const request = new Request('https://example.com/api/messaging/sms/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Plivo-Signature-V3': 'some-sig',
        },
        body: new URLSearchParams({ Text: 'test' }).toString(),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('validates a correctly signed webhook', async () => {
      const webhookUrl = 'https://example.com/api/messaging/sms/webhook'
      const fields: Record<string, string> = { From: '+14155551234', Text: 'Hello' }
      const nonce = 'test-nonce-12345'
      const params = new URLSearchParams(fields)

      // Build validation string: URL (origin + pathname) + sorted params + nonce
      const url = new URL(webhookUrl)
      let dataString = url.origin + url.pathname
      const sortedKeys = Array.from(params.keys()).sort()
      for (const key of sortedKeys) {
        dataString += key + params.get(key)
      }
      dataString += `.${nonce}`

      // Compute HMAC-SHA256 base64 signature
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(TEST_AUTH_TOKEN),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(dataString))
      const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))

      const request = new Request(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Plivo-Signature-V3': signature,
          'X-Plivo-Signature-V3-Nonce': nonce,
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
          'X-Plivo-Signature-V3': 'aW52YWxpZF9zaWduYXR1cmU=',
          'X-Plivo-Signature-V3-Nonce': 'nonce-123',
        },
        body: new URLSearchParams({ Text: 'test', From: '+14155551234' }).toString(),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })
  })

  // ─── getChannelStatus ─────────────────────────────────────────

  describe('getChannelStatus', () => {
    it('returns connected status with account details on success', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ cash_credits: '150.00', account_type: 'standard' }), {
          status: 200,
        })
      )

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details).toEqual({
        provider: 'plivo',
        channel: 'sms',
        credits: '150.00',
        accountType: 'standard',
        phoneNumber: TEST_PHONE,
      })

      // Verify GET to account endpoint
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://api.plivo.com/v1/Account/${TEST_AUTH_ID}/`)
      expect(opts.method).toBe('GET')
    })

    it('returns disconnected on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Plivo API returned 401')
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
      expect(status.error).toBe('Unknown error connecting to Plivo')
    })
  })
})
