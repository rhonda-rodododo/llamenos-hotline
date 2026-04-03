# Plan A: SIP Bridge Refactor — asterisk-bridge to sip-bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `asterisk-bridge/` into a unified `sip-bridge/` with a `BridgeClient` protocol abstraction, extract a `SipBridgeAdapter` base class for shared telephony adapter logic, and migrate all 121 references across the codebase.

**Architecture:** Single `sip-bridge/` project with three protocol clients (ARI, ESL, Kamailio JSONRPC) behind a common `BridgeClient` interface. The `PBX_TYPE` env var selects the active client at startup. A shared `WebhookSender` translates protocol-specific events into HTTP POSTs to the Llamenos server. On the server side, `SipBridgeAdapter` extracts shared bridge communication logic (ring, cancel, hangup, recording, HMAC validation) so that both `AsteriskAdapter` and future `FreeSwitchAdapter` extend it.

**Tech Stack:** Bun, TypeScript, WebSocket (ARI), TCP (ESL), HTTP (Kamailio JSONRPC)

**Spec reference:** `docs/superpowers/specs/2026-04-03-freeswitch-adapter-design.md` (Part 3: Unified SIP Bridge)

---

### Task 1: BridgeClient Interface + sip-bridge Scaffold

**Files:**
- Create: `sip-bridge/src/bridge-client.ts`
- Create: `sip-bridge/package.json`
- Create: `sip-bridge/tsconfig.json`

- [ ] Create `sip-bridge/package.json`:

```json
{
  "name": "llamenos-sip-bridge",
  "version": "1.0.0",
  "description": "Unified SIP bridge — translates PBX events (Asterisk ARI, FreeSWITCH ESL, Kamailio JSONRPC) to HTTP webhooks for Llamenos",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "typecheck": "tsc --noEmit",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "test": "bun test"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] Create `sip-bridge/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] Create `sip-bridge/src/bridge-client.ts` with the protocol-agnostic `BridgeClient` interface. This is the core abstraction that all PBX protocol clients implement:

```typescript
// ---- Bridge Event Types (protocol-agnostic) ----

/**
 * Normalized event emitted by any PBX protocol client.
 * The WebhookSender translates these into HTTP POSTs to the Llamenos server.
 */
export type BridgeEvent =
  | ChannelCreateEvent
  | ChannelAnswerEvent
  | ChannelHangupEvent
  | DtmfReceivedEvent
  | RecordingCompleteEvent
  | RecordingFailedEvent
  | PlaybackFinishedEvent

export interface ChannelCreateEvent {
  type: 'channel_create'
  channelId: string
  callerNumber: string
  calledNumber: string
  /** Protocol-specific args (e.g., ARI stasis args, ESL channel variables) */
  args?: string[]
  timestamp: string
}

export interface ChannelAnswerEvent {
  type: 'channel_answer'
  channelId: string
  timestamp: string
}

export interface ChannelHangupEvent {
  type: 'channel_hangup'
  channelId: string
  /** SIP cause code (16 = normal, 17 = busy, 19 = no answer, 21 = rejected) */
  cause: number
  causeText: string
  timestamp: string
}

export interface DtmfReceivedEvent {
  type: 'dtmf_received'
  channelId: string
  digit: string
  durationMs: number
  timestamp: string
}

export interface RecordingCompleteEvent {
  type: 'recording_complete'
  channelId: string
  recordingName: string
  /** Duration in seconds, if known */
  duration?: number
  timestamp: string
}

export interface RecordingFailedEvent {
  type: 'recording_failed'
  channelId: string
  recordingName: string
  cause?: string
  timestamp: string
}

export interface PlaybackFinishedEvent {
  type: 'playback_finished'
  channelId: string
  playbackId: string
  timestamp: string
}

// ---- Originate Parameters ----

export interface OriginateParams {
  /** SIP endpoint (e.g., "PJSIP/user@trunk" for Asterisk, "sofia/internal/user" for FreeSWITCH) */
  endpoint: string
  /** Caller ID to display */
  callerId?: string
  /** Ring timeout in seconds */
  timeout?: number
  /** Application-specific arguments (e.g., ARI appArgs, FS channel variables) */
  appArgs?: string
}

// ---- Health Status ----

export interface BridgeHealthStatus {
  ok: boolean
  /** Round-trip latency to the PBX in milliseconds */
  latencyMs: number
  /** Protocol-specific details (e.g., Asterisk version, FreeSWITCH uptime) */
  details?: Record<string, unknown>
}

// ---- Protocol-Agnostic Bridge Client Interface ----

/**
 * BridgeClient — abstract interface for PBX protocol clients.
 *
 * Each PBX protocol (Asterisk ARI, FreeSWITCH ESL, Kamailio JSONRPC)
 * implements this interface. The sip-bridge entry point selects the
 * appropriate client based on the PBX_TYPE environment variable.
 *
 * Pattern mirrors TelephonyAdapter (src/server/telephony/adapter.ts)
 * but operates at the PBX protocol level rather than the call flow level.
 */
export interface BridgeClient {
  /** Connect to the PBX (WebSocket, TCP, or HTTP depending on protocol) */
  connect(): Promise<void>

  /** Disconnect from the PBX */
  disconnect(): void

  /** Whether the client is currently connected */
  isConnected(): boolean

  /** Register a handler for normalized bridge events */
  onEvent(handler: (event: BridgeEvent) => void): void

  // ---- Call Control ----

  /** Originate an outbound call. Returns the channel/call ID. */
  originate(params: OriginateParams): Promise<{ id: string }>

  /** Hang up a channel by ID */
  hangup(channelId: string): Promise<void>

  /** Answer a channel */
  answer(channelId: string): Promise<void>

  /** Bridge two channels together. Returns the bridge ID. */
  bridge(channelId1: string, channelId2: string, options?: { record?: boolean }): Promise<string>

  /** Destroy a bridge */
  destroyBridge(bridgeId: string): Promise<void>

  // ---- Media ----

  /** Play media on a channel */
  playMedia(channelId: string, media: string, playbackId?: string): Promise<string>

  /** Stop a playback */
  stopPlayback(playbackId: string): Promise<void>

  /** Start music-on-hold on a channel */
  startMoh(channelId: string, mohClass?: string): Promise<void>

  /** Stop music-on-hold */
  stopMoh(channelId: string): Promise<void>

  // ---- Recording ----

  /** Start recording a channel */
  recordChannel(channelId: string, params: {
    name: string
    format?: string
    maxDurationSeconds?: number
    beep?: boolean
    terminateOn?: string
  }): Promise<void>

  /** Start recording a bridge */
  recordBridge(bridgeId: string, params: {
    name: string
    format?: string
    maxDurationSeconds?: number
  }): Promise<void>

  /** Stop an active recording */
  stopRecording(recordingName: string): Promise<void>

  /** Get recording audio as raw bytes */
  getRecordingFile(recordingName: string): Promise<ArrayBuffer | null>

  /** Delete a stored recording */
  deleteRecording(recordingName: string): Promise<void>

  // ---- Channel Variables ----

  /** Set a channel variable */
  setChannelVar(channelId: string, variable: string, value: string): Promise<void>

  /** Get a channel variable */
  getChannelVar(channelId: string, variable: string): Promise<string>

  // ---- System ----

  /** Health check — returns ok status and round-trip latency */
  healthCheck(): Promise<BridgeHealthStatus>

  /** List active channels */
  listChannels(): Promise<Array<{ id: string; state: string; caller: string }>>

  /** List active bridges */
  listBridges(): Promise<Array<{ id: string; channels: string[] }>>
}
```

- [ ] Run `cd sip-bridge && bun install && bun run typecheck`
- [ ] Commit: `feat(sip-bridge): scaffold project with BridgeClient protocol interface`

---

### Task 2: Extract ARI Client

**Files:**
- Create: `sip-bridge/src/clients/ari-client.ts`
- Copy and keep: `sip-bridge/src/types.ts` (ARI-specific types, from `asterisk-bridge/src/types.ts`)

This task extracts the existing `asterisk-bridge/src/ari-client.ts` into the new `sip-bridge/` project structure and wraps it to implement the `BridgeClient` interface with event translation.

- [ ] Copy `asterisk-bridge/src/types.ts` to `sip-bridge/src/types.ts`. This file contains ARI event types (`AnyAriEvent`, `StasisStartEvent`, etc.), ARI resource types (`AriChannel`, `AriBridge`, `AriPlayback`, `AriRecording`), webhook types, command types, and `BridgeConfig`. Keep all existing types intact — they are ARI-specific internal types used by the ARI client.

- [ ] Create `sip-bridge/src/clients/ari-client.ts`. This wraps the raw ARI WebSocket + REST client and implements `BridgeClient`:

```typescript
import type {
  BridgeClient,
  BridgeEvent,
  BridgeHealthStatus,
  OriginateParams,
} from '../bridge-client'
import type {
  AnyAriEvent,
  AriBridge,
  AriChannel,
  AriPlayback,
  AriRecording,
  BridgeConfig,
  ChannelDestroyedEvent,
  ChannelDtmfReceivedEvent,
  PlaybackFinishedEvent,
  RecordingFailedEvent,
  RecordingFinishedEvent,
  StasisStartEvent,
} from '../types'

type EventHandler = (event: BridgeEvent) => void

/**
 * ARI Client — connects to Asterisk's ARI via WebSocket for events
 * and REST API for commands. Implements BridgeClient for protocol-agnostic usage.
 *
 * Extracted from asterisk-bridge/src/ari-client.ts with BridgeClient wrapper.
 */
export class AriClient implements BridgeClient {
  private config: BridgeConfig
  private ws: WebSocket | null = null
  private eventHandlers: EventHandler[] = []
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private shouldReconnect = true
  private authHeader: string
  private hasConnected = false
  private connectionDeadline: number | null = null
  private readonly connectionTimeoutMs: number

  constructor(config: BridgeConfig) {
    this.config = config
    this.authHeader = `Basic ${btoa(`${config.ariUsername}:${config.ariPassword}`)}`
    this.connectionTimeoutMs = config.connectionTimeoutMs ?? 5 * 60 * 1000
  }

  // ... (full implementation extracted from asterisk-bridge/src/ari-client.ts)
  // Key difference: onEvent() emits BridgeEvent (not raw ARI events)
  // Raw ARI events are translated in the WebSocket message handler
```

- [ ] The ARI client translates raw ARI events to `BridgeEvent` in the WebSocket message handler. Add a private `translateEvent(ariEvent: AnyAriEvent): BridgeEvent | null` method:

```typescript
  private translateEvent(event: AnyAriEvent): BridgeEvent | null {
    switch (event.type) {
      case 'StasisStart': {
        const e = event as StasisStartEvent
        return {
          type: 'channel_create',
          channelId: e.channel.id,
          callerNumber: e.channel.caller.number || 'unknown',
          calledNumber: e.channel.connected.number || '',
          args: e.args,
          timestamp: e.timestamp,
        }
      }
      case 'ChannelDestroyed': {
        const e = event as ChannelDestroyedEvent
        return {
          type: 'channel_hangup',
          channelId: e.channel.id,
          cause: e.cause,
          causeText: e.cause_txt,
          timestamp: e.timestamp,
        }
      }
      case 'ChannelDtmfReceived': {
        const e = event as ChannelDtmfReceivedEvent
        return {
          type: 'dtmf_received',
          channelId: e.channel.id,
          digit: e.digit,
          durationMs: e.duration_ms,
          timestamp: e.timestamp,
        }
      }
      case 'RecordingFinished': {
        const e = event as RecordingFinishedEvent
        return {
          type: 'recording_complete',
          channelId: e.recording.target_uri.replace('channel:', ''),
          recordingName: e.recording.name,
          duration: e.recording.duration,
          timestamp: e.timestamp,
        }
      }
      case 'RecordingFailed': {
        const e = event as RecordingFailedEvent
        return {
          type: 'recording_failed',
          channelId: e.recording.target_uri.replace('channel:', ''),
          recordingName: e.recording.name,
          cause: e.recording.cause,
          timestamp: e.timestamp,
        }
      }
      case 'PlaybackFinished': {
        const e = event as PlaybackFinishedEvent
        return {
          type: 'playback_finished',
          channelId: e.playback.target_uri.replace('channel:', ''),
          playbackId: e.playback.id,
          timestamp: e.timestamp,
        }
      }
      case 'ChannelStateChange': {
        // ChannelStateChange to 'Up' = channel_answer
        if ('channel' in event && (event as { channel: AriChannel }).channel.state === 'Up') {
          return {
            type: 'channel_answer',
            channelId: (event as { channel: AriChannel }).channel.id,
            timestamp: event.timestamp,
          }
        }
        return null // Ignore other state changes
      }
      default:
        return null
    }
  }
```

- [ ] Implement all `BridgeClient` methods by delegating to the existing ARI REST methods. The full method bodies are extracted from `asterisk-bridge/src/ari-client.ts` — the `originate()`, `hangup()`, `answer()`, `bridge()`, `playMedia()`, `recordChannel()`, `recordBridge()`, `getRecordingFile()`, etc. methods map 1:1 to ARI REST endpoints. Key method signatures:

  - `originate(params)` calls `POST /channels` and returns `{ id: channel.id }`
  - `hangup(channelId)` calls `DELETE /channels/{channelId}`
  - `answer(channelId)` calls `POST /channels/{channelId}/answer`
  - `bridge(id1, id2, opts)` calls `POST /bridges` then `POST /bridges/{id}/addChannel` for each channel, optionally calls `POST /bridges/{id}/record`
  - `healthCheck()` calls `GET /asterisk/info` and measures latency

- [ ] Also retain the Asterisk-specific methods as public methods on `AriClient` (not part of the `BridgeClient` interface) since the `CommandHandler` and `PjsipConfigurator` need them:
  - `configureDynamic()`, `reloadModule()`, `deleteDynamic()` — dynamic config management
  - `startRinging()`, `stopRinging()` — ringing control
  - `addChannelToBridge()`, `removeChannelFromBridge()`, `startBridgeMoh()`, `playMediaOnBridge()` — bridge helpers
  - `getAsteriskInfo()` — system info

- [ ] Copy `asterisk-bridge/src/ari-client.test.ts` to `sip-bridge/src/clients/ari-client.test.ts` and update imports

- [ ] Run `cd sip-bridge && bun run typecheck`
- [ ] Commit: `feat(sip-bridge): extract ARI client implementing BridgeClient interface`

---

### Task 3: ESL Client for FreeSWITCH

**Files:**
- Create: `sip-bridge/src/clients/esl-client.ts`
- Create: `sip-bridge/src/clients/esl-client.test.ts`

The ESL (Event Socket Library) client connects to FreeSWITCH over TCP and implements the `BridgeClient` interface.

- [ ] Create `sip-bridge/src/clients/esl-client.ts`:

```typescript
import type {
  BridgeClient,
  BridgeEvent,
  BridgeHealthStatus,
  OriginateParams,
} from '../bridge-client'

/** ESL connection config */
export interface EslConfig {
  host: string       // Default: 'localhost'
  port: number       // Default: 8021
  password: string   // FreeSWITCH ESL password (default: 'ClueCon')
  /** Maximum time (ms) to wait for an initial connection before exiting */
  connectionTimeoutMs?: number
}

type EventHandler = (event: BridgeEvent) => void

/**
 * FreeSWITCH Event Socket Library (ESL) client.
 * Connects over TCP, authenticates, subscribes to call events,
 * and translates them to BridgeEvent objects.
 *
 * ESL Protocol:
 * - Text-based headers (Key: Value\n) separated by double newline
 * - Auth: send "auth <password>\n\n", expect "+OK accepted"
 * - Subscribe: "event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE RECORD_STOP DTMF\n\n"
 * - Commands: "api <command>\n\n" for synchronous, "bgapi <command>\n\n" for async
 */
export class EslClient implements BridgeClient {
  private config: EslConfig
  private socket: ReturnType<typeof Bun.connect> | null = null
  private eventHandlers: EventHandler[] = []
  private connected = false
  private shouldReconnect = true
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private hasConnected = false
  private connectionDeadline: number | null = null
  private readonly connectionTimeoutMs: number
  private buffer = ''

  constructor(config: EslConfig) {
    this.config = config
    this.connectionTimeoutMs = config.connectionTimeoutMs ?? 5 * 60 * 1000
  }

  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler)
  }

  isConnected(): boolean {
    return this.connected
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true
    if (!this.hasConnected) {
      this.connectionDeadline = Date.now() + this.connectionTimeoutMs
      console.log(
        `[esl] Will exit if FreeSWITCH is not reachable within ${Math.round(this.connectionTimeoutMs / 1000)}s`
      )
    }
    await this.doConnect()
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.connected = false
    // Close socket if open
    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
  }

  private async doConnect(): Promise<void> {
    // Use Bun.connect for TCP
    return new Promise<void>((resolve, reject) => {
      console.log(`[esl] Connecting to ${this.config.host}:${this.config.port}...`)

      const self = this
      let authenticated = false

      Bun.connect({
        hostname: this.config.host,
        port: this.config.port,
        socket: {
          data(_socket, data) {
            self.buffer += new TextDecoder().decode(data)
            self.processBuffer(authenticated, () => {
              authenticated = true
              self.connected = true
              self.hasConnected = true
              self.connectionDeadline = null
              self.reconnectDelay = 1000
              resolve()
            })
          },
          open(socket) {
            self.socket = socket
            // FreeSWITCH sends "Content-Type: auth/request" on connect
            // We respond in the data handler after seeing that header
          },
          close() {
            console.log('[esl] Connection closed')
            self.connected = false
            self.socket = null
            if (self.shouldReconnect) {
              self.scheduleReconnect()
            }
          },
          error(_socket, error) {
            console.error('[esl] Socket error:', error)
            if (!self.connected) {
              reject(new Error(`Failed to connect to FreeSWITCH ESL: ${error.message}`))
            }
          },
        },
      })
    })
  }

  /**
   * Process the TCP buffer for ESL messages.
   * ESL messages are headers separated by \n, terminated by \n\n.
   * If Content-Length is present, a body follows after the headers.
   */
  private processBuffer(authenticated: boolean, onAuth: () => void): void {
    while (this.buffer.includes('\n\n')) {
      const headerEnd = this.buffer.indexOf('\n\n')
      const headerBlock = this.buffer.substring(0, headerEnd)
      const headers = this.parseHeaders(headerBlock)

      const contentLength = Number.parseInt(headers['Content-Length'] ?? '0', 10)

      // Check if we have the full body
      const bodyStart = headerEnd + 2
      if (contentLength > 0 && this.buffer.length < bodyStart + contentLength) {
        return // Wait for more data
      }

      const body = contentLength > 0 ? this.buffer.substring(bodyStart, bodyStart + contentLength) : ''
      this.buffer = this.buffer.substring(bodyStart + contentLength)

      const contentType = headers['Content-Type'] ?? ''

      if (contentType === 'auth/request') {
        // Send auth
        this.send(`auth ${this.config.password}`)
      } else if (contentType === 'command/reply' && !authenticated) {
        const reply = headers['Reply-Text'] ?? ''
        if (reply.startsWith('+OK')) {
          // Subscribe to events
          this.send('event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE RECORD_STOP DTMF')
          onAuth()
        } else {
          console.error('[esl] Auth failed:', reply)
        }
      } else if (contentType === 'text/event-plain') {
        // Parse ESL event
        const eventHeaders = this.parseHeaders(body)
        const bridgeEvent = this.translateEslEvent(eventHeaders)
        if (bridgeEvent) {
          for (const handler of this.eventHandlers) {
            try {
              handler(bridgeEvent)
            } catch (err) {
              console.error('[esl] Event handler error:', err)
            }
          }
        }
      }
    }
  }

  private parseHeaders(text: string): Record<string, string> {
    const headers: Record<string, string> = {}
    for (const line of text.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim()
        const value = decodeURIComponent(line.substring(colonIdx + 1).trim())
        headers[key] = value
      }
    }
    return headers
  }

  private send(command: string): void {
    if (this.socket) {
      this.socket.write(`${command}\n\n`)
    }
  }

  /**
   * Send an ESL API command and return the response body.
   * Uses synchronous "api" command (blocks until response).
   */
  private async apiCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error('ESL not connected'))
        return
      }
      // For simplicity, use bgapi with Job-UUID tracking
      // In production, implement proper command/response correlation
      this.send(`api ${command}`)
      // ESL responds with Content-Type: api/response
      // For now, resolve immediately — full impl needs response correlation
      resolve('')
    })
  }

  private translateEslEvent(headers: Record<string, string>): BridgeEvent | null {
    const eventName = headers['Event-Name'] ?? ''
    const channelId = headers['Unique-ID'] ?? headers['Channel-Call-UUID'] ?? ''
    const timestamp = headers['Event-Date-GMT'] ?? new Date().toISOString()

    switch (eventName) {
      case 'CHANNEL_CREATE':
        return {
          type: 'channel_create',
          channelId,
          callerNumber: headers['Caller-Caller-ID-Number'] ?? 'unknown',
          calledNumber: headers['Caller-Destination-Number'] ?? '',
          args: headers['variable_sip_h_X-Llamenos-Args']?.split(','),
          timestamp,
        }
      case 'CHANNEL_ANSWER':
        return {
          type: 'channel_answer',
          channelId,
          timestamp,
        }
      case 'CHANNEL_HANGUP_COMPLETE':
        return {
          type: 'channel_hangup',
          channelId,
          cause: Number.parseInt(headers['Hangup-Cause-Code'] ?? '16', 10),
          causeText: headers['Hangup-Cause'] ?? 'NORMAL_CLEARING',
          timestamp,
        }
      case 'RECORD_STOP': {
        const recordPath = headers['Record-File-Path'] ?? ''
        const recordName = recordPath.split('/').pop() ?? recordPath
        return {
          type: 'recording_complete',
          channelId,
          recordingName: recordName,
          duration: Number.parseInt(headers['variable_record_seconds'] ?? '0', 10) || undefined,
          timestamp,
        }
      }
      case 'DTMF':
        return {
          type: 'dtmf_received',
          channelId,
          digit: headers['DTMF-Digit'] ?? '',
          durationMs: Number.parseInt(headers['DTMF-Duration'] ?? '0', 10),
          timestamp,
        }
      default:
        return null
    }
  }

  private scheduleReconnect(): void {
    if (this.connectionDeadline !== null && Date.now() >= this.connectionDeadline) {
      console.error(
        `[esl] FATAL: Could not connect to FreeSWITCH within ${Math.round(this.connectionTimeoutMs / 1000)}s — exiting.`
      )
      process.exit(1)
    }

    const remaining = this.connectionDeadline
      ? ` (${Math.round((this.connectionDeadline - Date.now()) / 1000)}s until timeout)`
      : ''
    console.log(`[esl] Reconnecting in ${this.reconnectDelay}ms...${remaining}`)

    setTimeout(async () => {
      if (this.connectionDeadline !== null && Date.now() >= this.connectionDeadline) {
        console.error(`[esl] FATAL: Connection timeout — exiting.`)
        process.exit(1)
      }
      try {
        await this.doConnect()
      } catch {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
        if (this.shouldReconnect) this.scheduleReconnect()
      }
    }, this.reconnectDelay)
  }

  // ---- BridgeClient Call Control Methods ----

  async originate(params: OriginateParams): Promise<{ id: string }> {
    const vars = params.appArgs ? `{sip_h_X-Llamenos-Args=${params.appArgs}}` : ''
    const callerIdStr = params.callerId ? `<${params.callerId}>` : ''
    const cmd = `originate ${vars}${params.endpoint} &park() XML default ${callerIdStr}`
    await this.apiCommand(cmd)
    // FreeSWITCH returns the UUID in the api/response
    // For now return a placeholder — full impl extracts UUID from response
    return { id: crypto.randomUUID() }
  }

  async hangup(channelId: string): Promise<void> {
    await this.apiCommand(`uuid_kill ${channelId}`)
  }

  async answer(channelId: string): Promise<void> {
    await this.apiCommand(`uuid_answer ${channelId}`)
  }

  async bridge(channelId1: string, channelId2: string, _options?: { record?: boolean }): Promise<string> {
    await this.apiCommand(`uuid_bridge ${channelId1} ${channelId2}`)
    return `bridge-${channelId1}-${channelId2}`
  }

  async destroyBridge(_bridgeId: string): Promise<void> {
    // FreeSWITCH doesn't have explicit bridge objects — hangup one leg
    // The bridge is implicit from uuid_bridge
  }

  async playMedia(channelId: string, media: string, _playbackId?: string): Promise<string> {
    await this.apiCommand(`uuid_broadcast ${channelId} ${media}`)
    return `playback-${channelId}-${Date.now()}`
  }

  async stopPlayback(_playbackId: string): Promise<void> {
    // uuid_break stops playback on a channel
    // Would need channelId — store mapping in practice
  }

  async startMoh(channelId: string, mohClass?: string): Promise<void> {
    const file = mohClass === 'default' ? 'local_stream://moh' : `local_stream://${mohClass}`
    await this.apiCommand(`uuid_broadcast ${channelId} ${file}`)
  }

  async stopMoh(channelId: string): Promise<void> {
    await this.apiCommand(`uuid_break ${channelId}`)
  }

  async recordChannel(channelId: string, params: {
    name: string
    format?: string
    maxDurationSeconds?: number
    beep?: boolean
    terminateOn?: string
  }): Promise<void> {
    const format = params.format ?? 'wav'
    const maxDuration = params.maxDurationSeconds ?? 0
    await this.apiCommand(
      `uuid_record ${channelId} start /tmp/recordings/${params.name}.${format} ${maxDuration}`
    )
  }

  async recordBridge(_bridgeId: string, params: {
    name: string
    format?: string
    maxDurationSeconds?: number
  }): Promise<void> {
    // FreeSWITCH records individual legs — for bridge recording,
    // use uuid_record on one of the channels in the bridge
    console.warn(`[esl] Bridge recording not directly supported — use uuid_record on a channel. Name: ${params.name}`)
  }

  async stopRecording(recordingName: string): Promise<void> {
    // Would need channelId to stop — track in practice
    console.warn(`[esl] stopRecording ${recordingName} — needs channelId mapping`)
  }

  async getRecordingFile(recordingName: string): Promise<ArrayBuffer | null> {
    try {
      const file = Bun.file(`/tmp/recordings/${recordingName}`)
      if (await file.exists()) {
        return file.arrayBuffer()
      }
      return null
    } catch {
      return null
    }
  }

  async deleteRecording(recordingName: string): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises')
      await unlink(`/tmp/recordings/${recordingName}`)
    } catch {
      // File may already be deleted
    }
  }

  async setChannelVar(channelId: string, variable: string, value: string): Promise<void> {
    await this.apiCommand(`uuid_setvar ${channelId} ${variable} ${value}`)
  }

  async getChannelVar(channelId: string, variable: string): Promise<string> {
    const result = await this.apiCommand(`uuid_getvar ${channelId} ${variable}`)
    return result.trim()
  }

  async healthCheck(): Promise<BridgeHealthStatus> {
    const start = performance.now()
    try {
      await this.apiCommand('status')
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
      }
    } catch {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - start),
      }
    }
  }

  async listChannels(): Promise<Array<{ id: string; state: string; caller: string }>> {
    // Would parse "show channels" output
    return []
  }

  async listBridges(): Promise<Array<{ id: string; channels: string[] }>> {
    // FreeSWITCH doesn't have explicit bridge listing
    return []
  }
}
```

- [ ] Create `sip-bridge/src/clients/esl-client.test.ts` — unit test that verifies:
  - `parseHeaders()` correctly parses ESL header format
  - `translateEslEvent()` maps CHANNEL_CREATE to `channel_create` BridgeEvent
  - `translateEslEvent()` maps CHANNEL_ANSWER to `channel_answer` BridgeEvent
  - `translateEslEvent()` maps CHANNEL_HANGUP_COMPLETE to `channel_hangup` BridgeEvent with cause code
  - `translateEslEvent()` maps RECORD_STOP to `recording_complete` BridgeEvent
  - `translateEslEvent()` maps DTMF to `dtmf_received` BridgeEvent
  - `translateEslEvent()` returns null for unknown events

- [ ] Run `cd sip-bridge && bun run typecheck && bun test`
- [ ] Commit: `feat(sip-bridge): add FreeSWITCH ESL client implementing BridgeClient`

---

### Task 4: Kamailio JSONRPC Client

**Files:**
- Create: `sip-bridge/src/clients/kamailio-client.ts`
- Create: `sip-bridge/src/clients/kamailio-client.test.ts`

Kamailio is a SIP proxy, not a PBX. It does not handle call control. This client implements `BridgeClient` but throws on call-control methods. It provides management functionality (dispatcher health, stats) used by the health endpoint.

- [ ] Create `sip-bridge/src/clients/kamailio-client.ts`:

```typescript
import type {
  BridgeClient,
  BridgeEvent,
  BridgeHealthStatus,
  OriginateParams,
} from '../bridge-client'

/** Kamailio JSONRPC connection config */
export interface KamailioConfig {
  /** JSONRPC endpoint URL (e.g., http://kamailio:5060/jsonrpc) */
  jsonrpcUrl: string
  /** Dispatcher set ID for PBX instances (default: 1) */
  dispatcherSetId?: number
}

/** Dispatcher entry from Kamailio */
export interface DispatcherEntry {
  /** Destination URI (e.g., sip:freeswitch:5060) */
  uri: string
  /** Flags: AP=active+probing, IP=inactive+probing, etc. */
  flags: string
  /** Priority (lower = higher priority) */
  priority: number
}

/**
 * Kamailio JSONRPC client — management only (NOT call control).
 *
 * Kamailio is a SIP proxy/load balancer. It routes SIP traffic to PBX instances
 * but does not control individual calls. This client provides:
 *
 * - Dispatcher management: list/enable/disable PBX instances
 * - Statistics: SIP traffic counters for monitoring
 * - Health: combined Kamailio + dispatcher status
 *
 * All call control methods (originate, hangup, bridge, etc.) throw
 * UnsupportedOperationError — they must go through the PBX client.
 */
export class KamailioClient implements BridgeClient {
  private config: KamailioConfig

  constructor(config: KamailioConfig) {
    this.config = config
  }

  // ---- BridgeClient Lifecycle (no-op for HTTP client) ----

  async connect(): Promise<void> {
    // Verify JSONRPC endpoint is reachable
    const health = await this.healthCheck()
    if (!health.ok) {
      throw new Error(`Kamailio JSONRPC endpoint unreachable at ${this.config.jsonrpcUrl}`)
    }
    console.log('[kamailio] JSONRPC endpoint verified')
  }

  disconnect(): void {
    // HTTP client — nothing to disconnect
  }

  isConnected(): boolean {
    return true // Stateless HTTP — always "connected"
  }

  onEvent(_handler: (event: BridgeEvent) => void): void {
    // Kamailio doesn't emit call events — it's a SIP proxy
    // Health status changes are polled, not pushed
  }

  // ---- Call Control (all throw — Kamailio is not a PBX) ----

  async originate(_params: OriginateParams): Promise<{ id: string }> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async hangup(_channelId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async answer(_channelId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async bridge(_id1: string, _id2: string): Promise<string> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async destroyBridge(_bridgeId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async playMedia(_channelId: string, _media: string): Promise<string> {
    throw new Error('Kamailio is a SIP proxy — media operations are not supported. Use the PBX client.')
  }

  async stopPlayback(_playbackId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — media operations are not supported. Use the PBX client.')
  }

  async startMoh(_channelId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — media operations are not supported. Use the PBX client.')
  }

  async stopMoh(_channelId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — media operations are not supported. Use the PBX client.')
  }

  async recordChannel(_channelId: string, _params: { name: string }): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async recordBridge(_bridgeId: string, _params: { name: string }): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async stopRecording(_name: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async getRecordingFile(_name: string): Promise<ArrayBuffer | null> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async deleteRecording(_name: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async setChannelVar(_channelId: string, _variable: string, _value: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — channel variables are not supported. Use the PBX client.')
  }

  async getChannelVar(_channelId: string, _variable: string): Promise<string> {
    throw new Error('Kamailio is a SIP proxy — channel variables are not supported. Use the PBX client.')
  }

  async listChannels(): Promise<Array<{ id: string; state: string; caller: string }>> {
    throw new Error('Kamailio is a SIP proxy — channel listing is not supported. Use the PBX client.')
  }

  async listBridges(): Promise<Array<{ id: string; channels: string[] }>> {
    throw new Error('Kamailio is a SIP proxy — bridge listing is not supported. Use the PBX client.')
  }

  // ---- Health (supported) ----

  async healthCheck(): Promise<BridgeHealthStatus> {
    const start = performance.now()
    try {
      const result = await this.jsonrpc('core.version')
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        details: { version: result },
      }
    } catch {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - start),
      }
    }
  }

  // ---- Kamailio-specific Management Methods ----

  /** Get list of PBX instances from Kamailio dispatcher module */
  async getDispatchers(): Promise<DispatcherEntry[]> {
    const setId = this.config.dispatcherSetId ?? 1
    const result = await this.jsonrpc('dispatcher.list', { set: setId })
    // Parse dispatcher.list response
    if (!result || typeof result !== 'object') return []
    const sets = (result as { RECORDS?: Array<{ SET?: Array<{ TARGETS?: DispatcherEntry[] }> }> }).RECORDS
    if (!Array.isArray(sets)) return []
    const entries: DispatcherEntry[] = []
    for (const set of sets) {
      if (Array.isArray(set.SET)) {
        for (const target of set.SET) {
          if (target.TARGETS && Array.isArray(target.TARGETS)) {
            entries.push(...target.TARGETS)
          }
        }
      }
    }
    return entries
  }

  /** Enable or disable a PBX instance in the dispatcher set */
  async setDispatcherState(uri: string, state: 'active' | 'inactive'): Promise<void> {
    const setId = this.config.dispatcherSetId ?? 1
    // State values: 'a' = active, 'p' = probing, 'i' = inactive, 'ap' = active+probing
    const stateFlag = state === 'active' ? 'a' : 'i'
    await this.jsonrpc('dispatcher.set_state', {
      group: setId,
      address: uri,
      state: stateFlag,
    })
  }

  /** Reload the dispatcher list from config */
  async reloadDispatchers(): Promise<void> {
    await this.jsonrpc('dispatcher.reload')
  }

  /** Get SIP traffic statistics */
  async getStatistics(group?: string): Promise<Record<string, unknown>> {
    const params = group ? { group } : { group: 'all' }
    return this.jsonrpc('stats.get_statistics', params) as Promise<Record<string, unknown>>
  }

  // ---- JSONRPC Transport ----

  private async jsonrpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params: params ?? {},
    }

    const response = await fetch(this.config.jsonrpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Kamailio JSONRPC ${method} failed: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as { result?: unknown; error?: { code: number; message: string } }
    if (result.error) {
      throw new Error(`Kamailio JSONRPC error: ${result.error.code} ${result.error.message}`)
    }

    return result.result
  }
}
```

- [ ] Create `sip-bridge/src/clients/kamailio-client.test.ts` — unit test that verifies:
  - Call control methods (originate, hangup, bridge, etc.) all throw with the "SIP proxy" message
  - `healthCheck()` returns `{ ok: false }` when fetch fails (mock fetch)
  - `getDispatchers()` parses the dispatcher.list response format
  - `setDispatcherState()` sends correct JSONRPC params for 'active' and 'inactive'
  - `reloadDispatchers()` sends `dispatcher.reload` method
  - JSONRPC error responses are propagated as Error

- [ ] Run `cd sip-bridge && bun run typecheck && bun test`
- [ ] Commit: `feat(sip-bridge): add Kamailio JSONRPC client for dispatcher management`

---

### Task 5: Unified Entry Point + Webhook Sender + Health

**Files:**
- Create: `sip-bridge/src/index.ts`
- Move: `asterisk-bridge/src/webhook-sender.ts` to `sip-bridge/src/webhook-sender.ts` (with adaptations)
- Move: `asterisk-bridge/src/command-handler.ts` to `sip-bridge/src/command-handler.ts` (with adaptations)
- Move: `asterisk-bridge/src/pjsip-configurator.ts` to `sip-bridge/src/pjsip-configurator.ts`
- Move: `asterisk-bridge/src/endpoint-provisioner.ts` to `sip-bridge/src/endpoint-provisioner.ts`
- Create: `sip-bridge/Dockerfile`

- [ ] Copy `asterisk-bridge/src/webhook-sender.ts` to `sip-bridge/src/webhook-sender.ts`. Update the import paths to reference the new `types.ts` location. The `WebhookSender` class stays the same — it translates events into HTTP POSTs with HMAC signing and parses TwiML responses into bridge commands. No behavioral changes.

- [ ] Copy `asterisk-bridge/src/command-handler.ts` to `sip-bridge/src/command-handler.ts`. Update imports to reference the new file locations:
  - `./ari-client` becomes `./clients/ari-client`
  - `./types` stays as `./types`
  - `./webhook-sender` stays as `./webhook-sender`

  The `CommandHandler` currently takes an `AriClient` directly. For now, keep it ARI-specific — when FreeSWITCH needs a command handler, a new one will be created in Plan B. The important thing is that the `CommandHandler` is inside `sip-bridge/` and uses the extracted ARI client.

- [ ] Copy `asterisk-bridge/src/pjsip-configurator.ts` to `sip-bridge/src/pjsip-configurator.ts`. Update the AriClient import path to `./clients/ari-client`.

- [ ] Copy `asterisk-bridge/src/endpoint-provisioner.ts` to `sip-bridge/src/endpoint-provisioner.ts`. Update the AriClient import path to `./clients/ari-client`.

- [ ] Create `sip-bridge/src/index.ts` — the unified entry point that selects the active PBX client based on `PBX_TYPE` env var:

```typescript
import { AriClient } from './clients/ari-client'
import { EslClient } from './clients/esl-client'
import { KamailioClient } from './clients/kamailio-client'
import { CommandHandler } from './command-handler'
import { PjsipConfigurator } from './pjsip-configurator'
import type { BridgeConfig } from './types'
import { WebhookSender } from './webhook-sender'
import type { BridgeClient } from './bridge-client'

type PbxType = 'asterisk' | 'freeswitch'

function loadConfig(): BridgeConfig & { pbxType: PbxType; kamailioEnabled: boolean; kamailioJsonrpcUrl?: string } {
  const pbxType = (process.env.PBX_TYPE ?? 'asterisk') as PbxType
  if (pbxType !== 'asterisk' && pbxType !== 'freeswitch') {
    throw new Error(`Invalid PBX_TYPE: ${pbxType}. Must be 'asterisk' or 'freeswitch'.`)
  }

  const workerWebhookUrl = process.env.WORKER_WEBHOOK_URL
  const bridgeSecret = process.env.BRIDGE_SECRET
  const bridgePort = Number.parseInt(process.env.BRIDGE_PORT ?? '3000', 10)
  const bridgeBind = process.env.BRIDGE_BIND ?? '127.0.0.1'

  if (!workerWebhookUrl) throw new Error('WORKER_WEBHOOK_URL is required')
  if (!bridgeSecret) throw new Error('BRIDGE_SECRET is required')

  // ARI config (required for asterisk, ignored for freeswitch)
  const ariUrl = process.env.ARI_URL ?? 'ws://localhost:8088/ari/events'
  const ariRestUrl = process.env.ARI_REST_URL ?? 'http://localhost:8088/ari'
  const ariUsername = process.env.ARI_USERNAME ?? ''
  const ariPassword = process.env.ARI_PASSWORD ?? ''
  const stasisApp = process.env.STASIS_APP ?? 'llamenos'

  if (pbxType === 'asterisk') {
    if (!ariUsername) throw new Error('ARI_USERNAME is required for PBX_TYPE=asterisk')
    if (!ariPassword) throw new Error('ARI_PASSWORD is required for PBX_TYPE=asterisk')
  }

  // ESL config (required for freeswitch, ignored for asterisk)
  // Validation for ESL happens in EslClient constructor

  const connectionTimeoutMs = process.env.ARI_CONNECTION_TIMEOUT_MS
    ? Number.parseInt(process.env.ARI_CONNECTION_TIMEOUT_MS, 10)
    : undefined

  return {
    ariUrl,
    ariRestUrl,
    ariUsername,
    ariPassword,
    workerWebhookUrl,
    bridgeSecret,
    bridgePort,
    bridgeBind,
    stasisApp,
    sipProvider: process.env.SIP_PROVIDER,
    sipUsername: process.env.SIP_USERNAME,
    sipPassword: process.env.SIP_PASSWORD,
    connectionTimeoutMs,
    pbxType,
    kamailioEnabled: process.env.KAMAILIO_ENABLED === 'true',
    kamailioJsonrpcUrl: process.env.KAMAILIO_JSONRPC_URL,
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  console.log(`[bridge] Starting SIP Bridge (PBX_TYPE=${config.pbxType})...`)

  let pbxClient: BridgeClient
  let ariClient: AriClient | null = null // Kept for ARI-specific operations (CommandHandler, PjsipConfigurator)

  // SIP auto-config state
  let sipConfigured = false
  let sipConfigSkipped = false

  // Initialize PBX client
  if (config.pbxType === 'asterisk') {
    const ari = new AriClient(config)
    ariClient = ari
    pbxClient = ari
  } else {
    // FreeSWITCH
    const eslHost = process.env.ESL_HOST ?? 'localhost'
    const eslPort = Number.parseInt(process.env.ESL_PORT ?? '8021', 10)
    const eslPassword = process.env.ESL_PASSWORD
    if (!eslPassword) throw new Error('ESL_PASSWORD is required for PBX_TYPE=freeswitch')

    const esl = new EslClient({ host: eslHost, port: eslPort, password: eslPassword })
    pbxClient = esl
  }

  // Optional Kamailio management client
  let kamailioClient: KamailioClient | null = null
  if (config.kamailioEnabled && config.kamailioJsonrpcUrl) {
    kamailioClient = new KamailioClient({
      jsonrpcUrl: config.kamailioJsonrpcUrl,
    })
  }

  // Initialize webhook sender and command handler (ARI-specific for now)
  const webhook = new WebhookSender(config)
  let handler: CommandHandler | null = null

  if (ariClient) {
    handler = new CommandHandler(ariClient, webhook, config)

    if (process.env.HOTLINE_NUMBER) {
      handler.setHotlineNumber(process.env.HOTLINE_NUMBER)
    }

    // Register ARI event handler (raw events go through CommandHandler)
    // The CommandHandler uses raw ARI events, not BridgeEvents
    // This will be refactored in Plan B when we add a FreeSWITCH command handler
    ariClient.onEvent((event) => {
      handler!.handleEvent(event).catch((err) => {
        console.error('[bridge] Event handler error:', err)
      })
    })
  } else {
    // FreeSWITCH: register BridgeEvent handler
    // For now, just log events — Plan B adds the FreeSWITCH command handler
    pbxClient.onEvent((event) => {
      console.log(`[bridge] Event: ${event.type} channel=${('channelId' in event) ? event.channelId : 'N/A'}`)
    })
  }

  // Start HTTP server
  const server = Bun.serve({
    port: config.bridgePort,
    hostname: config.bridgeBind,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method

      // Health check (reports PBX + optional Kamailio status)
      if (path === '/health' && method === 'GET') {
        const pbxHealth = await pbxClient.healthCheck()
        const status: Record<string, unknown> = {
          status: pbxHealth.ok ? 'ok' : 'degraded',
          pbxType: config.pbxType,
          uptime: process.uptime(),
          sipConfigured,
          sipConfigSkipped,
          pbx: pbxHealth,
        }

        if (handler) {
          Object.assign(status, handler.getStatus())
        }

        if (kamailioClient) {
          try {
            const kamHealth = await kamailioClient.healthCheck()
            const dispatchers = await kamailioClient.getDispatchers()
            status.kamailio = {
              enabled: true,
              connected: kamHealth.ok,
              latencyMs: kamHealth.latencyMs,
              dispatchers: dispatchers.length,
              activeInstances: dispatchers.filter((d) => d.flags.includes('A')).length,
            }
          } catch (err) {
            status.kamailio = {
              enabled: true,
              connected: false,
              error: String(err),
            }
          }
        }

        return Response.json(status)
      }

      // Status endpoint (detailed) — ARI only for now
      if (path === '/status' && method === 'GET') {
        if (!ariClient) {
          return Response.json({ status: 'ok', pbxType: config.pbxType, note: 'Detailed status not yet supported for this PBX type' })
        }
        try {
          const ariInfo = await ariClient.getAsteriskInfo()
          const channels = await ariClient.listChannels()
          const bridges = await ariClient.listBridges()
          return Response.json({
            status: 'ok',
            bridge: handler?.getStatus(),
            asterisk: ariInfo,
            channels: channels.length,
            bridges: bridges.length,
          })
        } catch (err) {
          return Response.json(
            { status: 'error', error: String(err), bridge: handler?.getStatus() },
            { status: 500 }
          )
        }
      }

      // --- Remaining endpoints delegate to handler (ARI-specific for now) ---
      // Plan B will add protocol-agnostic versions of these endpoints.

      if (!handler || !ariClient) {
        return Response.json(
          { error: `Endpoint ${path} not yet supported for PBX_TYPE=${config.pbxType}` },
          { status: 501 }
        )
      }

      // Command endpoint
      if (path === '/command' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()
        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) {
            console.warn('[bridge] Invalid command signature')
            return new Response('Forbidden', { status: 403 })
          }
        }
        try {
          const data = JSON.parse(body) as Record<string, unknown>
          const result = await handler.handleHttpCommand(data)
          return Response.json(result, { status: result.ok ? 200 : 400 })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Ring volunteers endpoint
      if (path === '/ring' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()
        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) return new Response('Forbidden', { status: 403 })
        }
        try {
          const data = JSON.parse(body) as {
            callSid?: string
            parentCallSid?: string
            callerNumber: string
            volunteers: Array<{ pubkey: string; phone?: string; browserIdentity?: string }>
            callbackUrl: string
          }
          const parentCallSid = data.parentCallSid ?? data.callSid ?? ''
          const channelIds: string[] = []
          for (const vol of data.volunteers) {
            if (vol.phone) {
              const endpoint = `PJSIP/${vol.phone}@trunk`
              try {
                const channel = await ariClient.originate({
                  endpoint,
                  callerId: data.callerNumber,
                  timeout: 30,
                  app: config.stasisApp,
                  appArgs: `dialed,${parentCallSid},${vol.pubkey},phone`,
                })
                channelIds.push(channel.id)
                const parentCall = handler.getCall(parentCallSid)
                if (parentCall) parentCall.ringingChannels.push(channel.id)
                handler.trackRingingChannel(channel.id, parentCallSid)
              } catch (err) {
                console.error(`[bridge] Failed to ring ${vol.pubkey} (phone):`, err)
              }
            }
            if (vol.browserIdentity) {
              const endpoint = `PJSIP/${vol.browserIdentity}`
              try {
                const channel = await ariClient.originate({
                  endpoint,
                  callerId: data.callerNumber,
                  timeout: 30,
                  app: config.stasisApp,
                  appArgs: `dialed,${parentCallSid},${vol.pubkey},browser`,
                })
                channelIds.push(channel.id)
                const parentCall = handler.getCall(parentCallSid)
                if (parentCall) parentCall.ringingChannels.push(channel.id)
                handler.trackRingingChannel(channel.id, parentCallSid)
              } catch (err) {
                console.error(`[bridge] Failed to ring ${vol.pubkey} (browser):`, err)
              }
            }
          }
          return Response.json({ ok: true, channelIds })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Cancel ringing
      if (path === '/cancel-ringing' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()
        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) return new Response('Forbidden', { status: 403 })
        }
        try {
          const data = JSON.parse(body) as { channelIds: string[]; exceptId?: string }
          for (const id of data.channelIds) {
            if (id !== data.exceptId) {
              try { await ariClient.hangupChannel(id) } catch { /* may already be gone */ }
            }
          }
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Get recording audio
      if (path.startsWith('/recordings/') && method === 'GET') {
        const signature = request.headers.get('X-Bridge-Signature') ?? url.searchParams.get('sig') ?? ''
        if (config.bridgeSecret && !signature) return new Response('Forbidden', { status: 403 })
        const name = path.replace('/recordings/', '')
        try {
          const audio = await ariClient.getRecordingFile(name)
          if (!audio) return new Response('Not Found', { status: 404 })
          return new Response(audio, {
            headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(audio.byteLength) },
          })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      }

      // Hangup
      if (path === '/hangup' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()
        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) return new Response('Forbidden', { status: 403 })
        }
        try {
          const data = JSON.parse(body) as { channelId: string }
          await ariClient.hangupChannel(data.channelId)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Provision SIP endpoint
      if (path === '/provision-endpoint' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()
        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) return new Response('Forbidden', { status: 403 })
        }
        try {
          const { pubkey } = JSON.parse(body) as { pubkey: string }
          const { provisionEndpoint } = await import('./endpoint-provisioner')
          const result = await provisionEndpoint(ariClient, pubkey)
          return Response.json({ ok: true, ...result })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Deprovision SIP endpoint
      if (path === '/deprovision-endpoint' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()
        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) return new Response('Forbidden', { status: 403 })
        }
        try {
          const { pubkey } = JSON.parse(body) as { pubkey: string }
          const { deprovisionEndpoint } = await import('./endpoint-provisioner')
          await deprovisionEndpoint(ariClient, pubkey)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Check SIP endpoint
      if (path === '/check-endpoint' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()
        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) return new Response('Forbidden', { status: 403 })
        }
        try {
          const { pubkey } = JSON.parse(body) as { pubkey: string }
          const username = `vol_${pubkey.slice(0, 12)}`
          try {
            await ariClient.getAsteriskInfo()
            return Response.json({ ok: true, exists: true, username })
          } catch {
            return Response.json({ ok: true, exists: false })
          }
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[bridge] HTTP server listening on port ${config.bridgePort}`)

  // Connect to PBX
  try {
    await pbxClient.connect()
    console.log(`[bridge] Connected to ${config.pbxType}`)
  } catch (err) {
    console.error(`[bridge] Failed to connect to ${config.pbxType}:`, err)
    console.log('[bridge] Will retry connection...')
  }

  // Verify PBX connectivity
  try {
    const health = await pbxClient.healthCheck()
    console.log(`[bridge] PBX health: ok=${health.ok} latency=${health.latencyMs}ms`)
  } catch (err) {
    console.warn('[bridge] Could not check PBX health:', err)
  }

  // Connect Kamailio if enabled
  if (kamailioClient) {
    try {
      await kamailioClient.connect()
      console.log('[bridge] Kamailio JSONRPC connected')
    } catch (err) {
      console.warn('[bridge] Kamailio connection failed (non-fatal):', err)
    }
  }

  // Auto-configure PJSIP SIP trunk (Asterisk only)
  if (config.pbxType === 'asterisk' && ariClient && config.sipProvider && config.sipUsername && config.sipPassword) {
    try {
      const pjsip = new PjsipConfigurator(ariClient)
      await pjsip.configure(config.sipProvider, config.sipUsername, config.sipPassword)
      sipConfigured = true
    } catch (err) {
      console.error('[bridge] PJSIP auto-config failed:', err)
    }
  } else if (config.pbxType === 'asterisk') {
    console.log('[bridge] SIP env vars not set — skipping PJSIP auto-config')
    sipConfigSkipped = true
  }

  console.log(`[bridge] SIP Bridge is running (PBX_TYPE=${config.pbxType})`)
  console.log(`[bridge] Webhook target: ${config.workerWebhookUrl}`)

  // Graceful shutdown
  const shutdown = () => {
    console.log('[bridge] Shutting down...')
    pbxClient.disconnect()
    server.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[bridge] Fatal error:', err)
  process.exit(1)
})
```

- [ ] Create `sip-bridge/Dockerfile`:

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY sip-bridge/package.json sip-bridge/bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source code
COPY sip-bridge/src/ src/
COPY sip-bridge/tsconfig.json ./

# Type check
RUN bun run typecheck

# Build
RUN bun build src/index.ts --outdir dist --target bun

# Production stage
FROM oven/bun:1
WORKDIR /app

COPY --from=base /app/dist/ dist/
COPY --from=base /app/package.json ./

# Environment variables (set at runtime)
ENV PBX_TYPE=asterisk
ENV ARI_URL=ws://asterisk:8088/ari/events
ENV ARI_REST_URL=http://asterisk:8088/ari
ENV ARI_USERNAME=llamenos
# ARI_PASSWORD must be set at runtime — no default (CWE-798)
ENV WORKER_WEBHOOK_URL=https://your-app.example.com
# BRIDGE_SECRET must be set at runtime — no default
ENV BRIDGE_PORT=3000
ENV BRIDGE_BIND=0.0.0.0
ENV STASIS_APP=llamenos

# FreeSWITCH ESL (used when PBX_TYPE=freeswitch)
ENV ESL_HOST=freeswitch
ENV ESL_PORT=8021
# ESL_PASSWORD must be set at runtime

# Kamailio (optional)
ENV KAMAILIO_ENABLED=false
# KAMAILIO_JSONRPC_URL must be set when KAMAILIO_ENABLED=true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/index.js"]
```

- [ ] Copy `asterisk-bridge/asterisk-config/` directory to `sip-bridge/asterisk-config/` (these are Asterisk configuration files, not bridge-specific)
- [ ] Copy any remaining test files from `asterisk-bridge/` to `sip-bridge/`
- [ ] Run `cd sip-bridge && bun install && bun run typecheck`
- [ ] Commit: `feat(sip-bridge): unified entry point with PBX_TYPE selection, webhook sender, health, Dockerfile`

---

### Task 6: SipBridgeAdapter Abstract Base Class

**Files:**
- Create: `src/server/telephony/sip-bridge-adapter.ts`
- Modify: `src/server/telephony/asterisk.ts`

This extracts ~200 lines of shared bridge communication logic from `AsteriskAdapter` into an abstract base class. Both `AsteriskAdapter` and future `FreeSwitchAdapter` will extend it.

- [ ] Create `src/server/telephony/sip-bridge-adapter.ts`:

```typescript
import type { ConnectionTestResult } from '@shared/types'
import type {
  AudioUrlMap,
  RingUsersParams,
  TelephonyAdapter,
  TelephonyResponse,
  WebhookCallInfo,
  WebhookCallStatus,
  WebhookDigits,
  WebhookQueueResult,
  WebhookQueueWait,
  WebhookRecordingStatus,
  WebhookVerificationResult,
} from './adapter'
import { BridgeClient } from './bridge-client'

/**
 * SipBridgeAdapter — abstract base class for self-hosted PBX adapters
 * that communicate with a sip-bridge sidecar process.
 *
 * Shared logic:
 * - HMAC-authenticated HTTP client to sip-bridge (ring, cancel, hangup, recordings)
 * - Webhook validation (HMAC-SHA256 with constant-time comparison)
 * - Recording fetch/delete via bridge REST API
 * - testConnection via bridge health endpoint
 *
 * Subclasses implement:
 * - IVR command generation (handleLanguageMenu, handleIncomingCall, etc.)
 *   in their protocol-specific format (ARI JSON commands, mod_httapi XML, etc.)
 * - Webhook parsing for their specific event format
 */
export abstract class SipBridgeAdapter implements TelephonyAdapter {
  protected bridge: BridgeClient

  constructor(
    protected phoneNumber: string,
    protected bridgeCallbackUrl: string,
    protected bridgeSecret: string
  ) {
    this.bridge = new BridgeClient(bridgeCallbackUrl, bridgeSecret)
  }

  // ---- Shared Call Management (REST calls to sip-bridge) ----

  async hangupCall(callSid: string): Promise<void> {
    await this.bridge.request('POST', '/commands/hangup', { channelId: callSid })
  }

  async ringUsers(params: RingUsersParams): Promise<string[]> {
    const { callSid, callerNumber, users, callbackUrl, hubId } = params
    const result = await this.bridge.request('POST', '/ring', {
      parentCallSid: callSid,
      callerNumber,
      users: users.map((v) => ({
        pubkey: v.pubkey,
        phone: v.phone,
        browserIdentity: v.browserIdentity,
      })),
      callbackUrl,
      hubId,
    })
    return (result as { ok?: boolean; channelIds?: string[] })?.channelIds ?? []
  }

  async cancelRinging(callSids: string[], exceptSid?: string): Promise<void> {
    await this.bridge.request('POST', '/commands/cancel-ringing', {
      callSids,
      exceptSid,
    })
  }

  async getCallRecording(callSid: string): Promise<ArrayBuffer | null> {
    try {
      const result = await this.bridge.request('GET', `/recordings/call/${callSid}`)
      if (result && typeof result === 'object' && 'audio' in result) {
        const base64 = (result as { audio: string }).audio
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes.buffer
      }
      return null
    } catch {
      return null
    }
  }

  async getRecordingAudio(recordingSid: string): Promise<ArrayBuffer | null> {
    try {
      const result = await this.bridge.request('GET', `/recordings/${recordingSid}`)
      if (result && typeof result === 'object' && 'audio' in result) {
        const base64 = (result as { audio: string }).audio
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes.buffer
      }
      return null
    } catch {
      return null
    }
  }

  async deleteRecording(recordingSid: string): Promise<void> {
    try {
      await this.bridge.request('DELETE', `/recordings/${recordingSid}`)
    } catch (err) {
      console.error('[sip-bridge-adapter] Failed to delete recording:', err)
    }
  }

  // ---- Shared Webhook Validation (HMAC-SHA256) ----

  async validateWebhook(request: Request): Promise<boolean> {
    const signature = request.headers.get('X-Bridge-Signature')
    if (!signature) return false

    const body = await request.clone().text()
    const timestamp = request.headers.get('X-Bridge-Timestamp') || ''

    // Reject webhooks with timestamps older than 5 minutes (replay protection)
    const tsSeconds = Number.parseInt(timestamp, 10)
    if (Number.isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
      return false
    }

    const payload = `${timestamp}.${body}`

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.bridgeSecret) as Uint8Array<ArrayBuffer>,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload) as Uint8Array<ArrayBuffer>
    )
    const expectedSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSig.length) return false
    const encoder = new TextEncoder()
    const aBuf = encoder.encode(signature)
    const bBuf = encoder.encode(expectedSig)
    let result = 0
    for (let i = 0; i < aBuf.length; i++) {
      result |= aBuf[i] ^ bBuf[i]
    }
    return result === 0
  }

  // ---- Shared Webhook Config ----

  async verifyWebhookConfig(
    _phoneNumber: string,
    _expectedBaseUrl: string
  ): Promise<WebhookVerificationResult> {
    // Self-hosted PBX — we control the dialplan directly.
    // No external webhook configuration to verify.
    return { configured: true }
  }

  // ---- Shared testConnection via bridge health ----

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const result = await this.bridge.request('GET', '/health')
      const health = result as { status?: string; uptime?: number }
      if (health?.status === 'ok') {
        return {
          success: true,
          message: `SIP bridge connected (uptime: ${Math.round(health.uptime ?? 0)}s)`,
        }
      }
      return { success: false, message: `SIP bridge unhealthy: ${JSON.stringify(health)}` }
    } catch (err) {
      return { success: false, message: `SIP bridge unreachable: ${String(err)}` }
    }
  }

  // ---- Abstract IVR / Call Flow Methods (subclass-specific) ----
  // These are declared by TelephonyAdapter but must be implemented
  // by each PBX-specific subclass (ARI JSON, mod_httapi XML, etc.)

  abstract handleLanguageMenu(params: Parameters<TelephonyAdapter['handleLanguageMenu']>[0]): Promise<TelephonyResponse>
  abstract handleIncomingCall(params: Parameters<TelephonyAdapter['handleIncomingCall']>[0]): Promise<TelephonyResponse>
  abstract handleCaptchaResponse(params: Parameters<TelephonyAdapter['handleCaptchaResponse']>[0]): Promise<TelephonyResponse>
  abstract handleCallAnswered(params: Parameters<TelephonyAdapter['handleCallAnswered']>[0]): Promise<TelephonyResponse>
  abstract handleVoicemail(params: Parameters<TelephonyAdapter['handleVoicemail']>[0]): Promise<TelephonyResponse>
  abstract handleWaitMusic(lang: string, audioUrls?: AudioUrlMap, queueTime?: number, queueTimeout?: number): Promise<TelephonyResponse>
  abstract rejectCall(): TelephonyResponse
  abstract handleVoicemailComplete(lang: string): TelephonyResponse
  abstract handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse
  abstract emptyResponse(): TelephonyResponse

  // ---- Abstract Webhook Parsing (subclass-specific) ----

  abstract parseIncomingWebhook(request: Request): Promise<WebhookCallInfo>
  abstract parseLanguageWebhook(request: Request): Promise<WebhookCallInfo & WebhookDigits>
  abstract parseCaptchaWebhook(request: Request): Promise<WebhookDigits & { callerNumber: string }>
  abstract parseCallStatusWebhook(request: Request): Promise<WebhookCallStatus>
  abstract parseQueueWaitWebhook(request: Request): Promise<WebhookQueueWait>
  abstract parseQueueExitWebhook(request: Request): Promise<WebhookQueueResult>
  abstract parseRecordingWebhook(request: Request): Promise<WebhookRecordingStatus>
}
```

- [ ] Refactor `src/server/telephony/asterisk.ts` to extend `SipBridgeAdapter` instead of implementing `TelephonyAdapter` directly. Remove the duplicated methods (hangupCall, ringUsers, cancelRinging, getCallRecording, getRecordingAudio, deleteRecording, validateWebhook, verifyWebhookConfig) and keep only the ARI-specific IVR command generation and webhook parsing:

```typescript
import { SipBridgeAdapter } from './sip-bridge-adapter'
// ... (keep existing imports for voice prompts, languages)

export class AsteriskAdapter extends SipBridgeAdapter {
  constructor(
    private ariUrl: string,
    private ariUsername: string,
    private ariPassword: string,
    phoneNumber: string,
    bridgeCallbackUrl: string,
    bridgeSecret: string
  ) {
    super(phoneNumber, bridgeCallbackUrl, bridgeSecret)
  }

  // ... (keep all IVR methods: handleLanguageMenu, handleIncomingCall, etc.)
  // ... (keep all webhook parsing methods: parseIncomingWebhook, etc.)
  // ... (keep all ARI command types and helpers)

  // Override testConnection to use Asterisk-specific capabilities
  override async testConnection() {
    const { asteriskCapabilities } = await import('./asterisk-capabilities')
    return asteriskCapabilities.testConnection({
      type: 'asterisk',
      phoneNumber: this.phoneNumber,
      ariUrl: this.ariUrl,
      ariUsername: this.ariUsername,
      ariPassword: this.ariPassword,
      bridgeCallbackUrl: this.bridgeCallbackUrl,
    } as Parameters<typeof asteriskCapabilities.testConnection>[0])
  }
}
```

- [ ] Verify that `AsteriskAdapter` no longer duplicates any code that exists in `SipBridgeAdapter`. The following methods should be removed from `AsteriskAdapter` (inherited from base):
  - `hangupCall` (was lines 244-246)
  - `ringUsers` (was lines 248-262)
  - `cancelRinging` (was lines 264-269)
  - `getCallRecording` (was lines 271-286)
  - `getRecordingAudio` (was lines 288-302)
  - `deleteRecording` (was lines 304-310)
  - `validateWebhook` (was lines 314-355)
  - `verifyWebhookConfig` (was lines 421-428)
  - The `bridge` field declaration (now inherited from `SipBridgeAdapter`)

- [ ] Run `bun run typecheck && bun run build`
- [ ] Run `bun run test:unit` to verify existing asterisk adapter tests still pass
- [ ] Commit: `refactor: extract SipBridgeAdapter base class, AsteriskAdapter extends it`

---

### Task 7: Comprehensive Migration (121 Files)

This task has three sub-tasks. They can be executed in parallel since they touch non-overlapping file sets.

#### Task 7a: Core Rename (Code + Schemas)

**Files:**
- Remove: `asterisk-bridge/` directory (after verifying `sip-bridge/` is complete)
- Rename: `src/shared/schemas/external/asterisk-bridge.ts` to `src/shared/schemas/external/sip-bridge.ts`
- Modify: `src/shared/schemas/external/sip-bridge.ts` (rename exports)
- Modify: `src/server/telephony/bridge-client.ts` (update comment)
- Modify: `src/server/telephony/asterisk-provisioner.ts` (update comment)
- Modify: `src/server/telephony/sip-trunk-provisioner.ts` (update comment)
- Modify: `src/server/telephony/webrtc-tokens.test.ts` (update comment)
- Modify: `tests/helpers/simulation.ts` (update import)
- Modify: `tests/asterisk-auto-config.spec.ts` (update if references bridge paths)
- Modify: `tests/global-teardown.ts` (update references)
- Modify: `tests/api/sip-webrtc.spec.ts` (update references)
- Modify: `package.json` (update any scripts referencing asterisk-bridge)

- [ ] Verify `sip-bridge/` is complete and typechecks: `cd sip-bridge && bun run typecheck`

- [ ] Delete the `asterisk-bridge/` directory: `rm -rf asterisk-bridge`

- [ ] Rename the schema file: `git mv src/shared/schemas/external/asterisk-bridge.ts src/shared/schemas/external/sip-bridge.ts`

- [ ] In `src/shared/schemas/external/sip-bridge.ts`, rename the exports while keeping backward compatibility aliases:

  - `AsteriskRingResultSchema` stays (it's Asterisk-specific ARI ring result)
  - `AsteriskRecordingAudioSchema` stays (ARI-specific recording format)
  - `AsteriskHealthSchema` stays (ARI-specific health fields)
  - `AsteriskCommandAckSchema` stays (ARI-specific command ack)
  - `AsteriskBridgeWebhookSchema` rename to `SipBridgeWebhookSchema`
  - `AsteriskBridgeWebhook` rename to `SipBridgeWebhook`
  - Add: `export { SipBridgeWebhookSchema as AsteriskBridgeWebhookSchema }` — backward compat alias
  - Add: `export type { SipBridgeWebhook as AsteriskBridgeWebhook }` — backward compat alias
  - Update JSDoc to say "sip-bridge" instead of "asterisk-bridge"

- [ ] Update `src/server/telephony/bridge-client.ts` comment: `"HMAC-authenticated HTTP client for the sip-bridge."` (line 2)

- [ ] Update `src/server/telephony/asterisk-provisioner.ts` comment: `"via the sip-bridge service"` (line 6)

- [ ] Update `src/server/telephony/sip-trunk-provisioner.ts` comment: `"Provisions a SIP trunk in Asterisk via the sip-bridge ARI service."` (line 88)

- [ ] Update `src/server/telephony/webrtc-tokens.test.ts` — no functional changes needed, just verify it still compiles

- [ ] Update `tests/helpers/simulation.ts`: change import from `'@shared/schemas/external/asterisk-bridge'` to `'@shared/schemas/external/sip-bridge'` (line 2). The `AsteriskBridgeWebhook` type alias is available from the new file.

- [ ] Update `tests/global-teardown.ts` — update any `asterisk-bridge` references to `sip-bridge`

- [ ] Update `tests/api/sip-webrtc.spec.ts` — update any `asterisk-bridge` references to `sip-bridge`

- [ ] Check `package.json` for any scripts referencing `asterisk-bridge` and update to `sip-bridge`

- [ ] Run `bun run typecheck && bun run build`
- [ ] Commit: `refactor: rename asterisk-bridge to sip-bridge, update schemas and imports`

#### Task 7b: CI / Deploy / Docker

**Files:**
- Modify: `.github/workflows/docker.yml`
- Modify: `.github/workflows/ci.yml` (if references exist)
- Modify: `.github/actions/start-test-infra/action.yml`
- Modify: `deploy/docker/docker-compose.yml`
- Modify: `deploy/docker/docker-compose.dev.yml`
- Modify: `deploy/docker/docker-compose.dev-idp.yml`
- Modify: `deploy/ansible/roles/llamenos/templates/docker-compose.j2`
- Modify: `deploy/ansible/templates/docker-compose.j2`
- Modify: `deploy/helm/llamenos/values.yaml`
- Modify: `scripts/docker-setup.sh`
- Modify: `scripts/dev-certs.sh`
- Modify: `scripts/kill-runaway-bun.sh`

- [ ] Update `.github/workflows/docker.yml`:
  - Line 71 comment: `# Build sip bridge image`
  - Line 96: `images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}-sip-bridge`
  - Line 106: `file: sip-bridge/Dockerfile`

- [ ] Update `.github/actions/start-test-infra/action.yml`:
  - Lines 11-15: Change `asterisk-bridge/asterisk-config/` to `sip-bridge/asterisk-config/`
  - Line 26: Change `cd asterisk-bridge && bun install` to `cd sip-bridge && bun install`

- [ ] Update `deploy/docker/docker-compose.yml`:
  - Line 13 comment: `#   sip-bridge - ARI/ESL/JSONRPC-to-webhook translator (profile: asterisk, freeswitch)`
  - Lines 261-265: Change `../../asterisk-bridge/asterisk-config/` to `../../sip-bridge/asterisk-config/`
  - Line 275: `sip-bridge:` (service name)
  - Line 279: `dockerfile: sip-bridge/Dockerfile`

- [ ] Update `deploy/docker/docker-compose.dev.yml`:
  - Lines 47-48: Change `../asterisk-bridge/dev-certs/` to `../sip-bridge/dev-certs/`
  - Line 51: `sip-bridge:` (service name)

- [ ] Update `deploy/docker/docker-compose.dev-idp.yml`:
  - Lines 52-53: Change `../asterisk-bridge/dev-certs/` to `../sip-bridge/dev-certs/`
  - Line 56: `sip-bridge:` (service name)

- [ ] Update `deploy/ansible/roles/llamenos/templates/docker-compose.j2`:
  - Line 266: `sip-bridge:` (service name)
  - Line 268 command: `["bun", "run", "sip-bridge/index.ts"]`

- [ ] Update `deploy/ansible/templates/docker-compose.j2`:
  - Line 190: `sip-bridge:`
  - Line 191: `image: {{ llamenos_image }}-sip-bridge`

- [ ] Update `deploy/helm/llamenos/values.yaml`:
  - Line 77: `repository: ghcr.io/your-org/llamenos-sip-bridge`

- [ ] Update `scripts/docker-setup.sh`:
  - Line 131 comment: `# SIP bridge — ARI_PASSWORD must match sip-bridge/asterisk-config/ari.conf`

- [ ] Update `scripts/dev-certs.sh`:
  - Line 7: `# Generates certs in sip-bridge/dev-certs/ for:`
  - Line 12: `CERT_DIR="sip-bridge/dev-certs"`

- [ ] Update `scripts/kill-runaway-bun.sh`:
  - Line 10: Replace `asterisk-bridge` with `sip-bridge` in the pattern match

- [ ] Commit: `chore: update CI, Docker, Ansible, Helm, scripts for sip-bridge rename`

#### Task 7c: Documentation / Locales / CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `DEVELOPMENT.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/NEXT_BACKLOG.md`
- Modify: `docs/COMPLETED_BACKLOG.md`
- Modify: Various `docs/epics/` and `docs/superpowers/` files (update references only, not plans)
- Modify: `.claude/skills/test-runner/SKILL.md`
- Modify: `.claude/skills/test-runner/references/worktree-ports.md`

- [ ] Update `CLAUDE.md` — search and replace all occurrences of `asterisk-bridge` with `sip-bridge`:
  - Directory structure section: `asterisk-bridge/` becomes `sip-bridge/` (or remove if not in the structure listing — check current state)
  - JsSIP bullet: `reloadModule('res_pjsip.so')` note — no change needed (Asterisk-specific behavior)
  - Any other references

- [ ] Update `DEVELOPMENT.md` — replace `asterisk-bridge` references with `sip-bridge`

- [ ] Update `README.md` — replace `asterisk-bridge` references with `sip-bridge`

- [ ] Update `docs/RUNBOOK.md` — replace `asterisk-bridge` references with `sip-bridge`

- [ ] Update `docs/NEXT_BACKLOG.md` — replace `asterisk-bridge` references

- [ ] Update `docs/COMPLETED_BACKLOG.md` — add entry for the sip-bridge refactor

- [ ] Update `.claude/skills/test-runner/SKILL.md` — replace `asterisk-bridge` references

- [ ] Update `.claude/skills/test-runner/references/worktree-ports.md` — replace `asterisk-bridge` references

- [ ] For doc/plan files in `docs/epics/` and `docs/superpowers/plans/`: do a search-and-replace of `asterisk-bridge` to `sip-bridge` in these specific files (historical plans that reference the bridge by name):
  - `docs/epics/epic-49-asterisk-bridge-auto-config.md` — update title and references
  - `docs/epics/epic-53-security-audit-hardening.md` — update references
  - `docs/epics/epic-65-security-audit-r6-medium.md` — update references
  - `docs/superpowers/plans/2026-03-22-asterisk-bridge-auto-config.md` — update references
  - `docs/superpowers/plans/2026-03-23-provider-capabilities-interface.md` — update references
  - `docs/superpowers/plans/2026-03-25-sip-webrtc-browser-calling.md` — update references
  - `docs/superpowers/plans/2026-03-25-voicemail-phase3-notifications-playback.md` — update references
  - `docs/superpowers/plans/2026-03-29-backend-performance.md` — update references
  - `docs/superpowers/specs/2026-03-25-sip-webrtc-browser-calling-design.md` — update references
  - `docs/superpowers/specs/2026-03-25-voicemail-completion-design.md` — update references
  - `docs/superpowers/specs/2026-04-03-freeswitch-adapter-design.md` — update references
  - `docs/security/SECURITY_AUDIT_2026-02-R6.md` — update references

- [ ] Run `bun run typecheck && bun run build` (final verification)
- [ ] Commit: `docs: update all documentation and locale references from asterisk-bridge to sip-bridge`

---

## Summary

| Task | Description | Key Files | Depends On |
|------|-------------|-----------|------------|
| 1 | BridgeClient interface + scaffold | `sip-bridge/src/bridge-client.ts`, `package.json`, `tsconfig.json` | None |
| 2 | Extract ARI client | `sip-bridge/src/clients/ari-client.ts` | Task 1 |
| 3 | ESL client for FreeSWITCH | `sip-bridge/src/clients/esl-client.ts` | Task 1 |
| 4 | Kamailio JSONRPC client | `sip-bridge/src/clients/kamailio-client.ts` | Task 1 |
| 5 | Unified entry point + webhook + health + Dockerfile | `sip-bridge/src/index.ts`, `sip-bridge/Dockerfile` | Tasks 2, 3, 4 |
| 6 | SipBridgeAdapter base class | `src/server/telephony/sip-bridge-adapter.ts`, `asterisk.ts` refactor | None (parallel with Tasks 1-5) |
| 7a | Core rename (code + schemas) | Schema rename, import updates, delete `asterisk-bridge/` | Tasks 5, 6 |
| 7b | CI / Deploy / Docker | Workflows, Docker Compose, Ansible, Helm, scripts | Task 7a |
| 7c | Docs / Locales / CLAUDE.md | CLAUDE.md, README, DEVELOPMENT.md, docs/, skills/ | Task 7a |

**Parallelism:** Tasks 2, 3, 4 are independent (all depend only on Task 1). Task 6 is independent of Tasks 1-5. Tasks 7b and 7c can run in parallel after 7a.

**Test commands:**
- `cd sip-bridge && bun run typecheck` — typecheck the sip-bridge project
- `cd sip-bridge && bun test` — run sip-bridge unit tests
- `bun run typecheck` — typecheck the main Llamenos project
- `bun run build` — build the main project (catches import errors)
- `bun run test:unit` — run all unit tests (verifies asterisk adapter still works after refactor)
- `bun run test:api` — run API integration tests (verifies bridge client still works)

**Rollback:** If anything breaks, `git revert` the migration commits. The `SipBridgeAdapter` base class and `sip-bridge/` project are additive until Task 7a deletes `asterisk-bridge/`.
