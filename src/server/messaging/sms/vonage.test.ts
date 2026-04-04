import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { CryptoService } from '../../lib/crypto-service'
import { VonageSMSAdapter } from './vonage'

const TEST_API_KEY = 'vonage_key_abc'
const TEST_API_SECRET = 'vonage_secret_xyz'
const TEST_PHONE = '+15551234567'

function makeCryptoService(): CryptoService {
  return {
    hmac: mock((input: string, label: string) => `hmac:${label}:${input}`),
  } as unknown as CryptoService
}

function makeJsonRequest(body: Record<string, unknown>, url?: string): Request {
  return new Request(url ?? 'https://example.com/api/messaging/sms/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('VonageSMSAdapter', () => {
  let adapter: VonageSMSAdapter
  let cryptoService: CryptoService
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    cryptoService = makeCryptoService()
    adapter = new VonageSMSAdapter(TEST_API_KEY, TEST_API_SECRET, TEST_PHONE, cryptoService)
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // ─── parseIncomingMessage ─────────────────────────────────────

  describe('parseIncomingMessage', () => {
    it('parses standard Vonage inbound SMS JSON webhook', async () => {
      const request = makeJsonRequest({
        msisdn: '14155551234',
        to: '15551234567',
        text: 'Hello, I need help',
        messageId: 'MSG-001',
        type: 'text',
        'message-timestamp': '2026-01-15T10:30:00Z',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('sms')
      expect(msg.externalId).toBe('MSG-001')
      expect(msg.senderIdentifier).toBe('+14155551234')
      expect(msg.body).toBe('Hello, I need help')
      expect(msg.timestamp).toBe('2026-01-15T10:30:00Z')
      expect(msg.metadata).toEqual({ to: '15551234567', type: 'text' })
    })

    it('normalizes msisdn by prepending + if missing', async () => {
      const request = makeJsonRequest({
        msisdn: '14155551234',
        to: '15551234567',
        text: 'test',
        messageId: 'MSG-002',
        type: 'text',
      })

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.senderIdentifier).toBe('+14155551234')
    })

    it('does not double-prepend + if msisdn already has it', async () => {
      const request = makeJsonRequest({
        msisdn: '+14155551234',
        to: '15551234567',
        text: 'test',
        messageId: 'MSG-003',
        type: 'text',
      })

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.senderIdentifier).toBe('+14155551234')
    })

    it('hashes sender identifier via CryptoService.hmac with HMAC_PHONE_PREFIX', async () => {
      const request = makeJsonRequest({
        msisdn: '14155551234',
        to: '15551234567',
        text: 'test',
        messageId: 'MSG-004',
        type: 'text',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:+14155551234`)
      expect(cryptoService.hmac).toHaveBeenCalledWith('+14155551234', HMAC_PHONE_PREFIX)
    })

    it('returns undefined body when text is empty', async () => {
      const request = makeJsonRequest({
        msisdn: '14155551234',
        to: '15551234567',
        text: '',
        messageId: 'MSG-005',
        type: 'text',
      })

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.body).toBeUndefined()
    })

    it('falls back to timestamp field when message-timestamp is missing', async () => {
      const request = makeJsonRequest({
        msisdn: '14155551234',
        to: '15551234567',
        text: 'test',
        messageId: 'MSG-006',
        type: 'text',
        timestamp: '2026-01-15T12:00:00Z',
      })

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.timestamp).toBe('2026-01-15T12:00:00Z')
    })

    it('falls back to current time when both timestamps are missing', async () => {
      const before = new Date().toISOString()
      const request = makeJsonRequest({
        msisdn: '14155551234',
        to: '15551234567',
        text: 'test',
        messageId: 'MSG-007',
        type: 'text',
      })

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.timestamp).toBeTruthy()
      expect(new Date(msg.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime() - 1000
      )
    })
  })

  // ─── sendMessage ──────────────────────────────────────────────

  describe('sendMessage', () => {
    it('sends POST to rest.nexmo.com with correct params and strips + from numbers', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ status: '0', 'message-id': 'VONAGE-001' }],
          }),
          { status: 200 }
        )
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'Your call has been received',
      })

      expect(result).toEqual({ success: true, externalId: 'VONAGE-001' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://rest.nexmo.com/sms/json')
      expect(opts.method).toBe('POST')

      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.api_key).toBe(TEST_API_KEY)
      expect(sentBody.api_secret).toBe(TEST_API_SECRET)
      expect(sentBody.to).toBe('14155559999')
      expect(sentBody.from).toBe('15551234567')
      expect(sentBody.text).toBe('Your call has been received')
    })

    it('returns error when Vonage message status is non-zero', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ status: '4', 'error-text': 'Invalid credentials' }],
          }),
          { status: 200 }
        )
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid credentials')
    })

    it('returns error on non-OK HTTP response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Server Error', { status: 500 }))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Vonage SMS API returned 500')
    })

    it('returns error on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('DNS resolution failed'))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('DNS resolution failed')
    })
  })

  // ─── sendMediaMessage ─────────────────────────────────────────

  describe('sendMediaMessage', () => {
    it('sends to Messages API with Basic auth and image payload', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message_uuid: 'VONAGE-MEDIA-001' }), { status: 200 })
      )

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'See this image',
        mediaUrl: 'https://storage.example.com/photo.jpg',
        mediaType: 'image/jpeg',
      })

      expect(result).toEqual({ success: true, externalId: 'VONAGE-MEDIA-001' })

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.nexmo.com/v1/messages')

      const expectedAuth = `Basic ${btoa(`${TEST_API_KEY}:${TEST_API_SECRET}`)}`
      expect((opts.headers as Record<string, string>).Authorization).toBe(expectedAuth)

      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.channel).toBe('sms')
      expect(sentBody.message_type).toBe('image')
      expect(sentBody.image.url).toBe('https://storage.example.com/photo.jpg')
      expect(sentBody.image.caption).toBe('See this image')
    })
  })

  // ─── validateWebhook ──────────────────────────────────────────

  describe('validateWebhook', () => {
    it('returns false when X-Vonage-Signature header is missing', async () => {
      const request = makeJsonRequest({ text: 'test', msisdn: '14155551234' })
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('validates a correctly signed webhook', async () => {
      const bodyContent = JSON.stringify({ text: 'Hello', msisdn: '14155551234' })

      // Compute HMAC-SHA256 hex signature the same way the adapter does
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(TEST_API_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyContent))
      const hexSignature = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const request = new Request('https://example.com/api/messaging/sms/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vonage-Signature': hexSignature,
        },
        body: bodyContent,
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(true)
    })

    it('rejects an incorrectly signed webhook', async () => {
      const request = new Request('https://example.com/api/messaging/sms/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vonage-Signature': 'deadbeef00112233',
        },
        body: JSON.stringify({ text: 'test' }),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('rejects when signature has wrong length', async () => {
      const request = new Request('https://example.com/api/messaging/sms/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vonage-Signature': 'short',
        },
        body: JSON.stringify({ text: 'test' }),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })
  })

  // ─── getChannelStatus ─────────────────────────────────────────

  describe('getChannelStatus', () => {
    it('returns connected status with balance details on success', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 42.5, autoReload: true }), { status: 200 })
      )

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details).toEqual({
        provider: 'vonage',
        channel: 'sms',
        balance: 42.5,
        autoReload: true,
        phoneNumber: TEST_PHONE,
      })

      // Verify GET to balance endpoint with credentials in query
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('rest.nexmo.com/account/get-balance')
      expect(url).toContain(`api_key=${TEST_API_KEY}`)
      expect(url).toContain(`api_secret=${TEST_API_SECRET}`)
    })

    it('returns disconnected on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Vonage API returned 401')
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
      expect(status.error).toBe('Unknown error connecting to Vonage')
    })
  })
})
