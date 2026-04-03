import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { KamailioClient } from './kamailio-client'

const JSONRPC_URL = 'http://kamailio:5060/jsonrpc'

function makeClient(overrides?: { jsonrpcUrl?: string; dispatcherSetId?: number }) {
  return new KamailioClient({
    jsonrpcUrl: overrides?.jsonrpcUrl ?? JSONRPC_URL,
    dispatcherSetId: overrides?.dispatcherSetId,
  })
}

/** Cast a mock to the global fetch type to satisfy TypeScript's strict fetch signature. */
// biome-ignore lint/suspicious/noExplicitAny: mock cast helper — deliberate escape hatch
function asFetch(fn: any): typeof globalThis.fetch {
  return fn as unknown as typeof globalThis.fetch
}

/** Build a minimal fetch mock that returns a JSONRPC 2.0 success response. */
function mockFetchSuccess(result: unknown) {
  return asFetch(
    mock(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  )
}

/** Build a fetch mock that returns a JSONRPC 2.0 error response. */
function mockFetchJsonRpcError(code: number, message: string) {
  return asFetch(
    mock(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  )
}

/** Build a fetch mock that returns a non-200 HTTP response. */
function mockFetchHttpError(status: number, statusText: string) {
  return asFetch(
    mock(async (_url: string, _init?: RequestInit) => new Response('', { status, statusText }))
  )
}

/** Build a fetch mock that throws a network error. */
function mockFetchNetworkError(message: string) {
  return asFetch(
    mock(async (_url: string, _init?: RequestInit) => {
      throw new Error(message)
    })
  )
}

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ---- Configuration ----

describe('KamailioClient config', () => {
  test('defaults dispatcherSetId to 1', () => {
    const client = makeClient()
    const c = client as unknown as { dispatcherSetId: number }
    expect(c.dispatcherSetId).toBe(1)
  })

  test('respects explicit dispatcherSetId', () => {
    const client = makeClient({ dispatcherSetId: 3 })
    const c = client as unknown as { dispatcherSetId: number }
    expect(c.dispatcherSetId).toBe(3)
  })
})

// ---- Lifecycle ----

describe('KamailioClient lifecycle', () => {
  test('isConnected always returns true (stateless HTTP)', () => {
    expect(makeClient().isConnected()).toBe(true)
  })

  test('disconnect is a no-op', () => {
    const client = makeClient()
    expect(() => client.disconnect()).not.toThrow()
  })

  test('onEvent is a no-op', () => {
    const client = makeClient()
    expect(() => client.onEvent(() => {})).not.toThrow()
  })

  test('connect resolves when JSONRPC endpoint is reachable', async () => {
    globalThis.fetch = mockFetchSuccess({ version: 'kamailio 5.6.0' })
    const client = makeClient()
    await expect(client.connect()).resolves.toBeUndefined()
  })

  test('connect throws when JSONRPC endpoint is unreachable', async () => {
    globalThis.fetch = mockFetchNetworkError('ECONNREFUSED')
    const client = makeClient()
    await expect(client.connect()).rejects.toThrow('Cannot connect')
  })
})

// ---- Call control — all throw ----

describe('KamailioClient call control throws', () => {
  test('originate throws with SIP proxy message', async () => {
    const client = makeClient()
    await expect(client.originate({ endpoint: 'sip:user@host' })).rejects.toThrow('SIP proxy')
  })

  test('hangup throws with SIP proxy message', async () => {
    await expect(makeClient().hangup('ch-1')).rejects.toThrow('SIP proxy')
  })

  test('answer throws with SIP proxy message', async () => {
    await expect(makeClient().answer('ch-1')).rejects.toThrow('SIP proxy')
  })

  test('bridge throws with SIP proxy message', async () => {
    await expect(makeClient().bridge('ch-1', 'ch-2')).rejects.toThrow('SIP proxy')
  })

  test('destroyBridge throws with SIP proxy message', async () => {
    await expect(makeClient().destroyBridge('br-1')).rejects.toThrow('SIP proxy')
  })

  test('listChannels throws with SIP proxy message', async () => {
    await expect(makeClient().listChannels()).rejects.toThrow('SIP proxy')
  })

  test('listBridges throws with SIP proxy message', async () => {
    await expect(makeClient().listBridges()).rejects.toThrow('SIP proxy')
  })
})

// ---- Media — all throw ----

describe('KamailioClient media throws', () => {
  test('playMedia throws with SIP proxy message', async () => {
    await expect(makeClient().playMedia('ch-1', 'sound:beep')).rejects.toThrow('SIP proxy')
  })

  test('stopPlayback throws with SIP proxy message', async () => {
    await expect(makeClient().stopPlayback('pb-1')).rejects.toThrow('SIP proxy')
  })

  test('startMoh throws with SIP proxy message', async () => {
    await expect(makeClient().startMoh('ch-1')).rejects.toThrow('SIP proxy')
  })

  test('stopMoh throws with SIP proxy message', async () => {
    await expect(makeClient().stopMoh('ch-1')).rejects.toThrow('SIP proxy')
  })
})

// ---- Recording — all throw ----

describe('KamailioClient recording throws', () => {
  test('recordChannel throws with SIP proxy message', async () => {
    await expect(makeClient().recordChannel('ch-1', { name: 'rec-1' })).rejects.toThrow('SIP proxy')
  })

  test('recordBridge throws with SIP proxy message', async () => {
    await expect(makeClient().recordBridge('br-1', { name: 'rec-1' })).rejects.toThrow('SIP proxy')
  })

  test('stopRecording throws with SIP proxy message', async () => {
    await expect(makeClient().stopRecording('rec-1')).rejects.toThrow('SIP proxy')
  })

  test('getRecordingFile throws with SIP proxy message', async () => {
    await expect(makeClient().getRecordingFile('rec-1')).rejects.toThrow('SIP proxy')
  })

  test('deleteRecording throws with SIP proxy message', async () => {
    await expect(makeClient().deleteRecording('rec-1')).rejects.toThrow('SIP proxy')
  })
})

// ---- Channel variables — all throw ----

describe('KamailioClient channel variables throw', () => {
  test('setChannelVar throws with SIP proxy message', async () => {
    await expect(makeClient().setChannelVar('ch-1', 'VAR', 'val')).rejects.toThrow('SIP proxy')
  })

  test('getChannelVar throws with SIP proxy message', async () => {
    await expect(makeClient().getChannelVar('ch-1', 'VAR')).rejects.toThrow('SIP proxy')
  })
})

// ---- healthCheck ----

describe('KamailioClient.healthCheck', () => {
  test('returns ok=true with version and latencyMs on success', async () => {
    globalThis.fetch = mockFetchSuccess({ version: 'kamailio 5.7.2' })
    const client = makeClient()
    const health = await client.healthCheck()
    expect(health.ok).toBe(true)
    expect(typeof health.latencyMs).toBe('number')
    expect(health.details?.version).toBe('kamailio 5.7.2')
    expect(health.details?.endpoint).toBe(JSONRPC_URL)
  })

  test('returns ok=false when fetch throws', async () => {
    globalThis.fetch = mockFetchNetworkError('ECONNREFUSED')
    const health = await makeClient().healthCheck()
    expect(health.ok).toBe(false)
    expect(typeof health.latencyMs).toBe('number')
  })

  test('returns ok=false on non-200 HTTP response', async () => {
    globalThis.fetch = mockFetchHttpError(503, 'Service Unavailable')
    const health = await makeClient().healthCheck()
    expect(health.ok).toBe(false)
  })

  test('returns ok=false on JSONRPC error response', async () => {
    globalThis.fetch = mockFetchJsonRpcError(-32601, 'Method not found')
    const health = await makeClient().healthCheck()
    expect(health.ok).toBe(false)
  })
})

// ---- getDispatchers ----

describe('KamailioClient.getDispatchers', () => {
  test('parses dispatcher.list response and returns entries for configured set', async () => {
    globalThis.fetch = mockFetchSuccess({
      RECORDS: [
        {
          SET: {
            ID: 1,
            TARGETS: [
              { DEST: { URI: 'sip:pbx1@10.0.0.1:5060', FLAGS: 'AP', PRIORITY: 0 } },
              { DEST: { URI: 'sip:pbx2@10.0.0.2:5060', FLAGS: 'IP', PRIORITY: 1 } },
            ],
          },
        },
      ],
    })
    const client = makeClient()
    const entries = await client.getDispatchers()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      uri: 'sip:pbx1@10.0.0.1:5060',
      flags: 'AP',
      priority: 0,
    })
    expect(entries[1]).toEqual({
      uri: 'sip:pbx2@10.0.0.2:5060',
      flags: 'IP',
      priority: 1,
    })
  })

  test('filters to the configured dispatcherSetId', async () => {
    globalThis.fetch = mockFetchSuccess({
      RECORDS: [
        {
          SET: {
            ID: 1,
            TARGETS: [{ DEST: { URI: 'sip:pbx1@10.0.0.1:5060', FLAGS: 'AP', PRIORITY: 0 } }],
          },
        },
        {
          SET: {
            ID: 2,
            TARGETS: [{ DEST: { URI: 'sip:pbx3@10.0.0.3:5060', FLAGS: 'AP', PRIORITY: 0 } }],
          },
        },
      ],
    })
    const client = makeClient({ dispatcherSetId: 2 })
    const entries = await client.getDispatchers()
    expect(entries).toHaveLength(1)
    expect(entries[0].uri).toBe('sip:pbx3@10.0.0.3:5060')
  })

  test('returns empty array when RECORDS is missing', async () => {
    globalThis.fetch = mockFetchSuccess({})
    const entries = await makeClient().getDispatchers()
    expect(entries).toHaveLength(0)
  })

  test('calls dispatcher.list method', async () => {
    let capturedBody: string | null = null
    globalThis.fetch = asFetch(
      mock(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { RECORDS: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
    await makeClient().getDispatchers()
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.method).toBe('dispatcher.list')
  })
})

// ---- setDispatcherState ----

describe('KamailioClient.setDispatcherState', () => {
  test('sends state=0 for active', async () => {
    let capturedBody: string | null = null
    globalThis.fetch = asFetch(
      mock(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
    await makeClient().setDispatcherState('sip:pbx1@10.0.0.1:5060', 'active')
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.method).toBe('dispatcher.set_state')
    expect(parsed.params[0]).toBe(0)
    expect(parsed.params[1]).toBe(1) // default set ID
    expect(parsed.params[2]).toBe('sip:pbx1@10.0.0.1:5060')
  })

  test('sends state=1 for inactive', async () => {
    let capturedBody: string | null = null
    globalThis.fetch = asFetch(
      mock(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
    await makeClient().setDispatcherState('sip:pbx1@10.0.0.1:5060', 'inactive')
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.method).toBe('dispatcher.set_state')
    expect(parsed.params[0]).toBe(1)
  })

  test('uses configured dispatcherSetId in params', async () => {
    let capturedBody: string | null = null
    globalThis.fetch = asFetch(
      mock(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
    const client = makeClient({ dispatcherSetId: 5 })
    await client.setDispatcherState('sip:pbx@host', 'active')
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.params[1]).toBe(5)
  })
})

// ---- reloadDispatchers ----

describe('KamailioClient.reloadDispatchers', () => {
  test('sends dispatcher.reload method', async () => {
    let capturedBody: string | null = null
    globalThis.fetch = asFetch(
      mock(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
    await makeClient().reloadDispatchers()
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.method).toBe('dispatcher.reload')
  })

  test('resolves without error on success', async () => {
    globalThis.fetch = mockFetchSuccess('ok')
    await expect(makeClient().reloadDispatchers()).resolves.toBeUndefined()
  })
})

// ---- getStatistics ----

describe('KamailioClient.getStatistics', () => {
  test('sends stats.get_statistics with "all" when no group given', async () => {
    let capturedBody: string | null = null
    globalThis.fetch = asFetch(
      mock(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { 'core:request_count': 42 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      })
    )
    const stats = await makeClient().getStatistics()
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.method).toBe('stats.get_statistics')
    expect(parsed.params).toEqual(['all'])
    expect(stats['core:request_count']).toBe(42)
  })

  test('sends provided group as param', async () => {
    let capturedBody: string | null = null
    globalThis.fetch = asFetch(
      mock(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { 'core:request_count': 10 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      })
    )
    await makeClient().getStatistics('core:')
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.params).toEqual(['core:'])
  })
})

// ---- JSONRPC error propagation ----

describe('KamailioClient JSONRPC error propagation', () => {
  test('throws with JSONRPC error code and message on error response', async () => {
    globalThis.fetch = mockFetchJsonRpcError(-32600, 'Invalid Request')
    await expect(makeClient().reloadDispatchers()).rejects.toThrow('[-32600] Invalid Request')
  })

  test('throws on non-200 HTTP status', async () => {
    globalThis.fetch = mockFetchHttpError(500, 'Internal Server Error')
    await expect(makeClient().reloadDispatchers()).rejects.toThrow('HTTP 500')
  })

  test('throws on network error with descriptive message', async () => {
    globalThis.fetch = mockFetchNetworkError('Connection refused')
    await expect(makeClient().reloadDispatchers()).rejects.toThrow('Connection refused')
  })
})

// ---- JSONRPC request format ----

describe('KamailioClient JSONRPC request format', () => {
  test('sends correct JSONRPC 2.0 envelope', async () => {
    let capturedUrl: string | null = null
    let capturedInit: RequestInit | null = null
    globalThis.fetch = asFetch(
      mock(async (url: string, init?: RequestInit) => {
        capturedUrl = url
        capturedInit = init ?? null
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
    await makeClient().reloadDispatchers()
    // biome-ignore lint/style/noNonNullAssertion: captured in mock callback above
    expect(capturedUrl!).toBe(JSONRPC_URL)
    // biome-ignore lint/style/noNonNullAssertion: captured in mock callback above
    expect(capturedInit!.method).toBe('POST')
    // biome-ignore lint/style/noNonNullAssertion: captured in mock callback above
    const headers = capturedInit!.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    // biome-ignore lint/style/noNonNullAssertion: captured in mock callback above
    const body = JSON.parse(capturedInit!.body as string) as { jsonrpc: string; id: number }
    expect(body.jsonrpc).toBe('2.0')
    expect(typeof body.id).toBe('number')
  })

  test('increments request ID on each call', async () => {
    const ids: number[] = []
    globalThis.fetch = asFetch(
      mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string)
        ids.push(body.id as number)
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id as number, result: 'ok' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      })
    )
    const client = makeClient()
    await client.reloadDispatchers()
    await client.reloadDispatchers()
    expect(ids[0]).toBe(1)
    expect(ids[1]).toBe(2)
  })
})
