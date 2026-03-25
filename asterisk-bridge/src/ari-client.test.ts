import { describe, expect, mock, test } from 'bun:test'

describe('AriClient.deleteDynamic', () => {
  test('sends DELETE to correct ARI path', async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ''
    let capturedMethod = ''
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === 'string' ? url : url.toString()
      capturedMethod = init?.method ?? 'GET'
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const { AriClient } = await import('./ari-client')
    const client = new AriClient({
      ariUrl: 'ws://localhost:8088/ari/events',
      ariRestUrl: 'http://localhost:8088/ari',
      ariUsername: 'test',
      ariPassword: 'test',
      workerWebhookUrl: 'http://localhost:3000',
      bridgeSecret: 'secret',
      bridgePort: 3000,
      bridgeBind: '127.0.0.1',
      stasisApp: 'llamenos',
    })

    await client.deleteDynamic('res_pjsip', 'endpoint', 'vol_abc123def456')
    expect(capturedUrl).toBe(
      'http://localhost:8088/ari/asterisk/config/dynamic/res_pjsip/endpoint/vol_abc123def456'
    )
    expect(capturedMethod).toBe('DELETE')

    globalThis.fetch = originalFetch
  })
})
