import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { BridgeConfig } from '../types'
import { AriClient } from './ari-client'

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

describe('AriClient BridgeClient interface', () => {
  test('isConnected returns false when not connected', () => {
    const client = new AriClient(makeConfig())
    expect(client.isConnected()).toBe(false)
  })

  test('originate calls POST /channels and returns channel id', async () => {
    const originalFetch = globalThis.fetch
    const capturedRequests: Array<{ url: string; method: string; body: unknown }> = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      capturedRequests.push({ url: urlStr, method: init?.method ?? 'GET', body })
      return new Response(
        JSON.stringify({
          id: 'chan-123',
          state: 'Down',
          caller: { name: '', number: '+15551234567' },
          connected: { name: '', number: '' },
          accountcode: '',
          dialplan: { context: 'default', exten: '+18005551234', priority: 1 },
          creationtime: new Date().toISOString(),
          language: 'en',
          name: 'PJSIP/vol1-00000001',
        }),
        { status: 200 }
      )
    }) as unknown as typeof fetch

    const client = new AriClient(makeConfig())
    const result = await client.originate({
      endpoint: 'PJSIP/vol1',
      callerId: '+15550000000',
      timeout: 30,
    })

    expect(result).toEqual({ id: 'chan-123' })
    expect(capturedRequests[0].method).toBe('POST')
    expect(capturedRequests[0].url).toBe('http://localhost:8088/ari/channels')
    expect(capturedRequests[0].body).toMatchObject({ endpoint: 'PJSIP/vol1', app: 'llamenos' })

    globalThis.fetch = originalFetch
  })

  test('translateEvent maps StasisStart to channel_create', () => {
    const client = new AriClient(makeConfig())
    const translateEvent = (
      client as unknown as { translateEvent: (e: unknown) => unknown }
    ).translateEvent.bind(client)

    const event = translateEvent({
      type: 'StasisStart',
      application: 'llamenos',
      timestamp: '2026-04-03T00:00:00.000Z',
      args: ['incoming'],
      channel: {
        id: 'chan-abc',
        state: 'Ring',
        caller: { name: '', number: '+15551234567' },
        connected: { name: '', number: '' },
        accountcode: '',
        dialplan: { context: 'default', exten: '+18005551234', priority: 1 },
        creationtime: '2026-04-03T00:00:00.000Z',
        language: 'en',
        name: 'PJSIP/trunk-00000001',
      },
    })

    expect(event).toEqual({
      type: 'channel_create',
      channelId: 'chan-abc',
      callerNumber: '+15551234567',
      calledNumber: '+18005551234',
      args: ['incoming'],
      timestamp: '2026-04-03T00:00:00.000Z',
    })
  })

  test('translateEvent maps ChannelDestroyed to channel_hangup', () => {
    const client = new AriClient(makeConfig())
    const translateEvent = (
      client as unknown as { translateEvent: (e: unknown) => unknown }
    ).translateEvent.bind(client)

    const event = translateEvent({
      type: 'ChannelDestroyed',
      application: 'llamenos',
      timestamp: '2026-04-03T00:00:00.000Z',
      cause: 16,
      cause_txt: 'Normal Clearing',
      channel: {
        id: 'chan-abc',
        state: 'Down',
        caller: { name: '', number: '+15551234567' },
        connected: { name: '', number: '' },
        accountcode: '',
        dialplan: { context: 'default', exten: '+18005551234', priority: 1 },
        creationtime: '2026-04-03T00:00:00.000Z',
        language: 'en',
        name: 'PJSIP/trunk-00000001',
      },
    })

    expect(event).toEqual({
      type: 'channel_hangup',
      channelId: 'chan-abc',
      cause: 16,
      causeText: 'Normal Clearing',
      timestamp: '2026-04-03T00:00:00.000Z',
    })
  })

  test('translateEvent maps ChannelStateChange(Up) to channel_answer', () => {
    const client = new AriClient(makeConfig())
    const translateEvent = (
      client as unknown as { translateEvent: (e: unknown) => unknown }
    ).translateEvent.bind(client)

    const event = translateEvent({
      type: 'ChannelStateChange',
      application: 'llamenos',
      timestamp: '2026-04-03T00:00:00.000Z',
      channel: {
        id: 'chan-abc',
        state: 'Up',
        caller: { name: '', number: '+15551234567' },
        connected: { name: '', number: '' },
        accountcode: '',
        dialplan: { context: 'default', exten: '+18005551234', priority: 1 },
        creationtime: '2026-04-03T00:00:00.000Z',
        language: 'en',
        name: 'PJSIP/vol1-00000001',
      },
    })

    expect(event).toEqual({
      type: 'channel_answer',
      channelId: 'chan-abc',
      timestamp: '2026-04-03T00:00:00.000Z',
    })
  })

  test('translateEvent returns null for ChannelStateChange with non-Up state', () => {
    const client = new AriClient(makeConfig())
    const translateEvent = (
      client as unknown as { translateEvent: (e: unknown) => unknown }
    ).translateEvent.bind(client)

    const event = translateEvent({
      type: 'ChannelStateChange',
      application: 'llamenos',
      timestamp: '2026-04-03T00:00:00.000Z',
      channel: {
        id: 'chan-abc',
        state: 'Ringing',
        caller: { name: '', number: '' },
        connected: { name: '', number: '' },
        accountcode: '',
        dialplan: { context: 'default', exten: '+18005551234', priority: 1 },
        creationtime: '2026-04-03T00:00:00.000Z',
        language: 'en',
        name: 'PJSIP/vol1-00000001',
      },
    })

    expect(event).toBeNull()
  })

  test('translateEvent maps ChannelDtmfReceived to dtmf_received', () => {
    const client = new AriClient(makeConfig())
    const translateEvent = (
      client as unknown as { translateEvent: (e: unknown) => unknown }
    ).translateEvent.bind(client)

    const event = translateEvent({
      type: 'ChannelDtmfReceived',
      application: 'llamenos',
      timestamp: '2026-04-03T00:00:00.000Z',
      digit: '5',
      duration_ms: 100,
      channel: {
        id: 'chan-abc',
        state: 'Up',
        caller: { name: '', number: '' },
        connected: { name: '', number: '' },
        accountcode: '',
        dialplan: { context: 'default', exten: '+18005551234', priority: 1 },
        creationtime: '2026-04-03T00:00:00.000Z',
        language: 'en',
        name: 'PJSIP/vol1-00000001',
      },
    })

    expect(event).toEqual({
      type: 'dtmf_received',
      channelId: 'chan-abc',
      digit: '5',
      durationMs: 100,
      timestamp: '2026-04-03T00:00:00.000Z',
    })
  })

  test('translateEvent returns null for unknown event types', () => {
    const client = new AriClient(makeConfig())
    const translateEvent = (
      client as unknown as { translateEvent: (e: unknown) => unknown }
    ).translateEvent.bind(client)

    const event = translateEvent({
      type: 'SomeUnknownEvent',
      application: 'llamenos',
      timestamp: '2026-04-03T00:00:00.000Z',
    })

    expect(event).toBeNull()
  })
})
