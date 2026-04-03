import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { VonageAdapter } from './vonage'

// --- Helpers ---

// Generate a real RSA private key for JWT signing in tests
let testPrivateKey: string

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  )
  const exported = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)))
  const lines = b64.match(/.{1,64}/g) ?? []
  testPrivateKey = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
})

const originalFetch = globalThis.fetch

function mockFetchWith(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = mock(handler as typeof fetch) as unknown as typeof fetch
}

function createAdapter(privateKey?: string) {
  return new VonageAdapter('api-key', 'api-secret', 'app-123', '+15551234567', privateKey)
}

describe('VonageAdapter.verifyWebhookConfig', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns warning when no private key is configured', async () => {
    const adapter = createAdapter()
    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')

    expect(result.configured).toBe(false)
    expect(result.expectedUrl).toBe('https://example.com/telephony/incoming')
    expect(result.warning).toContain('private key not configured')
  })

  test('returns configured=true when answer_url matches expected base URL', async () => {
    mockFetchWith((url) => {
      if (url.includes('/v2/applications/')) {
        return new Response(
          JSON.stringify({
            capabilities: {
              voice: {
                webhooks: {
                  answer_url: {
                    address: 'https://example.com/telephony/incoming',
                    http_method: 'POST',
                  },
                  event_url: {
                    address: 'https://example.com/telephony/status',
                    http_method: 'POST',
                  },
                },
              },
            },
          }),
          { status: 200 }
        )
      }
      return new Response('', { status: 404 })
    })

    const adapter = createAdapter(testPrivateKey)
    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')

    expect(result.configured).toBe(true)
    expect(result.expectedUrl).toBe('https://example.com/telephony/incoming')
    expect(result.actualUrl).toBe('https://example.com/telephony/incoming')
    expect(result.warning).toBeUndefined()
  })

  test('returns configured=false when answer_url does not match', async () => {
    mockFetchWith((url) => {
      if (url.includes('/v2/applications/')) {
        return new Response(
          JSON.stringify({
            capabilities: {
              voice: {
                webhooks: {
                  answer_url: {
                    address: 'https://other-domain.com/webhook',
                    http_method: 'POST',
                  },
                  event_url: {
                    address: 'https://other-domain.com/events',
                    http_method: 'POST',
                  },
                },
              },
            },
          }),
          { status: 200 }
        )
      }
      return new Response('', { status: 404 })
    })

    const adapter = createAdapter(testPrivateKey)
    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')

    expect(result.configured).toBe(false)
    expect(result.expectedUrl).toBe('https://example.com/telephony/incoming')
    expect(result.actualUrl).toBe('https://other-domain.com/webhook')
    expect(result.warning).toContain('does not point to this application')
  })

  test('handles Vonage API error response gracefully', async () => {
    mockFetchWith((url) => {
      if (url.includes('/v2/applications/')) {
        return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
      }
      return new Response('', { status: 404 })
    })

    const adapter = createAdapter(testPrivateKey)
    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')

    expect(result.configured).toBe(false)
    expect(result.expectedUrl).toBe('https://example.com/telephony/incoming')
    expect(result.warning).toContain('401')
  })

  test('handles network errors gracefully', async () => {
    mockFetchWith(() => {
      throw new Error('Network connection refused')
    })

    const adapter = createAdapter(testPrivateKey)
    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')

    expect(result.configured).toBe(false)
    expect(result.expectedUrl).toBe('https://example.com/telephony/incoming')
    expect(result.warning).toContain('Network connection refused')
  })

  test('calls correct Vonage Application API URL with Bearer auth', async () => {
    let capturedUrl = ''
    let capturedAuthHeader = ''

    mockFetchWith((url, init) => {
      capturedUrl = url as string
      capturedAuthHeader = (init?.headers as Record<string, string>)?.Authorization ?? ''
      return new Response(
        JSON.stringify({
          capabilities: {
            voice: {
              webhooks: {
                answer_url: { address: 'https://example.com/telephony/incoming' },
              },
            },
          },
        }),
        { status: 200 }
      )
    })

    const adapter = createAdapter(testPrivateKey)
    await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')

    expect(capturedUrl).toBe('https://api.nexmo.com/v2/applications/app-123')
    expect(capturedAuthHeader).toStartWith('Bearer ')
  })

  test('handles missing voice capabilities in response', async () => {
    mockFetchWith((url) => {
      if (url.includes('/v2/applications/')) {
        return new Response(JSON.stringify({ capabilities: {} }), { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const adapter = createAdapter(testPrivateKey)
    const result = await adapter.verifyWebhookConfig('+15551234567', 'https://example.com')

    expect(result.configured).toBe(false)
    expect(result.actualUrl).toBeUndefined()
    expect(result.warning).toContain('does not point to this application')
  })
})
