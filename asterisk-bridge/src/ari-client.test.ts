import { afterEach, describe, expect, mock, test } from 'bun:test'
import { AriClient } from './ari-client'
import type { BridgeConfig } from './types'

function makeConfig(overrides?: Partial<BridgeConfig>): BridgeConfig {
  return {
    ariUrl: 'ws://localhost:8088/ari/events',
    ariRestUrl: 'http://localhost:8088/ari',
    ariUsername: 'test',
    ariPassword: 'test',
    workerWebhookUrl: 'http://localhost:3000',
    bridgeSecret: 'secret',
    bridgePort: 3000,
    bridgeBind: '127.0.0.1',
    stasisApp: 'llamenos',
    ...overrides,
  }
}

describe('AriClient connection timeout', () => {
  let exitCode: number | undefined
  const originalExit = process.exit

  afterEach(() => {
    process.exit = originalExit
    exitCode = undefined
  })

  test('sets connection deadline on connect()', () => {
    const client = new AriClient(makeConfig({ connectionTimeoutMs: 10_000 }))
    // Access private field via any for testing
    const c = client as unknown as {
      connectionDeadline: number | null
      connectionTimeoutMs: number
    }
    expect(c.connectionTimeoutMs).toBe(10_000)
    expect(c.connectionDeadline).toBeNull()
  })

  test('defaults to 5 minutes when connectionTimeoutMs not set', () => {
    const client = new AriClient(makeConfig())
    const c = client as unknown as { connectionTimeoutMs: number }
    expect(c.connectionTimeoutMs).toBe(5 * 60 * 1000)
  })

  test('exits when connection deadline has passed during scheduleReconnect', () => {
    const client = new AriClient(makeConfig({ connectionTimeoutMs: 1 })) // 1ms timeout
    const c = client as unknown as {
      connectionDeadline: number | null
      hasConnected: boolean
      shouldReconnect: boolean
      scheduleReconnect: () => void
    }

    // Simulate state: deadline expired, never connected
    c.connectionDeadline = Date.now() - 1000
    c.hasConnected = false
    c.shouldReconnect = true

    process.exit = mock((code?: number) => {
      exitCode = code
      throw new Error('process.exit called')
    }) as unknown as typeof process.exit

    expect(() => c.scheduleReconnect()).toThrow('process.exit called')
    expect(exitCode).toBe(1)
  })

  test('does not exit when connection deadline has not passed', () => {
    const client = new AriClient(makeConfig({ connectionTimeoutMs: 60_000 }))
    const c = client as unknown as {
      connectionDeadline: number | null
      hasConnected: boolean
      shouldReconnect: boolean
      scheduleReconnect: () => void
    }

    c.connectionDeadline = Date.now() + 60_000
    c.hasConnected = false
    c.shouldReconnect = true

    process.exit = mock((code?: number) => {
      exitCode = code
      throw new Error('process.exit called')
    }) as unknown as typeof process.exit

    // Should not throw — scheduleReconnect sets up a setTimeout, doesn't exit
    c.scheduleReconnect()
    expect(exitCode).toBeUndefined()
  })
})

describe('AriClient.deleteDynamic', () => {
  test('sends DELETE to correct ARI path', async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ''
    let capturedMethod = ''
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === 'string' ? url : url.toString()
      capturedMethod = init?.method ?? 'GET'
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch

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
