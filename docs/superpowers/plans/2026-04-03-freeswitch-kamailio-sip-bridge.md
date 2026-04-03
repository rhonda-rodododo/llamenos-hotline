# FreeSWITCH + Kamailio + Unified SIP Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FreeSWITCH as the 9th telephony provider, integrate Kamailio as a SIP proxy/LB, and refactor the asterisk-bridge into a unified sip-bridge handling ARI, ESL, and JSONRPC.

**Architecture:** The unified `sip-bridge/` process replaces `asterisk-bridge/` with a `BridgeClient` interface that abstracts three protocol clients (ARI WebSocket for Asterisk, ESL TCP for FreeSWITCH, JSONRPC HTTP for Kamailio). The FreeSWITCH adapter generates mod_httapi XML responses and delegates real-time call control to the ESL client in the bridge. Kamailio is infrastructure-only (SIP proxy/LB), not a TelephonyAdapter.

**Tech Stack:** Bun, Hono, Zod, mod_httapi XML, FreeSWITCH ESL protocol, Kamailio JSONRPC, Playwright (tests)

**Spec:** `docs/superpowers/specs/2026-04-03-freeswitch-adapter-design.md`

---

## Phase 1: Unified SIP Bridge Refactor (Tasks 1–5)

Refactors `asterisk-bridge/` → `sip-bridge/` with protocol abstraction. Existing Asterisk functionality is preserved.

### Task 1: BridgeClient Interface + Project Scaffold

**Files:**
- Create: `sip-bridge/src/bridge-client.ts`
- Create: `sip-bridge/src/bridge-client.test.ts`
- Create: `sip-bridge/package.json`
- Create: `sip-bridge/tsconfig.json`

- [ ] **Step 1: Create `sip-bridge/` project scaffold**

```bash
mkdir -p sip-bridge/src/clients
```

`sip-bridge/package.json`:
```json
{
  "name": "sip-bridge",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.9.0"
  }
}
```

`sip-bridge/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Define BridgeClient interface**

`sip-bridge/src/bridge-client.ts`:
```typescript
/**
 * Protocol-agnostic interface for PBX communication.
 * Implemented by ARI (Asterisk), ESL (FreeSWITCH), and JSONRPC (Kamailio) clients.
 */

export interface BridgeEvent {
  type: 'channel_create' | 'channel_answer' | 'channel_hangup' | 'record_stop' | 'dtmf'
  channelId: string
  callSid?: string
  callerNumber?: string
  calledNumber?: string
  state?: string
  duration?: number
  digit?: string
  recordingName?: string
  recordingStatus?: string
  timestamp: number
}

export interface OriginateParams {
  endpoint: string // e.g., 'PJSIP/+15551234567@trunk' or 'user/vol_abc123'
  callerId: string
  variables?: Record<string, string>
  timeout?: number
}

export interface BridgeHealthStatus {
  connected: boolean
  latencyMs: number
  type: string
  error?: string
}

export interface BridgeClient {
  readonly type: 'ari' | 'esl' | 'kamailio'

  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  onEvent(handler: (event: BridgeEvent) => void): void

  // Call control
  originate(params: OriginateParams): Promise<string> // returns channel/call ID
  hangup(channelId: string): Promise<void>
  bridge(channelId1: string, channelId2: string): Promise<void>
  answer(channelId: string): Promise<void>
  record(channelId: string, filename: string): Promise<void>
  stopRecord(channelId: string): Promise<void>

  // Health
  healthCheck(): Promise<BridgeHealthStatus>
}
```

- [ ] **Step 3: Write unit test for BridgeEvent type**

`sip-bridge/src/bridge-client.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test'
import type { BridgeClient, BridgeEvent, BridgeHealthStatus, OriginateParams } from './bridge-client'

describe('BridgeClient interface', () => {
  test('BridgeEvent has required fields', () => {
    const event: BridgeEvent = {
      type: 'channel_create',
      channelId: 'ch-123',
      callerNumber: '+15551234567',
      calledNumber: '+15559999999',
      timestamp: Date.now(),
    }
    expect(event.type).toBe('channel_create')
    expect(event.channelId).toBe('ch-123')
  })

  test('OriginateParams has required fields', () => {
    const params: OriginateParams = {
      endpoint: 'PJSIP/+15551234567@trunk',
      callerId: '+15559999999',
    }
    expect(params.endpoint).toBeDefined()
    expect(params.callerId).toBeDefined()
  })

  test('BridgeHealthStatus has required fields', () => {
    const status: BridgeHealthStatus = {
      connected: true,
      latencyMs: 12,
      type: 'ari',
    }
    expect(status.connected).toBe(true)
    expect(status.type).toBe('ari')
  })
})
```

- [ ] **Step 4: Run tests**

```bash
cd sip-bridge && bun install && bun test
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add sip-bridge/
git commit -m "feat: sip-bridge scaffold with BridgeClient interface"
```

---

### Task 2: Extract ARI Client from asterisk-bridge

**Files:**
- Create: `sip-bridge/src/clients/ari-client.ts`
- Create: `sip-bridge/src/clients/ari-client.test.ts`
- Read: `asterisk-bridge/src/index.ts` (reference only — extract, don't delete yet)

- [ ] **Step 1: Extract ARI client class**

Copy the ARI WebSocket connection, event handling, and command methods from `asterisk-bridge/src/index.ts` into a class that implements `BridgeClient`.

`sip-bridge/src/clients/ari-client.ts`:
```typescript
import type { BridgeClient, BridgeEvent, BridgeHealthStatus, OriginateParams } from '../bridge-client'

export interface AriConfig {
  ariUrl: string        // ws://asterisk:8088/ari/events
  ariRestUrl: string    // http://asterisk:8088/ari
  ariUsername: string
  ariPassword: string
  ariApp?: string       // default: 'llamenos'
}

/**
 * Asterisk ARI WebSocket client — implements BridgeClient.
 * Extracted from asterisk-bridge/src/index.ts.
 */
export class AriClient implements BridgeClient {
  readonly type = 'ari' as const
  private ws: WebSocket | null = null
  private eventHandler: ((event: BridgeEvent) => void) | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connected = false

  constructor(private config: AriConfig) {}

  async connect(): Promise<void> {
    const app = this.config.ariApp ?? 'llamenos'
    const auth = btoa(`${this.config.ariUsername}:${this.config.ariPassword}`)
    const url = `${this.config.ariUrl}?app=${app}&api_key=${this.config.ariUsername}:${this.config.ariPassword}`

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)
      this.ws.onopen = () => {
        console.log('[ari] Connected to Asterisk ARI')
        this.connected = true
        resolve()
      }
      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string)
          const event = this.translateEvent(data)
          if (event && this.eventHandler) this.eventHandler(event)
        } catch (err) {
          console.error('[ari] Failed to parse event:', err)
        }
      }
      this.ws.onclose = () => {
        this.connected = false
        console.log('[ari] Disconnected — reconnecting in 5s')
        this.reconnectTimer = setTimeout(() => this.connect(), 5000)
      }
      this.ws.onerror = (err) => {
        console.error('[ari] WebSocket error:', err)
        if (!this.connected) reject(err)
      }
    })
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  onEvent(handler: (event: BridgeEvent) => void): void {
    this.eventHandler = handler
  }

  async originate(params: OriginateParams): Promise<string> {
    const res = await this.ariRest('POST', '/channels', {
      endpoint: params.endpoint,
      callerId: params.callerId,
      timeout: params.timeout ?? 30,
      app: this.config.ariApp ?? 'llamenos',
      variables: params.variables ? { variables: params.variables } : undefined,
    })
    return (res as { id: string }).id
  }

  async hangup(channelId: string): Promise<void> {
    await this.ariRest('DELETE', `/channels/${channelId}`).catch(() => {})
  }

  async bridge(channelId1: string, channelId2: string): Promise<void> {
    const br = (await this.ariRest('POST', '/bridges', { type: 'mixing' })) as { id: string }
    await this.ariRest('POST', `/bridges/${br.id}/addChannel`, { channel: `${channelId1},${channelId2}` })
  }

  async answer(channelId: string): Promise<void> {
    await this.ariRest('POST', `/channels/${channelId}/answer`)
  }

  async record(channelId: string, filename: string): Promise<void> {
    await this.ariRest('POST', `/channels/${channelId}/record`, {
      name: filename,
      format: 'wav',
      maxDurationSeconds: 120,
      ifExists: 'overwrite',
    })
  }

  async stopRecord(channelId: string): Promise<void> {
    await this.ariRest('POST', `/channels/${channelId}/record`, { terminate: true }).catch(() => {})
  }

  async healthCheck(): Promise<BridgeHealthStatus> {
    const start = Date.now()
    try {
      await this.ariRest('GET', '/asterisk/info')
      return { connected: true, latencyMs: Date.now() - start, type: 'ari' }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, type: 'ari', error: String(err) }
    }
  }

  // --- Private ---

  private async ariRest(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.config.ariRestUrl}${path}`
    const auth = btoa(`${this.config.ariUsername}:${this.config.ariPassword}`)
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`ARI ${method} ${path}: ${res.status}`)
    const ct = res.headers.get('content-type') || ''
    return ct.includes('json') ? res.json() : null
  }

  private translateEvent(data: Record<string, unknown>): BridgeEvent | null {
    const type = data.type as string
    const channel = data.channel as Record<string, unknown> | undefined
    const channelId = (channel?.id as string) ?? (data.channel_id as string) ?? ''
    const caller = channel?.caller as Record<string, unknown> | undefined

    switch (type) {
      case 'StasisStart':
        return {
          type: 'channel_create',
          channelId,
          callerNumber: caller?.number as string,
          calledNumber: (channel?.dialplan as Record<string, unknown>)?.exten as string,
          timestamp: Date.now(),
        }
      case 'ChannelStateChange': {
        const state = channel?.state as string
        if (state === 'Up') return { type: 'channel_answer', channelId, state: 'Up', timestamp: Date.now() }
        return null
      }
      case 'StasisEnd':
      case 'ChannelDestroyed':
        return {
          type: 'channel_hangup',
          channelId,
          state: 'Hangup',
          duration: data.duration_ms ? Number(data.duration_ms) / 1000 : undefined,
          timestamp: Date.now(),
        }
      case 'RecordingFinished':
        return {
          type: 'record_stop',
          channelId,
          recordingName: (data.recording as Record<string, unknown>)?.name as string,
          recordingStatus: 'done',
          timestamp: Date.now(),
        }
      case 'ChannelDtmfReceived':
        return {
          type: 'dtmf',
          channelId,
          digit: data.digit as string,
          timestamp: Date.now(),
        }
      default:
        return null
    }
  }
}
```

- [ ] **Step 2: Write unit tests for ARI event translation**

`sip-bridge/src/clients/ari-client.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test'
import { AriClient } from './ari-client'

// Access private method via prototype for testing
const translateEvent = (AriClient.prototype as unknown as { translateEvent(d: Record<string, unknown>): unknown }).translateEvent

describe('AriClient event translation', () => {
  const client = new AriClient({
    ariUrl: 'ws://localhost:8088/ari/events',
    ariRestUrl: 'http://localhost:8088/ari',
    ariUsername: 'test',
    ariPassword: 'test',
  })

  test('translates StasisStart to channel_create', () => {
    const event = (client as any).translateEvent({
      type: 'StasisStart',
      channel: {
        id: 'ch-001',
        caller: { number: '+15551234567' },
        dialplan: { exten: '+15559999999' },
      },
    })
    expect(event).toBeDefined()
    expect(event!.type).toBe('channel_create')
    expect(event!.channelId).toBe('ch-001')
    expect(event!.callerNumber).toBe('+15551234567')
  })

  test('translates ChannelStateChange Up to channel_answer', () => {
    const event = (client as any).translateEvent({
      type: 'ChannelStateChange',
      channel: { id: 'ch-001', state: 'Up' },
    })
    expect(event).toBeDefined()
    expect(event!.type).toBe('channel_answer')
  })

  test('translates StasisEnd to channel_hangup', () => {
    const event = (client as any).translateEvent({
      type: 'StasisEnd',
      channel: { id: 'ch-001' },
    })
    expect(event).toBeDefined()
    expect(event!.type).toBe('channel_hangup')
  })

  test('translates RecordingFinished to record_stop', () => {
    const event = (client as any).translateEvent({
      type: 'RecordingFinished',
      channel: { id: 'ch-001' },
      recording: { name: 'vm-001' },
    })
    expect(event).toBeDefined()
    expect(event!.type).toBe('record_stop')
    expect(event!.recordingName).toBe('vm-001')
  })

  test('returns null for unknown events', () => {
    const event = (client as any).translateEvent({ type: 'PlaybackStarted' })
    expect(event).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd sip-bridge && bun test
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add sip-bridge/src/clients/ari-client.ts sip-bridge/src/clients/ari-client.test.ts
git commit -m "feat: extract ARI client from asterisk-bridge into sip-bridge"
```

---

### Task 3: ESL Client for FreeSWITCH

**Files:**
- Create: `sip-bridge/src/clients/esl-client.ts`
- Create: `sip-bridge/src/clients/esl-client.test.ts`

- [ ] **Step 1: Implement ESL TCP client**

`sip-bridge/src/clients/esl-client.ts`:
```typescript
import type { BridgeClient, BridgeEvent, BridgeHealthStatus, OriginateParams } from '../bridge-client'
import { Socket } from 'node:net'

export interface EslConfig {
  eslHost: string
  eslPort: number
  eslPassword: string
}

/**
 * FreeSWITCH ESL (Event Socket Library) client — implements BridgeClient.
 * Connects over TCP, authenticates, subscribes to events.
 */
export class EslClient implements BridgeClient {
  readonly type = 'esl' as const
  private socket: Socket | null = null
  private eventHandler: ((event: BridgeEvent) => void) | null = null
  private connected = false
  private buffer = ''
  private pendingAuth: { resolve: () => void; reject: (err: Error) => void } | null = null

  constructor(private config: EslConfig) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket()
      this.socket.connect(this.config.eslPort, this.config.eslHost)

      this.socket.on('connect', () => {
        console.log(`[esl] Connected to FreeSWITCH at ${this.config.eslHost}:${this.config.eslPort}`)
      })

      this.socket.on('data', (data: Buffer) => {
        this.buffer += data.toString()
        this.processBuffer()
      })

      this.socket.on('close', () => {
        this.connected = false
        console.log('[esl] Disconnected — reconnecting in 5s')
        setTimeout(() => this.connect(), 5000)
      })

      this.socket.on('error', (err: Error) => {
        console.error('[esl] Socket error:', err.message)
        if (!this.connected) reject(err)
      })

      // ESL sends "Content-Type: auth/request" on connect — we respond with auth
      this.pendingAuth = {
        resolve: () => {
          this.connected = true
          // Subscribe to events after auth
          this.sendCommand('event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE RECORD_STOP DTMF')
          resolve()
        },
        reject,
      }
    })
  }

  async disconnect(): Promise<void> {
    this.socket?.destroy()
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  onEvent(handler: (event: BridgeEvent) => void): void {
    this.eventHandler = handler
  }

  async originate(params: OriginateParams): Promise<string> {
    const vars = params.variables
      ? Object.entries(params.variables).map(([k, v]) => `${k}=${v}`).join(',')
      : ''
    const varsStr = vars ? `{${vars}}` : ''
    const uuid = crypto.randomUUID()
    const cmd = `bgapi originate ${varsStr}${params.endpoint} &park() ${params.callerId} ${params.callerId} ${uuid} ${params.timeout ?? 30}`
    await this.sendCommand(cmd)
    return uuid
  }

  async hangup(channelId: string): Promise<void> {
    await this.sendCommand(`api uuid_kill ${channelId}`)
  }

  async bridge(channelId1: string, channelId2: string): Promise<void> {
    await this.sendCommand(`api uuid_bridge ${channelId1} ${channelId2}`)
  }

  async answer(channelId: string): Promise<void> {
    await this.sendCommand(`api uuid_answer ${channelId}`)
  }

  async record(channelId: string, filename: string): Promise<void> {
    await this.sendCommand(`api uuid_record ${channelId} start /tmp/recordings/${filename}.wav 120`)
  }

  async stopRecord(channelId: string): Promise<void> {
    await this.sendCommand(`api uuid_record ${channelId} stop all`)
  }

  async healthCheck(): Promise<BridgeHealthStatus> {
    const start = Date.now()
    try {
      await this.sendCommand('api status')
      return { connected: true, latencyMs: Date.now() - start, type: 'esl' }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, type: 'esl', error: String(err) }
    }
  }

  // --- Private ---

  private sendCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        return reject(new Error('ESL not connected'))
      }
      this.socket.write(`${cmd}\n\n`)
      // ESL responses are parsed in processBuffer
      resolve('ok')
    })
  }

  private processBuffer(): void {
    // ESL protocol: headers separated by \n, header block ends with \n\n
    // Content-Length header indicates body follows
    while (this.buffer.includes('\n\n')) {
      const headerEnd = this.buffer.indexOf('\n\n')
      const headerBlock = this.buffer.slice(0, headerEnd)
      const headers = this.parseHeaders(headerBlock)
      const contentLength = Number.parseInt(headers['Content-Length'] ?? '0', 10)

      const bodyStart = headerEnd + 2
      if (contentLength > 0 && this.buffer.length < bodyStart + contentLength) {
        return // Wait for more data
      }

      const body = contentLength > 0 ? this.buffer.slice(bodyStart, bodyStart + contentLength) : ''
      this.buffer = this.buffer.slice(bodyStart + contentLength)

      this.handleMessage(headers, body)
    }
  }

  private parseHeaders(block: string): Record<string, string> {
    const headers: Record<string, string> = {}
    for (const line of block.split('\n')) {
      const colon = line.indexOf(':')
      if (colon > 0) {
        headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
      }
    }
    return headers
  }

  private handleMessage(headers: Record<string, string>, body: string): void {
    const contentType = headers['Content-Type'] ?? ''

    // Auth request
    if (contentType === 'auth/request') {
      this.socket?.write(`auth ${this.config.eslPassword}\n\n`)
      return
    }

    // Auth reply
    if (contentType === 'command/reply' && this.pendingAuth) {
      const reply = headers['Reply-Text'] ?? ''
      if (reply.startsWith('+OK')) {
        this.pendingAuth.resolve()
      } else {
        this.pendingAuth.reject(new Error(`ESL auth failed: ${reply}`))
      }
      this.pendingAuth = null
      return
    }

    // Event
    if (contentType === 'text/event-plain') {
      const eventHeaders = this.parseHeaders(body)
      const event = this.translateEvent(eventHeaders)
      if (event && this.eventHandler) this.eventHandler(event)
    }
  }

  private translateEvent(headers: Record<string, string>): BridgeEvent | null {
    const eventName = headers['Event-Name']
    const channelId = headers['Unique-ID'] ?? ''
    const callerNumber = headers['Caller-Caller-ID-Number'] ?? ''
    const calledNumber = headers['Caller-Destination-Number'] ?? ''

    switch (eventName) {
      case 'CHANNEL_CREATE':
        return {
          type: 'channel_create',
          channelId,
          callerNumber,
          calledNumber,
          timestamp: Date.now(),
        }
      case 'CHANNEL_ANSWER':
        return {
          type: 'channel_answer',
          channelId,
          state: 'Up',
          timestamp: Date.now(),
        }
      case 'CHANNEL_HANGUP_COMPLETE': {
        const duration = Number.parseInt(headers['variable_billsec'] ?? '0', 10)
        return {
          type: 'channel_hangup',
          channelId,
          state: 'Hangup',
          duration,
          timestamp: Date.now(),
        }
      }
      case 'RECORD_STOP':
        return {
          type: 'record_stop',
          channelId,
          recordingName: headers['Record-File-Path']?.split('/').pop()?.replace('.wav', ''),
          recordingStatus: 'done',
          timestamp: Date.now(),
        }
      case 'DTMF':
        return {
          type: 'dtmf',
          channelId,
          digit: headers['DTMF-Digit'],
          timestamp: Date.now(),
        }
      default:
        return null
    }
  }
}
```

- [ ] **Step 2: Write unit tests for ESL event translation and header parsing**

`sip-bridge/src/clients/esl-client.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test'
import { EslClient } from './esl-client'

describe('EslClient', () => {
  const client = new EslClient({ eslHost: 'localhost', eslPort: 8021, eslPassword: 'ClueCon' })

  describe('event translation', () => {
    test('translates CHANNEL_CREATE to channel_create', () => {
      const event = (client as any).translateEvent({
        'Event-Name': 'CHANNEL_CREATE',
        'Unique-ID': 'uuid-001',
        'Caller-Caller-ID-Number': '+15551234567',
        'Caller-Destination-Number': '+15559999999',
      })
      expect(event).toBeDefined()
      expect(event!.type).toBe('channel_create')
      expect(event!.channelId).toBe('uuid-001')
      expect(event!.callerNumber).toBe('+15551234567')
      expect(event!.calledNumber).toBe('+15559999999')
    })

    test('translates CHANNEL_ANSWER to channel_answer', () => {
      const event = (client as any).translateEvent({
        'Event-Name': 'CHANNEL_ANSWER',
        'Unique-ID': 'uuid-001',
      })
      expect(event!.type).toBe('channel_answer')
      expect(event!.state).toBe('Up')
    })

    test('translates CHANNEL_HANGUP_COMPLETE to channel_hangup with duration', () => {
      const event = (client as any).translateEvent({
        'Event-Name': 'CHANNEL_HANGUP_COMPLETE',
        'Unique-ID': 'uuid-001',
        variable_billsec: '42',
      })
      expect(event!.type).toBe('channel_hangup')
      expect(event!.duration).toBe(42)
    })

    test('translates RECORD_STOP to record_stop', () => {
      const event = (client as any).translateEvent({
        'Event-Name': 'RECORD_STOP',
        'Unique-ID': 'uuid-001',
        'Record-File-Path': '/tmp/recordings/vm-001.wav',
      })
      expect(event!.type).toBe('record_stop')
      expect(event!.recordingName).toBe('vm-001')
    })

    test('translates DTMF', () => {
      const event = (client as any).translateEvent({
        'Event-Name': 'DTMF',
        'Unique-ID': 'uuid-001',
        'DTMF-Digit': '5',
      })
      expect(event!.type).toBe('dtmf')
      expect(event!.digit).toBe('5')
    })

    test('returns null for unknown events', () => {
      const event = (client as any).translateEvent({ 'Event-Name': 'HEARTBEAT' })
      expect(event).toBeNull()
    })
  })

  describe('header parsing', () => {
    test('parses ESL headers', () => {
      const headers = (client as any).parseHeaders(
        'Content-Type: text/event-plain\nContent-Length: 42\nEvent-Name: CHANNEL_CREATE'
      )
      expect(headers['Content-Type']).toBe('text/event-plain')
      expect(headers['Content-Length']).toBe('42')
      expect(headers['Event-Name']).toBe('CHANNEL_CREATE')
    })
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd sip-bridge && bun test
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add sip-bridge/src/clients/esl-client.ts sip-bridge/src/clients/esl-client.test.ts
git commit -m "feat: ESL client for FreeSWITCH event socket protocol"
```

---

### Task 4: Kamailio JSONRPC Client

**Files:**
- Create: `sip-bridge/src/clients/kamailio-client.ts`
- Create: `sip-bridge/src/clients/kamailio-client.test.ts`

- [ ] **Step 1: Implement Kamailio JSONRPC client**

`sip-bridge/src/clients/kamailio-client.ts`:
```typescript
import type { BridgeClient, BridgeEvent, BridgeHealthStatus, OriginateParams } from '../bridge-client'

export interface KamailioConfig {
  jsonrpcUrl: string // e.g., http://kamailio:5060/jsonrpc
  dispatcherSetId?: number // default: 1
  pollIntervalMs?: number // default: 30000
}

export interface DispatcherEntry {
  uri: string
  flags: number
  priority: number
  attrs: string
  // 0 = inactive, 1 = active, 2 = probing
  state: number
}

/**
 * Kamailio JSONRPC client — implements BridgeClient for management only.
 *
 * Kamailio is a SIP proxy/LB, not a PBX — it doesn't generate call events.
 * The call control methods throw errors (use ARI or ESL for call control).
 * This client manages the dispatcher (load balancer) and monitors health.
 */
export class KamailioClient implements BridgeClient {
  readonly type = 'kamailio' as const
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private connected = false
  private eventHandler: ((event: BridgeEvent) => void) | null = null

  constructor(private config: KamailioConfig) {}

  async connect(): Promise<void> {
    // Verify connectivity
    const health = await this.healthCheck()
    if (!health.connected) throw new Error(`Kamailio not reachable: ${health.error}`)
    this.connected = true

    // Start polling dispatcher status
    const interval = this.config.pollIntervalMs ?? 30000
    this.pollTimer = setInterval(() => this.pollDispatcher(), interval)
    console.log(`[kamailio] Connected, polling every ${interval}ms`)
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  onEvent(handler: (event: BridgeEvent) => void): void {
    this.eventHandler = handler
  }

  // Call control — not supported by Kamailio (SIP proxy only)
  async originate(_params: OriginateParams): Promise<string> {
    throw new Error('Kamailio does not support call origination — use ARI or ESL client')
  }
  async hangup(_channelId: string): Promise<void> {
    throw new Error('Kamailio does not support call hangup — use ARI or ESL client')
  }
  async bridge(_id1: string, _id2: string): Promise<void> {
    throw new Error('Kamailio does not support call bridging — use ARI or ESL client')
  }
  async answer(_channelId: string): Promise<void> {
    throw new Error('Kamailio does not support call answer — use ARI or ESL client')
  }
  async record(_channelId: string, _filename: string): Promise<void> {
    throw new Error('Kamailio does not support recording — use ARI or ESL client')
  }
  async stopRecord(_channelId: string): Promise<void> {
    throw new Error('Kamailio does not support recording — use ARI or ESL client')
  }

  async healthCheck(): Promise<BridgeHealthStatus> {
    const start = Date.now()
    try {
      await this.jsonrpc('core.version')
      return { connected: true, latencyMs: Date.now() - start, type: 'kamailio' }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, type: 'kamailio', error: String(err) }
    }
  }

  // --- Kamailio-specific management ---

  async getDispatchers(): Promise<DispatcherEntry[]> {
    const result = await this.jsonrpc('dispatcher.list', { set: this.config.dispatcherSetId ?? 1 })
    // Parse dispatcher list response
    const records = (result as { result?: { records?: DispatcherEntry[] } })?.result?.records ?? []
    return records
  }

  async setDispatcherState(uri: string, state: 'active' | 'inactive'): Promise<void> {
    await this.jsonrpc('dispatcher.set_state', {
      state: state === 'active' ? 'a' : 'ip',
      group: this.config.dispatcherSetId ?? 1,
      address: uri,
    })
  }

  async reloadDispatchers(): Promise<void> {
    await this.jsonrpc('dispatcher.reload')
  }

  // --- Private ---

  private async jsonrpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.config.jsonrpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params: params ? [params] : [],
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Kamailio JSONRPC ${method}: HTTP ${res.status}`)
    const data = (await res.json()) as { result?: unknown; error?: { message?: string } }
    if (data.error) throw new Error(`Kamailio JSONRPC ${method}: ${data.error.message}`)
    return data.result
  }

  private async pollDispatcher(): Promise<void> {
    try {
      const entries = await this.getDispatchers()
      const active = entries.filter((e) => e.state === 1).length
      const total = entries.length
      if (active < total) {
        console.warn(`[kamailio] ${active}/${total} PBX instances active`)
      }
    } catch (err) {
      console.error('[kamailio] Dispatcher poll failed:', err)
    }
  }
}
```

- [ ] **Step 2: Write unit tests**

`sip-bridge/src/clients/kamailio-client.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test'
import { KamailioClient } from './kamailio-client'

describe('KamailioClient', () => {
  const client = new KamailioClient({ jsonrpcUrl: 'http://localhost:5060/jsonrpc' })

  test('type is kamailio', () => {
    expect(client.type).toBe('kamailio')
  })

  test('call control methods throw (SIP proxy only)', async () => {
    await expect(client.originate({ endpoint: 'test', callerId: '123' })).rejects.toThrow(
      'does not support call origination'
    )
    await expect(client.hangup('ch-1')).rejects.toThrow('does not support call hangup')
    await expect(client.bridge('ch-1', 'ch-2')).rejects.toThrow('does not support call bridging')
    await expect(client.answer('ch-1')).rejects.toThrow('does not support call answer')
    await expect(client.record('ch-1', 'file')).rejects.toThrow('does not support recording')
    await expect(client.stopRecord('ch-1')).rejects.toThrow('does not support recording')
  })

  test('isConnected returns false initially', () => {
    expect(client.isConnected()).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd sip-bridge && bun test
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add sip-bridge/src/clients/kamailio-client.ts sip-bridge/src/clients/kamailio-client.test.ts
git commit -m "feat: Kamailio JSONRPC client for dispatcher management"
```

---

### Task 5: Unified Entry Point + Webhook Sender + Health

**Files:**
- Create: `sip-bridge/src/index.ts`
- Create: `sip-bridge/src/webhook-sender.ts`
- Create: `sip-bridge/src/health.ts`
- Create: `sip-bridge/Dockerfile`

- [ ] **Step 1: Create webhook sender (shared event→HTTP translation)**

`sip-bridge/src/webhook-sender.ts`:
```typescript
import type { BridgeEvent } from './bridge-client'

export interface WebhookSenderConfig {
  workerWebhookUrl: string
  bridgeSecret: string
}

/**
 * Translates BridgeEvents into HTTP webhooks POSTed to the Llamenos server.
 * Shared by all protocol clients (ARI, ESL, Kamailio).
 */
export class WebhookSender {
  constructor(private config: WebhookSenderConfig) {}

  async sendEvent(event: BridgeEvent): Promise<void> {
    const endpoint = this.routeEvent(event)
    if (!endpoint) return

    const body = JSON.stringify({
      channelId: event.channelId,
      callSid: event.callSid ?? event.channelId,
      callerNumber: event.callerNumber,
      from: event.callerNumber,
      calledNumber: event.calledNumber,
      to: event.calledNumber,
      state: event.state,
      status: event.state,
      duration: event.duration,
      digit: event.digit,
      recordingName: event.recordingName,
      recordingSid: event.recordingName,
      recordingStatus: event.recordingStatus,
      timestamp: event.timestamp,
    })

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = await this.sign(`${timestamp}.${body}`)

    const url = `${this.config.workerWebhookUrl}${endpoint}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridge-Signature': signature,
          'X-Bridge-Timestamp': timestamp,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        console.error(`[webhook] ${endpoint} returned ${res.status}`)
      }
    } catch (err) {
      console.error(`[webhook] Failed to send ${event.type} to ${endpoint}:`, err)
    }
  }

  private routeEvent(event: BridgeEvent): string | null {
    switch (event.type) {
      case 'channel_create':
        return '/telephony/incoming'
      case 'channel_answer':
      case 'channel_hangup':
        return '/telephony/call-status'
      case 'record_stop':
        return '/telephony/voicemail-recording'
      case 'dtmf':
        return null // DTMF handled by mod_httapi/ARI gather, not webhooks
      default:
        return null
    }
  }

  private async sign(payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.config.bridgeSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
```

- [ ] **Step 2: Create health endpoint**

`sip-bridge/src/health.ts`:
```typescript
import type { BridgeClient, BridgeHealthStatus } from './bridge-client'
import type { KamailioClient } from './clients/kamailio-client'

export interface HealthReport {
  ok: boolean
  pbx: BridgeHealthStatus
  kamailio?: {
    enabled: boolean
    connected: boolean
    dispatchers?: number
    activeInstances?: number
  }
}

export async function getHealthReport(
  pbxClient: BridgeClient,
  kamailioClient?: KamailioClient
): Promise<HealthReport> {
  const pbx = await pbxClient.healthCheck()

  let kamailio: HealthReport['kamailio']
  if (kamailioClient) {
    const kamHealth = await kamailioClient.healthCheck()
    let dispatchers = 0
    let activeInstances = 0
    if (kamHealth.connected) {
      try {
        const entries = await kamailioClient.getDispatchers()
        dispatchers = entries.length
        activeInstances = entries.filter((e) => e.state === 1).length
      } catch { /* ignore */ }
    }
    kamailio = {
      enabled: true,
      connected: kamHealth.connected,
      dispatchers,
      activeInstances,
    }
  }

  return {
    ok: pbx.connected && (!kamailioClient || kamailio?.connected !== false),
    pbx,
    kamailio,
  }
}
```

- [ ] **Step 3: Create unified entry point**

`sip-bridge/src/index.ts`:
```typescript
import { AriClient } from './clients/ari-client'
import { EslClient } from './clients/esl-client'
import { KamailioClient } from './clients/kamailio-client'
import type { BridgeClient } from './bridge-client'
import { WebhookSender } from './webhook-sender'
import { getHealthReport } from './health'

// --- Config ---

const PBX_TYPE = process.env.PBX_TYPE ?? 'asterisk'
const BRIDGE_PORT = Number.parseInt(process.env.BRIDGE_PORT ?? '3001', 10)
const BRIDGE_BIND = process.env.BRIDGE_BIND ?? '0.0.0.0'
const WORKER_WEBHOOK_URL = process.env.WORKER_WEBHOOK_URL ?? 'http://localhost:3000'
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? 'dev-bridge-secret'
const KAMAILIO_ENABLED = process.env.KAMAILIO_ENABLED === 'true'

// --- Client selection ---

function createPbxClient(): BridgeClient {
  switch (PBX_TYPE) {
    case 'asterisk':
      return new AriClient({
        ariUrl: process.env.ARI_URL ?? 'ws://localhost:8088/ari/events',
        ariRestUrl: process.env.ARI_REST_URL ?? 'http://localhost:8088/ari',
        ariUsername: process.env.ARI_USERNAME ?? 'llamenos',
        ariPassword: process.env.ARI_PASSWORD ?? 'changeme',
      })
    case 'freeswitch':
      return new EslClient({
        eslHost: process.env.ESL_HOST ?? 'localhost',
        eslPort: Number.parseInt(process.env.ESL_PORT ?? '8021', 10),
        eslPassword: process.env.ESL_PASSWORD ?? 'ClueCon',
      })
    default:
      throw new Error(`Unknown PBX_TYPE: ${PBX_TYPE}. Must be 'asterisk' or 'freeswitch'.`)
  }
}

// --- Boot ---

const pbxClient = createPbxClient()
const webhook = new WebhookSender({ workerWebhookUrl: WORKER_WEBHOOK_URL, bridgeSecret: BRIDGE_SECRET })

let kamailioClient: KamailioClient | undefined
if (KAMAILIO_ENABLED) {
  kamailioClient = new KamailioClient({
    jsonrpcUrl: process.env.KAMAILIO_JSONRPC_URL ?? 'http://localhost:5060/jsonrpc',
    dispatcherSetId: Number.parseInt(process.env.KAMAILIO_DISPATCHER_SET_ID ?? '1', 10),
  })
}

// Wire events to webhook sender
pbxClient.onEvent((event) => {
  webhook.sendEvent(event).catch((err) => console.error('[bridge] Webhook send failed:', err))
})

// Connect
await pbxClient.connect()
if (kamailioClient) await kamailioClient.connect().catch((err) => console.warn('[kamailio] Optional connect failed:', err))

console.log(`[bridge] PBX type: ${PBX_TYPE}, Kamailio: ${KAMAILIO_ENABLED ? 'enabled' : 'disabled'}`)

// --- HTTP Server ---

const server = Bun.serve({
  port: BRIDGE_PORT,
  hostname: BRIDGE_BIND,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      const report = await getHealthReport(pbxClient, kamailioClient)
      return Response.json(report, { status: report.ok ? 200 : 503 })
    }

    // TODO: Port existing asterisk-bridge command endpoints (/ring, /hangup, /recordings/*, etc.)
    // These will be migrated in a follow-up task after verifying the bridge boots correctly.

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`[bridge] Listening on ${BRIDGE_BIND}:${BRIDGE_PORT}`)
```

- [ ] **Step 4: Create Dockerfile**

`sip-bridge/Dockerfile`:
```dockerfile
FROM oven/bun:1.3-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src/ src/
CMD ["bun", "run", "src/index.ts"]
```

- [ ] **Step 5: Run all sip-bridge tests**

```bash
cd sip-bridge && bun test
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add sip-bridge/src/index.ts sip-bridge/src/webhook-sender.ts sip-bridge/src/health.ts sip-bridge/Dockerfile
git commit -m "feat: unified sip-bridge entry point with webhook sender and health"
```

---

## Phase 2: FreeSWITCH Adapter (Tasks 6–10)

Server-side adapter that generates mod_httapi XML and integrates with the provider system.

### Task 6: FreeSWITCH Webhook Schemas

**Files:**
- Create: `src/shared/schemas/external/freeswitch-httapi.ts`

- [ ] **Step 1: Define Zod schemas for mod_httapi webhooks**

`src/shared/schemas/external/freeswitch-httapi.ts`:
```typescript
import { z } from 'zod/v4'

/**
 * FreeSWITCH mod_httapi sends POST requests with form-encoded data.
 * These schemas validate the incoming webhook payloads.
 */

/** mod_httapi POST body — sent when FreeSWITCH requests call instructions */
export const FreeSwitchHttapiRequestSchema = z.looseObject({
  // Channel identification
  'channel-uuid': z.string().optional(),
  'session-uuid': z.string().optional(),
  // Caller info
  'caller-caller-id-number': z.string().optional(),
  'caller-caller-id-name': z.string().optional(),
  'caller-destination-number': z.string().optional(),
  // Call state
  'channel-state': z.string().optional(),
  'call-direction': z.string().optional(),
  // DTMF input (from <bind> digit capture)
  exten: z.string().optional(),
  // Custom variables
  variable_llamenos_phase: z.string().optional(),
  variable_llamenos_hub: z.string().optional(),
  variable_llamenos_callsid: z.string().optional(),
  variable_llamenos_lang: z.string().optional(),
})
export type FreeSwitchHttapiRequest = z.infer<typeof FreeSwitchHttapiRequestSchema>

/** Bridge webhook event — sent by sip-bridge ESL client (same shape as AsteriskBridgeWebhook) */
export const FreeSwitchBridgeWebhookSchema = z.looseObject({
  channelId: z.string().optional(),
  callSid: z.string().optional(),
  callerNumber: z.string().optional(),
  from: z.string().optional(),
  calledNumber: z.string().optional(),
  to: z.string().optional(),
  state: z.string().optional(),
  status: z.string().optional(),
  duration: z.number().optional(),
  recordingName: z.string().optional(),
  recordingSid: z.string().optional(),
  recordingStatus: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
})
export type FreeSwitchBridgeWebhook = z.infer<typeof FreeSwitchBridgeWebhookSchema>
```

- [ ] **Step 2: Add to schemas barrel export**

In `src/shared/schemas/external/index.ts` (or the barrel file), add:
```typescript
export * from './freeswitch-httapi'
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add src/shared/schemas/external/freeswitch-httapi.ts src/shared/schemas/external/index.ts
git commit -m "feat: Zod schemas for FreeSWITCH mod_httapi webhooks"
```

---

### Task 7: FreeSWITCH Config Schema + Type Registration

**Files:**
- Modify: `src/shared/schemas/providers.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add FreeSwitchConfigSchema to providers.ts**

Add after the `BandwidthConfigSchema`:
```typescript
export const FreeSwitchConfigSchema = BaseProviderSchema.extend({
  type: z.literal('freeswitch'),
  eslHost: z.string().default('localhost'),
  eslPort: z.number().default(8021),
  eslPassword: z.string().min(1),
  httapiUrl: z.string().url().optional(),
  bridgeCallbackUrl: z.string().url(),
  bridgeSecret: z.string().min(8),
  webrtcEnabled: z.boolean().optional(),
  wssPort: z.number().optional(),
})
export type FreeSwitchConfig = z.infer<typeof FreeSwitchConfigSchema>
```

Update `TelephonyProviderConfigSchema` discriminated union:
```typescript
export const TelephonyProviderConfigSchema = z.discriminatedUnion('type', [
  TwilioConfigSchema,
  SignalWireConfigSchema,
  VonageConfigSchema,
  PlivoConfigSchema,
  AsteriskConfigSchema,
  TelnyxConfigSchema,
  BandwidthConfigSchema,
  FreeSwitchConfigSchema, // ← add
])
```

- [ ] **Step 2: Add 'freeswitch' to TelephonyProviderType**

In `src/shared/types.ts`, update:
```typescript
export type TelephonyProviderType =
  | 'twilio'
  | 'signalwire'
  | 'vonage'
  | 'plivo'
  | 'asterisk'
  | 'telnyx'
  | 'bandwidth'
  | 'freeswitch' // ← add
```

Add to `TELEPHONY_PROVIDER_LABELS`:
```typescript
export const TELEPHONY_PROVIDER_LABELS: Record<TelephonyProviderType, string> = {
  twilio: 'Twilio',
  signalwire: 'SignalWire',
  vonage: 'Vonage',
  plivo: 'Plivo',
  asterisk: 'Asterisk',
  telnyx: 'Telnyx',
  bandwidth: 'Bandwidth',
  freeswitch: 'FreeSWITCH', // ← add
}
```

Add FreeSWITCH fields to `TelephonyProviderDraft`:
```typescript
export interface TelephonyProviderDraft {
  // ... existing fields ...
  // FreeSWITCH
  eslHost?: string
  eslPort?: number
  eslPassword?: string
  httapiUrl?: string
  bridgeSecret?: string  // may already exist from Asterisk
  webrtcEnabled?: boolean
  wssPort?: number
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```
Expected: May have errors in `createAdapterFromConfig` (needs FreeSWITCH case) and `TELEPHONY_CAPABILITIES` (needs registration). Those are fixed in Tasks 9 and 10.

- [ ] **Step 4: Commit**

```bash
git add src/shared/schemas/providers.ts src/shared/types.ts
git commit -m "feat: FreeSWITCH config schema and type registration"
```

---

### Task 8: FreeSWITCH Adapter — mod_httapi XML Generation

**Files:**
- Create: `src/server/telephony/freeswitch.ts`
- Create: `src/server/telephony/freeswitch.test.ts`

- [ ] **Step 1: Write failing tests for mod_httapi XML output**

`src/server/telephony/freeswitch.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test'
import { FreeSwitchAdapter } from './freeswitch'

describe('FreeSwitchAdapter', () => {
  const adapter = new FreeSwitchAdapter(
    'ws://localhost:8021',
    'localhost',
    8021,
    'ClueCon',
    '+15559999999',
    'http://localhost:3001',
    'test-secret'
  )

  describe('handleLanguageMenu', () => {
    test('returns mod_httapi XML with playback and bind for digit capture', async () => {
      const result = await adapter.handleLanguageMenu({
        callSid: 'CA-001',
        callerNumber: '+15551234567',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['en', 'es'],
      })
      expect(result.contentType).toBe('text/xml')
      expect(result.body).toContain('xml/freeswitch-httapi')
      expect(result.body).toContain('<playback')
      expect(result.body).toContain('<bind')
      expect(result.body).toContain('~\\d{1}')
    })
  })

  describe('handleIncomingCall', () => {
    test('returns voicemail XML with record tag when captcha disabled', async () => {
      const result = await adapter.handleIncomingCall({
        callSid: 'CA-001',
        callerNumber: '+15551234567',
        voiceCaptchaEnabled: false,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
      })
      expect(result.contentType).toBe('text/xml')
      expect(result.body).toContain('xml/freeswitch-httapi')
    })

    test('returns hangup XML when rate limited', async () => {
      const result = await adapter.handleIncomingCall({
        callSid: 'CA-001',
        callerNumber: '+15551234567',
        voiceCaptchaEnabled: false,
        rateLimited: true,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
      })
      expect(result.body).toContain('<hangup')
    })

    test('returns captcha XML with bind for 4 digits', async () => {
      const result = await adapter.handleIncomingCall({
        callSid: 'CA-001',
        callerNumber: '+15551234567',
        voiceCaptchaEnabled: true,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test Hotline',
        captchaDigits: '1234',
      })
      expect(result.body).toContain('<bind')
      expect(result.body).toContain('~\\d{4}')
    })
  })

  describe('handleVoicemail', () => {
    test('returns record XML with callback action', async () => {
      const result = await adapter.handleVoicemail({
        callSid: 'CA-001',
        callerLanguage: 'en',
        callbackUrl: 'http://localhost:3000',
        maxRecordingSeconds: 120,
      })
      expect(result.body).toContain('<record')
      expect(result.body).toContain('limit="120"')
    })
  })

  describe('rejectCall', () => {
    test('returns hangup with CALL_REJECTED cause', () => {
      const result = adapter.rejectCall()
      expect(result.body).toContain('<hangup')
      expect(result.body).toContain('CALL_REJECTED')
    })
  })

  describe('handleUnavailable', () => {
    test('returns playback + hangup', () => {
      const result = adapter.handleUnavailable('en')
      expect(result.body).toContain('xml/freeswitch-httapi')
      expect(result.body).toContain('<hangup')
    })
  })

  describe('emptyResponse', () => {
    test('returns empty httapi document', () => {
      const result = adapter.emptyResponse()
      expect(result.contentType).toBe('text/xml')
      expect(result.body).toContain('xml/freeswitch-httapi')
    })
  })

  describe('webhook parsing', () => {
    test('parseIncomingWebhook extracts call info from JSON body', async () => {
      const body = JSON.stringify({
        channelId: 'uuid-001',
        callSid: 'uuid-001',
        callerNumber: '+15551234567',
        calledNumber: '+15559999999',
        state: 'Ring',
      })
      const request = new Request('http://localhost/telephony/incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const result = await adapter.parseIncomingWebhook(request)
      expect(result.callSid).toBe('uuid-001')
      expect(result.callerNumber).toBe('+15551234567')
    })

    test('parseRecordingWebhook extracts recording info', async () => {
      const body = JSON.stringify({
        channelId: 'uuid-001',
        recordingName: 'vm-001',
        recordingStatus: 'done',
      })
      const request = new Request('http://localhost/telephony/voicemail-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const result = await adapter.parseRecordingWebhook(request)
      expect(result.status).toBe('completed')
      expect(result.recordingSid).toBe('vm-001')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/server/telephony/freeswitch.test.ts
```
Expected: FAIL — `FreeSwitchAdapter` not found.

- [ ] **Step 3: Implement FreeSwitchAdapter**

`src/server/telephony/freeswitch.ts` — full implementation (~450 lines). This follows the Asterisk adapter pattern: JSON command format for bridge communication, XML for mod_httapi responses.

```typescript
/**
 * FreeSwitchAdapter — FreeSWITCH mod_httapi implementation of TelephonyAdapter.
 *
 * Generates mod_httapi XML responses for call flow control.
 * Delegates real-time call control (originate, hangup, bridge) to the sip-bridge
 * via BridgeClient, same pattern as AsteriskAdapter.
 *
 * mod_httapi XML format:
 *   <document type="xml/freeswitch-httapi">
 *     <params/>
 *     <work>
 *       <playback file="..." ><bind strip="#">~\d{1}</bind></playback>
 *       <record file="..." limit="120" action="callback-url"/>
 *       <hangup cause="NORMAL_CLEARING"/>
 *       <execute application="bridge" data="..."/>
 *     </work>
 *   </document>
 */

import { DEFAULT_LANGUAGE } from '../../shared/languages'
import type { ConnectionTestResult } from '../../shared/types'
import { IVR_PROMPTS, getPrompt, getVoicemailThanks } from '../../shared/voice-prompts'
import type {
  AudioUrlMap,
  CallAnsweredParams,
  CaptchaResponseParams,
  IncomingCallParams,
  LanguageMenuParams,
  RingUsersParams,
  TelephonyAdapter,
  TelephonyResponse,
  VoicemailParams,
  WebhookCallInfo,
  WebhookCallStatus,
  WebhookDigits,
  WebhookQueueResult,
  WebhookQueueWait,
  WebhookRecordingStatus,
  WebhookVerificationResult,
} from './adapter'
import { BridgeClient } from './bridge-client'

/** mod_flite voice (basic TTS fallback — users should record custom audio) */
const FLITE_VOICE = 'slt'

function hubQueryParam(hubId?: string): string {
  return hubId ? `&hub=${encodeURIComponent(hubId)}` : ''
}

/** Wrap work content in a mod_httapi document */
function httapiDoc(work: string, params?: string): string {
  return `<document type="xml/freeswitch-httapi">
  <params>${params ?? ''}</params>
  <work>${work}</work>
</document>`
}

/** Generate TTS or custom audio playback */
function audioOrSpeak(text: string, audioUrl?: string): string {
  if (audioUrl) {
    return `<playback file="${escapeXml(audioUrl)}"/>`
  }
  return `<execute application="speak" data="flite|${FLITE_VOICE}|${escapeXml(text)}"/>`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export class FreeSwitchAdapter implements TelephonyAdapter {
  private bridge: BridgeClient

  constructor(
    private eslUrl: string,
    private eslHost: string,
    private eslPort: number,
    private eslPassword: string,
    private phoneNumber: string,
    private bridgeCallbackUrl: string,
    private bridgeSecret: string
  ) {
    this.bridge = new BridgeClient(bridgeCallbackUrl, bridgeSecret)
  }

  // --- IVR Methods ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const { callSid, callerNumber, hotlineName, enabledLanguages, hubId } = params
    const callbackUrl = `/telephony/language-selected?callSid=${callSid}${hubQueryParam(hubId)}`

    // Build TTS prompt listing each language option
    const langPrompts = enabledLanguages
      .map((lang, i) => `Press ${i + 1} for ${lang}`)
      .join('. ')
    const prompt = `Welcome to ${hotlineName}. ${langPrompts}.`

    const work = `
    <playback file="silence_stream://500" input-timeout="8000" action="${escapeXml(callbackUrl)}">
      <bind strip="#">~\\d{1}</bind>
    </playback>
    ${audioOrSpeak(prompt)}`

    return this.xml(httapiDoc(work))
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const { callSid, callerNumber, voiceCaptchaEnabled, rateLimited, callerLanguage, hotlineName, audioUrls, captchaDigits, hubId } = params
    const lang = callerLanguage || DEFAULT_LANGUAGE

    if (rateLimited) {
      const msg = getPrompt('rateLimited', lang) || 'We are experiencing high call volume. Please try again later.'
      const work = `${audioOrSpeak(msg, audioUrls?.[`rateLimited:${lang}`])}
      <hangup cause="NORMAL_CLEARING"/>`
      return this.xml(httapiDoc(work))
    }

    if (voiceCaptchaEnabled && captchaDigits) {
      const captchaUrl = `/telephony/captcha?callSid=${callSid}&lang=${lang}${hubQueryParam(hubId)}`
      const msg = getPrompt('captcha', lang, { digits: captchaDigits.split('').join(', ') }) ||
        `Please enter the digits: ${captchaDigits.split('').join(', ')}`
      const work = `
      <playback file="silence_stream://200" input-timeout="10000" action="${escapeXml(captchaUrl)}">
        <bind strip="#">~\\d{4}</bind>
      </playback>
      ${audioOrSpeak(msg, audioUrls?.[`captcha:${lang}`])}`
      return this.xml(httapiDoc(work))
    }

    // Normal flow — connecting message + queue/hold
    const msg = getPrompt('connecting', lang) || 'Please hold while we connect you.'
    const holdUrl = `/telephony/wait-music?callSid=${callSid}&lang=${lang}${hubQueryParam(hubId)}`
    const work = `${audioOrSpeak(msg, audioUrls?.[`connecting:${lang}`])}
    <playback file="local_stream://moh" loops="0"/>`
    return this.xml(httapiDoc(work))
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const { callSid, digits, expectedDigits, callerLanguage, hubId, remainingAttempts, newCaptchaDigits } = params
    const lang = callerLanguage || DEFAULT_LANGUAGE

    if (digits === expectedDigits) {
      // Success — continue to call flow
      const msg = getPrompt('connecting', lang) || 'Verified. Connecting you now.'
      const work = `${audioOrSpeak(msg)}
      <playback file="local_stream://moh" loops="0"/>`
      return this.xml(httapiDoc(work))
    }

    if (remainingAttempts && remainingAttempts > 0 && newCaptchaDigits) {
      // Retry
      const captchaUrl = `/telephony/captcha?callSid=${callSid}&lang=${lang}${hubQueryParam(hubId)}`
      const msg = `Incorrect. Please enter the digits: ${newCaptchaDigits.split('').join(', ')}`
      const work = `
      <playback file="silence_stream://200" input-timeout="10000" action="${escapeXml(captchaUrl)}">
        <bind strip="#">~\\d{4}</bind>
      </playback>
      ${audioOrSpeak(msg)}`
      return this.xml(httapiDoc(work))
    }

    // Failed
    const work = `${audioOrSpeak('Verification failed. Goodbye.')}
    <hangup cause="CALL_REJECTED"/>`
    return this.xml(httapiDoc(work))
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const { parentCallSid, callbackUrl, userPubkey, hubId } = params
    const recordingUrl = `${callbackUrl}/telephony/recording-status?parentCallSid=${parentCallSid}&pubkey=${userPubkey}${hubQueryParam(hubId)}`
    // Bridge the caller's channel to the volunteer's channel
    const work = `<execute application="bridge" data="{recording_url=${escapeXml(recordingUrl)}}user/${parentCallSid}"/>`
    return this.xml(httapiDoc(work))
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const { callSid, callerLanguage, callbackUrl, audioUrls, maxRecordingSeconds, hubId } = params
    const lang = callerLanguage || DEFAULT_LANGUAGE
    const maxSeconds = maxRecordingSeconds ?? 120
    const recordCallbackUrl = `${callbackUrl}/telephony/voicemail-recording?callSid=${callSid}${hubQueryParam(hubId)}`
    const msg = getPrompt('voicemail', lang) || 'Nobody is available. Please leave a message after the beep.'

    const work = `${audioOrSpeak(msg, audioUrls?.[`voicemail:${lang}`])}
    <execute application="sleep" data="500"/>
    <execute application="playback" data="tone_stream://%(250,0,800)"/>
    <record file="/tmp/recordings/${callSid}.wav" name="voicemail" limit="${maxSeconds}" action="${escapeXml(recordCallbackUrl)}">
      <bind strip="#">~#</bind>
    </record>`
    return this.xml(httapiDoc(work))
  }

  async handleWaitMusic(lang: string, audioUrls?: AudioUrlMap, queueTime?: number, queueTimeout?: number): Promise<TelephonyResponse> {
    const timeout = queueTimeout ?? 120
    if (queueTime && queueTime >= timeout) {
      // Queue timeout — leave to trigger voicemail
      return this.xml(httapiDoc('<hangup cause="NORMAL_CLEARING"/>'))
    }
    const holdAudio = audioUrls?.[`holdMusic:${lang}`] ?? 'local_stream://moh'
    const work = `<playback file="${escapeXml(holdAudio)}" loops="0"/>`
    return this.xml(httapiDoc(work))
  }

  rejectCall(): TelephonyResponse {
    return this.xml(httapiDoc('<hangup cause="CALL_REJECTED"/>'))
  }

  handleVoicemailComplete(lang: string): TelephonyResponse {
    const msg = getVoicemailThanks(lang) || 'Thank you. Goodbye.'
    const work = `${audioOrSpeak(msg)}
    <hangup cause="NORMAL_CLEARING"/>`
    return this.xml(httapiDoc(work))
  }

  handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse {
    const msg = getPrompt('unavailable', lang) || 'We are currently unavailable. Please try again later.'
    const work = `${audioOrSpeak(msg, audioUrls?.[`unavailable:${lang}`])}
    <hangup cause="NORMAL_CLEARING"/>`
    return this.xml(httapiDoc(work))
  }

  emptyResponse(): TelephonyResponse {
    return this.xml(httapiDoc(''))
  }

  // --- Call Control (via bridge) ---

  async hangupCall(callSid: string): Promise<void> {
    await this.bridge.request('POST', '/hangup', { channelId: callSid })
  }

  async ringUsers(params: RingUsersParams): Promise<string[]> {
    const result = await this.bridge.request('POST', '/ring', {
      parentCallSid: params.callSid,
      callerNumber: params.callerNumber,
      users: params.users.map((u) => ({
        pubkey: u.pubkey,
        phone: u.phone,
        browserIdentity: u.browserIdentity,
      })),
      callbackUrl: params.callbackUrl,
      hubId: params.hubId,
    })
    return (result as { channelIds?: string[] })?.channelIds ?? []
  }

  async cancelRinging(callSids: string[], exceptSid?: string): Promise<void> {
    await this.bridge.request('POST', '/cancel-ringing', { callSids, exceptSid })
  }

  // --- Webhook Validation ---

  async validateWebhook(request: Request): Promise<boolean> {
    // Same HMAC-SHA256 pattern as Asterisk adapter (bridge signs all webhooks)
    const signature = request.headers.get('X-Bridge-Signature')
    if (!signature) return false
    const body = await request.clone().text()
    const timestamp = request.headers.get('X-Bridge-Timestamp') || ''
    const tsSeconds = Number.parseInt(timestamp, 10)
    if (Number.isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) return false

    const payload = `${timestamp}.${body}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.bridgeSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    const expectedSig = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')

    if (signature.length !== expectedSig.length) return false
    let result = 0
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i)
    }
    return result === 0
  }

  // --- Recording Management (via bridge) ---

  async getCallRecording(callSid: string): Promise<ArrayBuffer | null> {
    return this.getRecordingAudio(callSid)
  }

  async getRecordingAudio(recordingSid: string): Promise<ArrayBuffer | null> {
    const result = await this.bridge.request('GET', `/recordings/${recordingSid}`)
    if (result && typeof result === 'object' && 'audio' in result) {
      const base64 = (result as { audio: string }).audio
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes.buffer
    }
    return null
  }

  async deleteRecording(recordingSid: string): Promise<void> {
    await this.bridge.request('DELETE', `/recordings/${recordingSid}`).catch(() => {})
  }

  // --- Webhook Parsing (JSON from sip-bridge ESL client) ---

  async parseIncomingWebhook(request: Request): Promise<WebhookCallInfo> {
    const data = await request.json()
    return {
      callSid: data.channelId || data.callSid || '',
      callerNumber: data.callerNumber || data.from || '',
      calledNumber: data.calledNumber || data.to || undefined,
    }
  }

  async parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits> {
    const data = await request.json()
    return {
      callSid: data.channelId || data.callSid || '',
      callerNumber: data.callerNumber || data.from || '',
      digits: data.digits || data.exten || '',
    }
  }

  async parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }> {
    const data = await request.json()
    return {
      digits: data.digits || data.exten || '',
      callerNumber: data.callerNumber || data.from || '',
    }
  }

  async parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus> {
    const data = await request.json()
    const state = (data.state || data.status || '').toLowerCase()
    const statusMap: Record<string, WebhookCallStatus['status']> = {
      ring: 'ringing',
      up: 'answered',
      hangup: 'completed',
      busy: 'busy',
      failed: 'failed',
    }
    return { status: statusMap[state] ?? 'completed' }
  }

  async parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait> {
    const data = await request.json()
    return { queueTime: data.queueTime ?? 0 }
  }

  async parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult> {
    const data = await request.json()
    return { result: data.result ?? 'hangup' }
  }

  async parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus> {
    const data = await request.json()
    return {
      status: data.recordingStatus === 'done' ? 'completed' : 'failed',
      recordingSid: data.recordingName || data.recordingSid,
      callSid: data.channelId || data.callSid,
    }
  }

  // --- Connection Testing ---

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const res = await fetch(`${this.bridgeCallbackUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `Bridge HTTP ${res.status}`, errorType: 'network_error' }
      const data = (await res.json()) as { ok?: boolean; pbx?: { connected?: boolean } }
      if (!data.ok || !data.pbx?.connected) {
        return { connected: false, latencyMs, error: 'Bridge connected but PBX not reachable', errorType: 'network_error' }
      }
      return { connected: true, latencyMs }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  }

  async verifyWebhookConfig(phoneNumber: string, expectedBaseUrl: string): Promise<WebhookVerificationResult> {
    // FreeSWITCH webhook config is in dialplan XML, not verifiable via API
    return { configured: true, warning: 'FreeSWITCH webhook config must be verified in dialplan XML' }
  }

  // --- Private ---

  private xml(body: string): TelephonyResponse {
    return { contentType: 'text/xml', body }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/server/telephony/freeswitch.test.ts
```
Expected: All tests pass.

- [ ] **Step 5: Run full typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/telephony/freeswitch.ts src/server/telephony/freeswitch.test.ts
git commit -m "feat: FreeSWITCH adapter — mod_httapi XML generation + bridge integration"
```

---

### Task 9: FreeSWITCH Capabilities + Factory Registration

**Files:**
- Create: `src/server/telephony/freeswitch-capabilities.ts`
- Modify: `src/server/telephony/capabilities.ts`
- Modify: `src/server/lib/adapters.ts`

- [ ] **Step 1: Create capabilities descriptor**

`src/server/telephony/freeswitch-capabilities.ts`:
```typescript
import type { FreeSwitchConfig } from '@shared/schemas/providers'
import { FreeSwitchConfigSchema } from '@shared/schemas/providers'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

export const freeswitchCapabilities: ProviderCapabilities<FreeSwitchConfig> = {
  type: 'freeswitch',
  displayName: 'FreeSWITCH',
  description: 'Self-hosted open-source PBX with mod_httapi call control and ESL real-time events',
  credentialSchema: FreeSwitchConfigSchema,
  supportsOAuth: false,
  supportsSms: false,
  supportsSip: true,
  supportsWebRtc: true,
  supportsNumberProvisioning: false,
  supportsWebhookAutoConfig: false,

  async testConnection(config: FreeSwitchConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const url = `${config.bridgeCallbackUrl}/health`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      const latencyMs = Date.now() - start
      if (!res.ok) return { connected: false, latencyMs, error: `HTTP ${res.status}`, errorType: 'network_error' }
      const data = (await res.json()) as { ok?: boolean }
      return data.ok
        ? { connected: true, latencyMs }
        : { connected: false, latencyMs, error: 'Bridge unhealthy', errorType: 'network_error' }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  },

  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/telephony/call-status${qs}`,
    }
  },
}
```

- [ ] **Step 2: Register in capabilities registry**

In `src/server/telephony/capabilities.ts`, add import and registry entry:
```typescript
import { freeswitchCapabilities } from './freeswitch-capabilities'

export const TELEPHONY_CAPABILITIES: Record<TelephonyProviderType, ProviderCapabilities> = {
  // ... existing entries ...
  freeswitch: freeswitchCapabilities,
}
```

- [ ] **Step 3: Register in adapter factory**

In `src/server/lib/adapters.ts`, add import and case:
```typescript
import { FreeSwitchAdapter } from '../telephony/freeswitch'

// In createAdapterFromConfig:
    case 'freeswitch': {
      if (!config.eslPassword || !config.bridgeCallbackUrl)
        throw new AppError(500, 'FreeSWITCH config missing eslPassword or bridgeCallbackUrl')
      return new FreeSwitchAdapter(
        `ws://${config.eslHost ?? 'localhost'}:${config.eslPort ?? 8021}`,
        config.eslHost ?? 'localhost',
        config.eslPort ?? 8021,
        config.eslPassword,
        config.phoneNumber,
        config.bridgeCallbackUrl,
        config.bridgeSecret ?? config.eslPassword
      )
    }
```

- [ ] **Step 4: Run typecheck and build**

```bash
bun run typecheck && bun run build
```
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/telephony/freeswitch-capabilities.ts src/server/telephony/capabilities.ts src/server/lib/adapters.ts
git commit -m "feat: register FreeSWITCH in capabilities registry and adapter factory"
```

---

### Task 10: Simulation Tests + UI Provider Count

**Files:**
- Modify: `tests/helpers/simulation.ts`
- Modify: `tests/api/simulation-telephony.spec.ts`
- Modify: `tests/ui/telephony-provider.spec.ts`

- [ ] **Step 1: Add FreeSWITCH payload builders to simulation helpers**

In `tests/helpers/simulation.ts`:

Add `'freeswitch'` to `TelephonyProvider` type:
```typescript
export type TelephonyProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'freeswitch'
```

Add FreeSWITCH cases to `buildIncomingCallPayload`, `buildCallStatusPayload`, and `buildRecordingPayload`. FreeSWITCH uses JSON format (same as Asterisk bridge):
```typescript
    case 'freeswitch':
      return {
        contentType: 'application/json',
        body: JSON.stringify({
          channelId: callSid,
          callSid: callSid,
          callerNumber: from,
          from: from,
          calledNumber: to,
          to: to,
          state: 'Ring',
        }),
      }
```

(Repeat for status and recording payloads — same JSON format as Asterisk case.)

- [ ] **Step 2: Add 'freeswitch' to simulation test PROVIDERS array**

In `tests/api/simulation-telephony.spec.ts`:
```typescript
const PROVIDERS = ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk', 'freeswitch'] as const

// Add response pattern:
const RESPONSE_PATTERNS = {
  // ... existing ...
  freeswitch: { contentType: /json|xml/i, bodyPattern: /channel|endpoint|application|<document/i },
}
```

- [ ] **Step 3: Update UI provider count**

In `tests/ui/telephony-provider.spec.ts`, update the provider count assertion:
```typescript
await expect(options).toHaveCount(8)  // was 7, now includes FreeSWITCH
```

Add FreeSWITCH assertion:
```typescript
await expect(options.nth(7)).toContainText('FreeSWITCH')
```

- [ ] **Step 4: Run API simulation tests**

```bash
bunx playwright test tests/api/simulation-telephony.spec.ts --project=api --workers=1
```
Expected: All providers pass (FreeSWITCH returns 200 with TestAdapter or 404).

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/simulation.ts tests/api/simulation-telephony.spec.ts tests/ui/telephony-provider.spec.ts
git commit -m "feat: FreeSWITCH simulation tests and UI provider count update"
```

---

## Phase 3: Kamailio Deployment (Task 11)

Infrastructure-only — Ansible role and Docker Compose integration.

### Task 11: Kamailio Ansible Role + Docker Compose

**Files:**
- Create: `deploy/ansible/roles/kamailio/tasks/main.yml`
- Create: `deploy/ansible/roles/kamailio/templates/kamailio.cfg.j2`
- Create: `deploy/ansible/roles/kamailio/defaults/main.yml`
- Modify: `deploy/docker/docker-compose.yml` (add kamailio service profile)
- Modify: `deploy/ansible/demo_vars.example.yml` (add kamailio_enabled)

- [ ] **Step 1: Create Ansible role defaults**

`deploy/ansible/roles/kamailio/defaults/main.yml`:
```yaml
kamailio_enabled: false
kamailio_image: kamailio/kamailio:5.7
kamailio_sip_port: 5060
kamailio_sip_tls_port: 5061
kamailio_jsonrpc_port: 5060
kamailio_dispatcher_set_id: 1
kamailio_pbx_instances: []
# Example:
# kamailio_pbx_instances:
#   - uri: "sip:freeswitch1:5060"
#     priority: 0
#   - uri: "sip:freeswitch2:5060"
#     priority: 1
```

- [ ] **Step 2: Create Kamailio config template**

`deploy/ansible/roles/kamailio/templates/kamailio.cfg.j2`:
```
#!KAMAILIO
# Llamenos SIP proxy/load balancer

####### Global Parameters #########
debug=2
log_stderror=no
memdbg=5
memlog=5
children=4
port={{ kamailio_sip_port }}
{% if kamailio_sip_tls_port %}
enable_tls=yes
tls_port_no={{ kamailio_sip_tls_port }}
{% endif %}

####### Modules Section ########
loadmodule "jsonrpcs.so"
loadmodule "kex.so"
loadmodule "sl.so"
loadmodule "tm.so"
loadmodule "rr.so"
loadmodule "maxfwd.so"
loadmodule "sanity.so"
loadmodule "dispatcher.so"
loadmodule "nathelper.so"

####### Module Parameters ########
# JSONRPC for management
modparam("jsonrpcs", "pretty_format", 1)
modparam("jsonrpcs", "transport", 1)  # HTTP transport

# Dispatcher — load balancing
modparam("dispatcher", "list_file", "/etc/kamailio/dispatcher.list")
modparam("dispatcher", "ds_ping_interval", 30)
modparam("dispatcher", "ds_ping_method", "OPTIONS")
modparam("dispatcher", "ds_probing_mode", 1)

####### Routing Logic ########
request_route {
    # Max forwards check
    if (!mf_process_maxfwd_header("10")) {
        sl_send_reply("483", "Too Many Hops");
        exit;
    }

    # Sanity checks
    if (!sanity_check("1511", "7")) {
        xlog("Malformed SIP message from $si:$sp\n");
        exit;
    }

    # Record route for in-dialog requests
    if (is_method("INVITE|ACK|BYE|CANCEL|PRACK|UPDATE")) {
        record_route();
    }

    # Dispatch to PBX instances
    if (is_method("INVITE")) {
        if (!ds_select_dst("{{ kamailio_dispatcher_set_id }}", "4")) {
            sl_send_reply("503", "Service Unavailable");
            exit;
        }
        t_on_failure("PBX_FAILOVER");
    }

    route(RELAY);
}

route[RELAY] {
    if (!t_relay()) {
        sl_reply_error();
    }
}

failure_route[PBX_FAILOVER] {
    if (t_is_canceled()) exit;
    if (t_check_status("5[0-9][0-9]|408")) {
        # Mark instance as failed, try next
        ds_mark_dst("ip");
        if (ds_next_dst()) {
            t_on_failure("PBX_FAILOVER");
            route(RELAY);
        } else {
            sl_send_reply("503", "All PBX instances unavailable");
        }
    }
}
```

- [ ] **Step 3: Create dispatcher list template**

`deploy/ansible/roles/kamailio/templates/dispatcher.list.j2`:
```
# Dispatcher set {{ kamailio_dispatcher_set_id }} — PBX instances
{% for instance in kamailio_pbx_instances %}
{{ kamailio_dispatcher_set_id }} {{ instance.uri }} 0 {{ instance.priority | default(0) }}
{% endfor %}
```

- [ ] **Step 4: Create Ansible tasks**

`deploy/ansible/roles/kamailio/tasks/main.yml`:
```yaml
---
- name: Create Kamailio config directory
  ansible.builtin.file:
    path: /opt/llamenos/kamailio
    state: directory
    mode: "0755"

- name: Template Kamailio config
  ansible.builtin.template:
    src: kamailio.cfg.j2
    dest: /opt/llamenos/kamailio/kamailio.cfg
    mode: "0644"
  notify: restart kamailio

- name: Template dispatcher list
  ansible.builtin.template:
    src: dispatcher.list.j2
    dest: /opt/llamenos/kamailio/dispatcher.list
    mode: "0644"
  notify: restart kamailio
```

- [ ] **Step 5: Add Kamailio to Docker Compose (profile)**

In `deploy/docker/docker-compose.yml`, add:
```yaml
  kamailio:
    image: kamailio/kamailio:5.7
    profiles:
      - kamailio
    ports:
      - "${KAMAILIO_SIP_PORT:-5060}:5060/udp"
      - "${KAMAILIO_TLS_PORT:-5061}:5061"
    volumes:
      - ./kamailio/kamailio.cfg:/etc/kamailio/kamailio.cfg:ro
      - ./kamailio/dispatcher.list:/etc/kamailio/dispatcher.list:ro
    restart: unless-stopped
```

- [ ] **Step 6: Update demo_vars.example.yml**

Add:
```yaml
# Kamailio SIP proxy/load balancer (optional, for HA)
kamailio_enabled: false
# kamailio_pbx_instances:
#   - uri: "sip:freeswitch:5060"
```

- [ ] **Step 7: Commit**

```bash
git add deploy/ansible/roles/kamailio/ deploy/docker/docker-compose.yml deploy/ansible/demo_vars.example.yml
git commit -m "feat: Kamailio Ansible role and Docker Compose profile"
```

---

## Phase 4: Migration + Cleanup (Task 12)

### Task 12: Migrate asterisk-bridge References + Update CI

**Files:**
- Modify: `.github/workflows/ci.yml` (asterisk-bridge → sip-bridge)
- Modify: `deploy/docker/docker-compose.yml` (bridge service name)
- Modify: `deploy/ansible/` (bridge role references)
- Modify: `CLAUDE.md` (documentation references)

- [ ] **Step 1: Update CI workflow**

In `.github/workflows/ci.yml`, replace all `asterisk-bridge` references with `sip-bridge`:
- `cd asterisk-bridge && bun install` → `cd sip-bridge && bun install`
- Bridge startup commands
- Health check URLs

- [ ] **Step 2: Update Docker Compose bridge service**

Rename the bridge service from `asterisk-bridge` to `sip-bridge` and add `PBX_TYPE` env var.

- [ ] **Step 3: Verify existing Asterisk tests still pass**

```bash
bunx playwright test --project=api --workers=6
bun test src/server/telephony/asterisk*
```
Expected: All pass — ARI client behavior is preserved.

- [ ] **Step 4: Run full test suite**

```bash
bun run typecheck && bun run build && bunx playwright test --project=api --workers=6
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml deploy/ CLAUDE.md
git commit -m "chore: migrate asterisk-bridge → sip-bridge in CI and deployment configs"
```

---

## Phase 5: SipBridgeAdapter Base Class (Task 13)

Extract shared bridge communication into a base class so AsteriskAdapter and FreeSwitchAdapter don't duplicate ~200 lines of bridge HTTP client, HMAC validation, recording management, and call control delegation.

### Task 13: SipBridgeAdapter Abstract Base Class

**Files:**
- Create: `src/server/telephony/sip-bridge-adapter.ts`
- Modify: `src/server/telephony/asterisk.ts` (extend SipBridgeAdapter)
- Modify: `src/server/telephony/freeswitch.ts` (extend SipBridgeAdapter)

- [ ] **Step 1: Extract shared methods into abstract base class**

`src/server/telephony/sip-bridge-adapter.ts`:
```typescript
/**
 * SipBridgeAdapter — abstract base for self-hosted PBX adapters that delegate
 * real-time call control to the unified sip-bridge process.
 *
 * Shared functionality:
 * - BridgeClient HTTP communication (HMAC-signed)
 * - ringUsers / cancelRinging / hangupCall (via bridge /ring, /cancel-ringing, /hangup)
 * - Recording management (via bridge /recordings/*)
 * - Webhook validation (HMAC-SHA256 signature verification)
 * - Connection testing (bridge /health)
 *
 * Subclasses implement IVR response generation in their native format:
 * - AsteriskAdapter: ARI JSON command arrays
 * - FreeSwitchAdapter: mod_httapi XML documents
 */

import type { ConnectionTestResult } from '../../shared/types'
import type {
  RingUsersParams,
  TelephonyAdapter,
  TelephonyResponse,
  WebhookVerificationResult,
} from './adapter'
import { BridgeClient } from './bridge-client'

export abstract class SipBridgeAdapter implements TelephonyAdapter {
  protected bridge: BridgeClient

  constructor(
    protected phoneNumber: string,
    protected bridgeCallbackUrl: string,
    protected bridgeSecret: string
  ) {
    this.bridge = new BridgeClient(bridgeCallbackUrl, bridgeSecret)
  }

  // --- Shared: Call Control (via bridge) ---

  async hangupCall(callSid: string): Promise<void> {
    await this.bridge.request('POST', '/hangup', { channelId: callSid })
  }

  async ringUsers(params: RingUsersParams): Promise<string[]> {
    const result = await this.bridge.request('POST', '/ring', {
      parentCallSid: params.callSid,
      callerNumber: params.callerNumber,
      users: params.users.map((u) => ({
        pubkey: u.pubkey,
        phone: u.phone,
        browserIdentity: u.browserIdentity,
      })),
      callbackUrl: params.callbackUrl,
      hubId: params.hubId,
    })
    return (result as { channelIds?: string[] })?.channelIds ?? []
  }

  async cancelRinging(callSids: string[], exceptSid?: string): Promise<void> {
    await this.bridge.request('POST', '/cancel-ringing', { callSids, exceptSid })
  }

  // --- Shared: Recording Management ---

  async getCallRecording(callSid: string): Promise<ArrayBuffer | null> {
    return this.getRecordingAudio(callSid)
  }

  async getRecordingAudio(recordingSid: string): Promise<ArrayBuffer | null> {
    const result = await this.bridge.request('GET', `/recordings/${recordingSid}`)
    if (result && typeof result === 'object' && 'audio' in result) {
      const base64 = (result as { audio: string }).audio
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes.buffer
    }
    return null
  }

  async deleteRecording(recordingSid: string): Promise<void> {
    await this.bridge.request('DELETE', `/recordings/${recordingSid}`).catch(() => {})
  }

  // --- Shared: Webhook Validation (HMAC-SHA256) ---

  async validateWebhook(request: Request): Promise<boolean> {
    const signature = request.headers.get('X-Bridge-Signature')
    if (!signature) return false
    const body = await request.clone().text()
    const timestamp = request.headers.get('X-Bridge-Timestamp') || ''
    const tsSeconds = Number.parseInt(timestamp, 10)
    if (Number.isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) return false

    const payload = `${timestamp}.${body}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.bridgeSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    const expectedSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    if (signature.length !== expectedSig.length) return false
    let result = 0
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i)
    }
    return result === 0
  }

  // --- Shared: Connection Testing ---

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const res = await fetch(`${this.bridgeCallbackUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok)
        return { connected: false, latencyMs, error: `Bridge HTTP ${res.status}`, errorType: 'network_error' }
      const data = (await res.json()) as { ok?: boolean; pbx?: { connected?: boolean } }
      if (!data.ok || !data.pbx?.connected) {
        return { connected: false, latencyMs, error: 'Bridge connected but PBX not reachable', errorType: 'network_error' }
      }
      return { connected: true, latencyMs }
    } catch (err) {
      return { connected: false, latencyMs: Date.now() - start, error: String(err), errorType: 'network_error' }
    }
  }

  async verifyWebhookConfig(_phoneNumber: string, _expectedBaseUrl: string): Promise<WebhookVerificationResult> {
    return { configured: true, warning: 'Self-hosted PBX webhook config must be verified in PBX configuration' }
  }

  // --- Abstract: IVR response generation (subclass implements in native format) ---

  abstract handleLanguageMenu(params: import('./adapter').LanguageMenuParams): Promise<TelephonyResponse>
  abstract handleIncomingCall(params: import('./adapter').IncomingCallParams): Promise<TelephonyResponse>
  abstract handleCaptchaResponse(params: import('./adapter').CaptchaResponseParams): Promise<TelephonyResponse>
  abstract handleCallAnswered(params: import('./adapter').CallAnsweredParams): Promise<TelephonyResponse>
  abstract handleVoicemail(params: import('./adapter').VoicemailParams): Promise<TelephonyResponse>
  abstract handleWaitMusic(lang: string, audioUrls?: import('./adapter').AudioUrlMap, queueTime?: number, queueTimeout?: number): Promise<TelephonyResponse>
  abstract rejectCall(): TelephonyResponse
  abstract handleVoicemailComplete(lang: string): TelephonyResponse
  abstract handleUnavailable(lang: string, audioUrls?: import('./adapter').AudioUrlMap): TelephonyResponse
  abstract emptyResponse(): TelephonyResponse
  abstract parseIncomingWebhook(request: Request): Promise<import('./adapter').WebhookCallInfo>
  abstract parseLanguageWebhook(request: Request): Promise<import('./adapter').WebhookCallInfo & import('./adapter').WebhookDigits>
  abstract parseCaptchaWebhook(request: Request): Promise<import('./adapter').WebhookDigits & { callerNumber: string }>
  abstract parseCallStatusWebhook(request: Request): Promise<import('./adapter').WebhookCallStatus>
  abstract parseQueueWaitWebhook(request: Request): Promise<import('./adapter').WebhookQueueWait>
  abstract parseQueueExitWebhook(request: Request): Promise<import('./adapter').WebhookQueueResult>
  abstract parseRecordingWebhook(request: Request): Promise<import('./adapter').WebhookRecordingStatus>
}
```

- [ ] **Step 2: Refactor AsteriskAdapter to extend SipBridgeAdapter**

In `src/server/telephony/asterisk.ts`:
- Change `export class AsteriskAdapter implements TelephonyAdapter` → `export class AsteriskAdapter extends SipBridgeAdapter`
- Remove: constructor's `BridgeClient` instantiation (now in base class)
- Remove: `hangupCall`, `ringUsers`, `cancelRinging`, `getCallRecording`, `getRecordingAudio`, `deleteRecording`, `validateWebhook`, `testConnection`, `verifyWebhookConfig` (all inherited)
- Keep: all `handle*` methods, `parse*` methods, `rejectCall`, `emptyResponse` (ARI JSON format)
- Update constructor: `super(phoneNumber, bridgeCallbackUrl, bridgeSecret)`

- [ ] **Step 3: Refactor FreeSwitchAdapter to extend SipBridgeAdapter**

In `src/server/telephony/freeswitch.ts`:
- Same pattern as Step 2 but keeps mod_httapi XML methods

- [ ] **Step 4: Verify all existing tests still pass**

```bash
bun test src/server/telephony/asterisk* src/server/telephony/freeswitch*
bun run typecheck
```
Expected: All pass — behavior is identical, just code organization.

- [ ] **Step 5: Commit**

```bash
git add src/server/telephony/sip-bridge-adapter.ts src/server/telephony/asterisk.ts src/server/telephony/freeswitch.ts
git commit -m "refactor: extract SipBridgeAdapter base class from shared bridge logic"
```

---

## Phase 6: Comprehensive Migration (Tasks 14–16)

Rename `asterisk-bridge/` → `sip-bridge/`, update every reference across the codebase.

### Task 14: Move asterisk-bridge → sip-bridge + Update Core References

**Files (121 files reference the bridge — key ones):**

**Move:**
- `asterisk-bridge/` → `sip-bridge/` (preserve git history with `git mv`)

**Core code updates:**
- `src/server/telephony/bridge-client.ts` — no rename needed (it's the HTTP client in the main server, used by SipBridgeAdapter)
- `src/shared/schemas/external/asterisk-bridge.ts` — rename to `sip-bridge.ts`, update schema names `AsteriskBridgeWebhook*` → `SipBridgeWebhook*`
- `src/shared/schemas/external/index.ts` — update barrel export
- `tests/helpers/simulation.ts` — update import and type references
- `tests/api/simulation-asterisk.spec.ts` — rename to `simulation-sip-bridge.spec.ts`
- `tests/asterisk-auto-config.spec.ts` — update imports

- [ ] **Step 1: Move the directory**

```bash
git mv asterisk-bridge sip-bridge
```

- [ ] **Step 2: Update schema file**

```bash
git mv src/shared/schemas/external/asterisk-bridge.ts src/shared/schemas/external/sip-bridge.ts
```

Update all `AsteriskBridgeWebhook` → `SipBridgeWebhook` references in the renamed file and consumers.

- [ ] **Step 3: Update all imports across src/ and tests/**

Search and replace in all `.ts` files:
- `asterisk-bridge` → `sip-bridge` (in import paths)
- `AsteriskBridgeWebhook` → `SipBridgeWebhook` (in type references)

- [ ] **Step 4: Run typecheck + tests**

```bash
bun run typecheck && bun test && bunx playwright test --project=api --workers=6
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename asterisk-bridge → sip-bridge across codebase"
```

### Task 15: Update CI, Docker, Ansible, Helm

**Files:**
- `.github/workflows/ci.yml` — `cd asterisk-bridge` → `cd sip-bridge`, add `PBX_TYPE` env
- `.github/workflows/docker.yml` — bridge image build path
- `.github/actions/start-test-infra/action.yml` — bridge references
- `deploy/docker/docker-compose.yml` — service name
- `deploy/docker/docker-compose.ci.yml` — service name
- `deploy/docker/docker-compose.dev.yml` — service name
- `deploy/docker/.env.example` — var names
- `deploy/docker/.env.dev.defaults` — var names
- `deploy/ansible/templates/docker-compose.j2` — service name + PBX_TYPE
- `deploy/ansible/templates/env.j2` — bridge env vars
- `deploy/ansible/roles/llamenos/templates/docker-compose.j2` — service name
- `deploy/ansible/vars.example.yml` — variable names
- `deploy/ansible/justfile` — bridge references
- `deploy/helm/llamenos/values.yaml` — bridge config
- `deploy/helm/llamenos/templates/secret.yaml` — bridge secret
- `scripts/docker-setup.sh` — bridge references
- `scripts/dev-certs.sh` — bridge cert references
- `scripts/kill-runaway-bun.sh` — process name

- [ ] **Step 1: Update all CI/deploy files**

Search and replace `asterisk-bridge` → `sip-bridge` and `asterisk_bridge` → `sip_bridge` across all listed files. Add `PBX_TYPE: ${PBX_TYPE:-asterisk}` env var where bridge is configured.

- [ ] **Step 2: Update .gitignore**

If `.gitignore` references `asterisk-bridge/node_modules`, update to `sip-bridge/node_modules`.

- [ ] **Step 3: Verify CI locally**

```bash
# Ensure sip-bridge installs and builds
cd sip-bridge && bun install && bun test && cd ..
bun run typecheck && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: update CI, Docker, Ansible, Helm for sip-bridge rename"
```

### Task 16: Update Documentation + Locale Strings

**Files:**
- `CLAUDE.md` — bridge architecture description
- `README.md` — setup instructions
- `DEVELOPMENT.md` — dev workflow
- `CHANGELOG.md` — add migration note
- `docs/QUICKSTART.md` — setup guide
- `docs/RUNBOOK.md` — operational docs
- `docs/NEXT_BACKLOG.md` — backlog references
- `docs/security/DEPLOYMENT_HARDENING.md` — security config
- `site/src/content/docs/` — 13+ localized setup guides (en, es, ar, hi, pt, ru, zh, ht, tl, vi, fr, de, ko)
- `public/locales/*.json` — 20+ UI locale files with bridge-related strings
- `.claude/skills/test-runner/` — skill references
- Historical docs in `docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/epics/` — update for accuracy

- [ ] **Step 1: Update CLAUDE.md**

Replace `asterisk-bridge` references with `sip-bridge`. Update architecture description to mention unified bridge supporting Asterisk ARI, FreeSWITCH ESL, and Kamailio JSONRPC.

- [ ] **Step 2: Update README.md, DEVELOPMENT.md, QUICKSTART.md**

Replace bridge references and add FreeSWITCH/Kamailio setup instructions.

- [ ] **Step 3: Update site/ documentation**

In each `setup-asterisk.md` (13 languages), rename to note the unified bridge and add FreeSWITCH alternative.

- [ ] **Step 4: Update locale files**

In `public/locales/*.json`, update any strings mentioning "asterisk bridge" or "Asterisk Bridge".

- [ ] **Step 5: Update test-runner skill**

In `.claude/skills/test-runner/`, update bridge references.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: update all documentation and locales for sip-bridge rename"
```

---

## Summary

| Phase | Tasks | Deliverable |
|-------|-------|-------------|
| 1: SIP Bridge | 1–5 | `sip-bridge/` with BridgeClient, ARI, ESL, Kamailio clients |
| 2: FreeSWITCH Adapter | 6–10 | Full `TelephonyAdapter` + capabilities + simulation tests |
| 3: Kamailio Deployment | 11 | Ansible role + Docker Compose profile |
| 4: CI/Deploy Migration | 12 | CI + deployment references updated |
| 5: SipBridgeAdapter | 13 | Abstract base class, Asterisk + FreeSWITCH extend it |
| 6: Comprehensive Migration | 14–16 | 121 files: rename, CI, Docker, Ansible, Helm, docs, locales |
