import { afterEach, describe, expect, mock, test } from 'bun:test'
import { EslClient } from './esl-client'

function makeClient(overrides?: {
  password?: string
  host?: string
  port?: number
  connectionTimeoutMs?: number
}) {
  return new EslClient({
    password: overrides?.password ?? 'ClueCon',
    host: overrides?.host ?? 'localhost',
    port: overrides?.port ?? 8021,
    connectionTimeoutMs: overrides?.connectionTimeoutMs,
  })
}

// ---- Config defaults ----

describe('EslClient config defaults', () => {
  test('defaults host to localhost', () => {
    const client = makeClient()
    const c = client as unknown as { config: { host: string } }
    expect(c.config.host).toBe('localhost')
  })

  test('defaults port to 8021', () => {
    const client = makeClient()
    const c = client as unknown as { config: { port: number } }
    expect(c.config.port).toBe(8021)
  })

  test('defaults connectionTimeoutMs to 5 minutes', () => {
    const client = makeClient()
    const c = client as unknown as { connectionTimeoutMs: number }
    expect(c.connectionTimeoutMs).toBe(5 * 60 * 1000)
  })

  test('respects explicit connectionTimeoutMs', () => {
    const client = makeClient({ connectionTimeoutMs: 10_000 })
    const c = client as unknown as { connectionTimeoutMs: number }
    expect(c.connectionTimeoutMs).toBe(10_000)
  })

  test('uses provided host and port', () => {
    const client = makeClient({ host: '192.168.1.1', port: 9021 })
    const c = client as unknown as { config: { host: string; port: number } }
    expect(c.config.host).toBe('192.168.1.1')
    expect(c.config.port).toBe(9021)
  })
})

// ---- isConnected ----

describe('EslClient.isConnected', () => {
  test('returns false when not connected', () => {
    expect(makeClient().isConnected()).toBe(false)
  })
})

// ---- parseHeaders ----

describe('EslClient.parseHeaders', () => {
  test('parses simple key-value pairs', () => {
    const client = makeClient()
    const result = client.parseHeaders('Event-Name: CHANNEL_CREATE\nUnique-ID: abc123')
    expect(result['Event-Name']).toBe('CHANNEL_CREATE')
    expect(result['Unique-ID']).toBe('abc123')
  })

  test('handles multiple headers', () => {
    const client = makeClient()
    const block = [
      'Content-Type: text/event-plain',
      'Content-Length: 512',
      'Event-Name: DTMF',
      'Unique-ID: 1234-5678',
    ].join('\n')
    const result = client.parseHeaders(block)
    expect(result['Content-Type']).toBe('text/event-plain')
    expect(result['Content-Length']).toBe('512')
    expect(result['Event-Name']).toBe('DTMF')
    expect(result['Unique-ID']).toBe('1234-5678')
  })

  test('decodes URL-encoded values', () => {
    const client = makeClient()
    // FreeSWITCH URL-encodes special chars in header values
    const block = 'Caller-Caller-ID-Name: John%20Doe\nCaller-Destination-Number: %2B15551234567'
    const result = client.parseHeaders(block)
    expect(result['Caller-Caller-ID-Name']).toBe('John Doe')
    expect(result['Caller-Destination-Number']).toBe('+15551234567')
  })

  test('handles values with spaces gracefully (not URL-encoded)', () => {
    const client = makeClient()
    const block = 'Hangup-Cause: NORMAL_CLEARING\nHangup-Cause-Code: 16'
    const result = client.parseHeaders(block)
    expect(result['Hangup-Cause']).toBe('NORMAL_CLEARING')
    expect(result['Hangup-Cause-Code']).toBe('16')
  })

  test('skips lines without colon-space separator', () => {
    const client = makeClient()
    const block = 'Event-Name: CHANNEL_CREATE\nbadline\nUnique-ID: abc'
    const result = client.parseHeaders(block)
    expect(result['Event-Name']).toBe('CHANNEL_CREATE')
    expect(result['Unique-ID']).toBe('abc')
    expect(Object.keys(result)).toHaveLength(2)
  })

  test('handles empty header block', () => {
    const client = makeClient()
    const result = client.parseHeaders('')
    expect(Object.keys(result)).toHaveLength(0)
  })

  test('handles malformed URL encoding without throwing', () => {
    const client = makeClient()
    // %GG is invalid URL encoding
    const block = 'Event-Name: BAD%GGValue'
    const result = client.parseHeaders(block)
    // Should fall back to raw value on decode error
    expect(result['Event-Name']).toBe('BAD%GGValue')
  })
})

// ---- translateEslEvent ----

describe('EslClient.translateEslEvent', () => {
  test('maps CHANNEL_CREATE to channel_create', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'CHANNEL_CREATE',
      'Unique-ID': 'chan-001',
      'Caller-Caller-ID-Number': '+15551234567',
      'Caller-Destination-Number': '+18005551234',
    }
    const event = client.translateEslEvent(headers)
    expect(event).not.toBeNull()
    expect(event?.type).toBe('channel_create')
    if (event?.type === 'channel_create') {
      expect(event.channelId).toBe('chan-001')
      expect(event.callerNumber).toBe('+15551234567')
      expect(event.calledNumber).toBe('+18005551234')
      expect(event.timestamp).toBeString()
    }
  })

  test('maps CHANNEL_ANSWER to channel_answer', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'CHANNEL_ANSWER',
      'Unique-ID': 'chan-002',
    }
    const event = client.translateEslEvent(headers)
    expect(event).not.toBeNull()
    expect(event?.type).toBe('channel_answer')
    if (event?.type === 'channel_answer') {
      expect(event.channelId).toBe('chan-002')
      expect(event.timestamp).toBeString()
    }
  })

  test('maps CHANNEL_HANGUP_COMPLETE to channel_hangup with cause code', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'CHANNEL_HANGUP_COMPLETE',
      'Unique-ID': 'chan-003',
      'Hangup-Cause-Code': '16',
      'Hangup-Cause': 'NORMAL_CLEARING',
    }
    const event = client.translateEslEvent(headers)
    expect(event).not.toBeNull()
    expect(event?.type).toBe('channel_hangup')
    if (event?.type === 'channel_hangup') {
      expect(event.channelId).toBe('chan-003')
      expect(event.cause).toBe(16)
      expect(event.causeText).toBe('NORMAL_CLEARING')
      expect(event.timestamp).toBeString()
    }
  })

  test('maps CHANNEL_HANGUP_COMPLETE with missing cause code to 0', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'CHANNEL_HANGUP_COMPLETE',
      'Unique-ID': 'chan-004',
    }
    const event = client.translateEslEvent(headers)
    expect(event?.type).toBe('channel_hangup')
    if (event?.type === 'channel_hangup') {
      expect(event.cause).toBe(0)
      expect(event.causeText).toBe('UNKNOWN')
    }
  })

  test('maps RECORD_STOP to recording_complete', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'RECORD_STOP',
      'Unique-ID': 'chan-005',
      'Record-File-Path': '/tmp/recordings/call-abc.wav',
      variable_record_seconds: '42.5',
    }
    const event = client.translateEslEvent(headers)
    expect(event).not.toBeNull()
    expect(event?.type).toBe('recording_complete')
    if (event?.type === 'recording_complete') {
      expect(event.channelId).toBe('chan-005')
      expect(event.recordingName).toBe('call-abc.wav')
      expect(event.duration).toBe(42.5)
      expect(event.timestamp).toBeString()
    }
  })

  test('maps RECORD_STOP with missing duration gracefully', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'RECORD_STOP',
      'Unique-ID': 'chan-006',
      'Record-File-Path': '/tmp/recordings/call-xyz.wav',
    }
    const event = client.translateEslEvent(headers)
    expect(event?.type).toBe('recording_complete')
    if (event?.type === 'recording_complete') {
      expect(event.duration).toBe(0)
    }
  })

  test('maps DTMF to dtmf_received', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'DTMF',
      'Unique-ID': 'chan-007',
      'DTMF-Digit': '5',
      'DTMF-Duration': '150',
    }
    const event = client.translateEslEvent(headers)
    expect(event).not.toBeNull()
    expect(event?.type).toBe('dtmf_received')
    if (event?.type === 'dtmf_received') {
      expect(event.channelId).toBe('chan-007')
      expect(event.digit).toBe('5')
      expect(event.durationMs).toBe(150)
      expect(event.timestamp).toBeString()
    }
  })

  test('maps DTMF with missing digit to empty string', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'DTMF',
      'Unique-ID': 'chan-008',
    }
    const event = client.translateEslEvent(headers)
    expect(event?.type).toBe('dtmf_received')
    if (event?.type === 'dtmf_received') {
      expect(event.digit).toBe('')
      expect(event.durationMs).toBe(0)
    }
  })

  test('returns null for unknown event types', () => {
    const client = makeClient()
    const headers = {
      'Event-Name': 'SOME_UNKNOWN_EVENT',
      'Unique-ID': 'chan-009',
    }
    const event = client.translateEslEvent(headers)
    expect(event).toBeNull()
  })

  test('returns null for missing Event-Name', () => {
    const client = makeClient()
    const headers = {
      'Unique-ID': 'chan-010',
    }
    const event = client.translateEslEvent(headers)
    expect(event).toBeNull()
  })

  test('CHANNEL_CREATE with URL-encoded caller number', () => {
    const client = makeClient()
    // Simulate URL-encoded + sign (already decoded by parseHeaders before translateEslEvent)
    const headers = {
      'Event-Name': 'CHANNEL_CREATE',
      'Unique-ID': 'chan-011',
      'Caller-Caller-ID-Number': '+15559876543',
      'Caller-Destination-Number': '+18001234567',
    }
    const event = client.translateEslEvent(headers)
    expect(event?.type).toBe('channel_create')
    if (event?.type === 'channel_create') {
      expect(event.callerNumber).toBe('+15559876543')
      expect(event.calledNumber).toBe('+18001234567')
    }
  })
})

// ---- Connection deadline ----

describe('EslClient connection deadline', () => {
  let exitCode: number | undefined
  const originalExit = process.exit

  afterEach(() => {
    process.exit = originalExit
    exitCode = undefined
  })

  test('connectionDeadline is null initially', () => {
    const client = makeClient({ connectionTimeoutMs: 10_000 })
    const c = client as unknown as { connectionDeadline: number | null }
    expect(c.connectionDeadline).toBeNull()
  })

  test('exits when connection deadline has passed', () => {
    const client = makeClient({ connectionTimeoutMs: 1 })
    const c = client as unknown as {
      connectionDeadline: number | null
      hasConnected: boolean
      shouldReconnect: boolean
      scheduleReconnect: () => void
    }

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

  test('does not exit when deadline has not passed', () => {
    const client = makeClient({ connectionTimeoutMs: 60_000 })
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

// ---- onEvent registration ----

describe('EslClient.onEvent', () => {
  test('registers handlers that receive events via translateEslEvent', () => {
    const client = makeClient()
    const received: unknown[] = []
    client.onEvent((e) => received.push(e))

    // Directly dispatch via the private dispatch path by calling translateEslEvent
    // and then manually dispatching — this mirrors what the real socket path does
    const headers = {
      'Event-Name': 'CHANNEL_ANSWER',
      'Unique-ID': 'chan-test',
    }
    const event = client.translateEslEvent(headers)
    // Simulate dispatch (replicating what handleMessage does)
    const handlers = (client as unknown as { eventHandlers: Array<(event: unknown) => void> })
      .eventHandlers
    if (event) {
      for (const h of handlers) h(event)
    }

    expect(received).toHaveLength(1)
    expect((received[0] as { type: string }).type).toBe('channel_answer')
  })
})
