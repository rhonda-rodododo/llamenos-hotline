import type {
  BridgeClient,
  BridgeEvent,
  BridgeHealthStatus,
  OriginateParams,
} from '../bridge-client'

export interface EslConfig {
  /** Default: 'localhost' */
  host: string
  /** Default: 8021 */
  port: number
  /** FreeSWITCH ESL password (default: 'ClueCon') */
  password: string
  connectionTimeoutMs?: number
}

type EventHandler = (event: BridgeEvent) => void

/** Parsed ESL message: headers map plus optional body */
interface EslMessage {
  headers: Record<string, string>
  body: string
}

/**
 * ESL Client — connects to FreeSWITCH's Event Socket Library over TCP.
 * Authenticates, subscribes to call events, and translates them to normalized
 * BridgeEvent objects via the BridgeClient interface.
 *
 * Protocol: text-based headers (Key: Value\n) terminated by \n\n with an
 * optional body whose length is given by Content-Length.
 */
export class EslClient implements BridgeClient {
  private readonly config: EslConfig
  private socket: ReturnType<typeof Bun.connect> | null = null
  private eventHandlers: EventHandler[] = []
  private connected = false
  private shouldReconnect = true
  private reconnectDelay = 1000
  private readonly maxReconnectDelay = 30_000
  private hasConnected = false
  private connectionDeadline: number | null = null
  private readonly connectionTimeoutMs: number

  /** Pending data buffer — accumulates raw bytes from TCP stream */
  private buffer = ''

  /** Pending command callbacks: queue of resolve/reject pairs waiting for api/bgapi responses */
  private commandQueue: Array<{
    resolve: (result: string) => void
    reject: (err: Error) => void
  }> = []

  constructor(config: Partial<EslConfig> & { password: string }) {
    this.config = {
      host: config.host ?? 'localhost',
      port: config.port ?? 8021,
      password: config.password,
    }
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
    if (this.socket) {
      try {
        // Bun TCP socket exposes end() to half-close or we can just destroy it
        const sock = this.socket as unknown as { end: () => void; destroy: () => void }
        if (typeof sock.end === 'function') {
          sock.end()
        } else if (typeof sock.destroy === 'function') {
          sock.destroy()
        }
      } catch {
        // ignore
      }
      this.socket = null
    }
  }

  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[esl] Connecting to ${this.config.host}:${this.config.port}...`)

      const self = this

      Bun.connect({
        hostname: this.config.host,
        port: this.config.port,
        socket: {
          open(socket) {
            console.log('[esl] TCP connected')
            self.socket = socket as unknown as ReturnType<typeof Bun.connect>
            // FreeSWITCH sends "Content-Type: auth/request\n\n" on connect —
            // we wait for that before sending auth
          },
          data(_socket, data) {
            self.buffer += new TextDecoder().decode(data)
            self.processBuffer(resolve, reject)
          },
          close() {
            console.log('[esl] TCP disconnected')
            self.connected = false
            self.socket = null
            if (self.shouldReconnect) {
              self.scheduleReconnect()
            }
          },
          error(_socket, error) {
            console.error('[esl] TCP error:', error)
            self.connected = false
            if (!self.hasConnected) {
              reject(error)
            }
          },
          connectError(_socket, error) {
            console.error('[esl] TCP connect error:', error)
            reject(error)
          },
        },
      }).catch(reject)
    })
  }

  /**
   * Process the accumulated data buffer, extracting complete ESL messages.
   * ESL messages are delimited by \n\n (double newline). If Content-Length
   * is present, the body follows immediately after the header block.
   *
   * resolve/reject are only used during the auth handshake phase.
   */
  private processBuffer(
    resolve?: (value: undefined) => void,
    reject?: (reason: Error) => void
  ): void {
    for (;;) {
      const separatorIdx = this.buffer.indexOf('\n\n')
      if (separatorIdx === -1) break
      const headerBlock = this.buffer.slice(0, separatorIdx)
      let rest = this.buffer.slice(separatorIdx + 2)

      const headers = this.parseHeaders(headerBlock)

      // If Content-Length is set, read that many bytes as the body
      let body = ''
      const contentLength = headers['Content-Length']
      if (contentLength !== undefined) {
        const len = Number.parseInt(contentLength, 10)
        if (rest.length < len) {
          // Wait for more data
          break
        }
        body = rest.slice(0, len)
        rest = rest.slice(len)
      }

      this.buffer = rest

      const message: EslMessage = { headers, body }
      this.handleMessage(message, resolve, reject)
    }
  }

  /**
   * Parse ESL header block into a key→value map.
   * Header format: "Key: Value\nKey: Value\n..."
   * Values are URL-encoded by FreeSWITCH and must be decoded.
   */
  public parseHeaders(headerBlock: string): Record<string, string> {
    const result: Record<string, string> = {}
    for (const line of headerBlock.split('\n')) {
      const colonIdx = line.indexOf(': ')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const rawValue = line.slice(colonIdx + 2).trim()
      try {
        result[key] = decodeURIComponent(rawValue)
      } catch {
        result[key] = rawValue
      }
    }
    return result
  }

  /** Handle a fully-parsed ESL message */
  private handleMessage(
    message: EslMessage,
    resolve?: (value: undefined) => void,
    reject?: (reason: Error) => void
  ): void {
    const contentType = message.headers['Content-Type']

    switch (contentType) {
      case 'auth/request':
        // FreeSWITCH wants authentication
        this.sendRaw(`auth ${this.config.password}\n\n`)
        break

      case 'command/reply': {
        const reply = message.headers['Reply-Text'] ?? ''
        if (reply.startsWith('+OK')) {
          if (!this.hasConnected) {
            // Just authenticated — subscribe to events
            this.sendRaw(
              'event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE RECORD_STOP DTMF\n\n'
            )
          } else {
            // Reply to an api/bgapi command
            const cb = this.commandQueue.shift()
            if (cb) cb.resolve(reply)
          }
        } else if (reply.startsWith('-ERR')) {
          if (!this.hasConnected) {
            // Auth failed
            this.shouldReconnect = false
            reject?.(new Error(`[esl] Authentication failed: ${reply}`))
          } else {
            const cb = this.commandQueue.shift()
            if (cb) cb.reject(new Error(`ESL command failed: ${reply}`))
          }
        }
        break
      }

      case 'api/response': {
        // Response to a synchronous "api" command
        const cb = this.commandQueue.shift()
        if (cb) {
          const result = message.body.trim()
          if (result.startsWith('-ERR')) {
            cb.reject(new Error(`ESL api error: ${result}`))
          } else {
            cb.resolve(result)
          }
        }
        break
      }

      case 'text/event-plain': {
        // Body contains the event headers
        const eventHeaders = this.parseHeaders(message.body)
        const bridgeEvent = this.translateEslEvent(eventHeaders)
        if (bridgeEvent !== null) {
          for (const handler of this.eventHandlers) {
            try {
              handler(bridgeEvent)
            } catch (err) {
              console.error('[esl] Event handler error:', err)
            }
          }
        }
        break
      }

      default:
        // After the subscription "+OK" reply we get a command/reply with "+OK Event Listener enabled plain"
        // and then events start flowing. We detect successful connection here.
        if (contentType === 'command/reply') break
        break
    }

    // Detect when we've successfully authenticated and subscribed
    if (contentType === 'command/reply') {
      const reply = message.headers['Reply-Text'] ?? ''
      if (!this.hasConnected && reply.startsWith('+OK')) {
        // First +OK after subscribe
        if (reply.includes('Event Listener')) {
          this.hasConnected = true
          this.connected = true
          this.reconnectDelay = 1000
          this.connectionDeadline = null
          console.log('[esl] Connected and subscribed to events')
          resolve?.(undefined)
        }
      }
    }
  }

  /** Send raw text to FreeSWITCH over the TCP socket */
  private sendRaw(text: string): void {
    if (!this.socket) {
      console.warn('[esl] sendRaw called with no socket')
      return
    }
    const sock = this.socket as unknown as { write: (data: string | Uint8Array) => void }
    sock.write(text)
  }

  /**
   * Send an ESL "api" command and wait for the response.
   * Returns the trimmed response body.
   */
  private sendCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ resolve, reject })
      this.sendRaw(`api ${command}\n\n`)
    })
  }

  private scheduleReconnect(): void {
    if (this.connectionDeadline !== null && Date.now() >= this.connectionDeadline) {
      console.error(
        `[esl] FATAL: Could not connect to FreeSWITCH within ${Math.round(this.connectionTimeoutMs / 1000)}s — exiting.`
      )
      console.error(
        '[esl] Make sure FreeSWITCH is running and ESL is reachable at:',
        `${this.config.host}:${this.config.port}`
      )
      process.exit(1)
    }

    const remaining = this.connectionDeadline
      ? ` (${Math.round((this.connectionDeadline - Date.now()) / 1000)}s until timeout)`
      : ''
    console.log(`[esl] Reconnecting in ${this.reconnectDelay}ms...${remaining}`)

    setTimeout(async () => {
      if (this.connectionDeadline !== null && Date.now() >= this.connectionDeadline) {
        console.error(
          `[esl] FATAL: Could not connect to FreeSWITCH within ${Math.round(this.connectionTimeoutMs / 1000)}s — exiting.`
        )
        process.exit(1)
      }

      try {
        await this.doConnect()
      } catch (err) {
        console.error('[esl] Reconnection failed:', err)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
        if (this.shouldReconnect) {
          this.scheduleReconnect()
        }
      }
    }, this.reconnectDelay)
  }

  // ---- Event Translation ----

  /**
   * Translate a parsed ESL event header map into a normalized BridgeEvent.
   * Returns null if the event type is not mapped.
   *
   * Public to allow direct unit testing without a TCP connection.
   */
  public translateEslEvent(headers: Record<string, string>): BridgeEvent | null {
    const eventName = headers['Event-Name']
    const channelId = headers['Unique-ID'] ?? ''
    const timestamp = new Date().toISOString()

    switch (eventName) {
      case 'CHANNEL_CREATE':
        return {
          type: 'channel_create',
          channelId,
          callerNumber: headers['Caller-Caller-ID-Number'] ?? '',
          calledNumber: headers['Caller-Destination-Number'] ?? '',
          timestamp,
        }

      case 'CHANNEL_ANSWER':
        return {
          type: 'channel_answer',
          channelId,
          timestamp,
        }

      case 'CHANNEL_HANGUP_COMPLETE': {
        const causeCodeStr = headers['Hangup-Cause-Code'] ?? '0'
        const causeCode = Number.parseInt(causeCodeStr, 10)
        const causeText = headers['Hangup-Cause'] ?? 'UNKNOWN'
        return {
          type: 'channel_hangup',
          channelId,
          cause: Number.isNaN(causeCode) ? 0 : causeCode,
          causeText,
          timestamp,
        }
      }

      case 'RECORD_STOP': {
        const filePath = headers['Record-File-Path'] ?? ''
        // Extract the recording name from the file path
        const recordingName = filePath.split('/').pop() ?? filePath
        const durationStr = headers.variable_record_seconds ?? '0'
        const duration = Number.parseFloat(durationStr)
        return {
          type: 'recording_complete',
          channelId,
          recordingName,
          duration: Number.isNaN(duration) ? undefined : duration,
          timestamp,
        }
      }

      case 'DTMF': {
        const digit = headers['DTMF-Digit'] ?? ''
        const durationStr = headers['DTMF-Duration'] ?? '0'
        const durationMs = Number.parseInt(durationStr, 10)
        return {
          type: 'dtmf_received',
          channelId,
          digit,
          durationMs: Number.isNaN(durationMs) ? 0 : durationMs,
          timestamp,
        }
      }

      default:
        return null
    }
  }

  // ---- BridgeClient: Call Control ----

  async originate(params: OriginateParams): Promise<{ id: string }> {
    // Build channel variables string
    const vars: string[] = []
    if (params.callerId) vars.push(`origination_caller_id_number=${params.callerId}`)
    if (params.timeout) vars.push(`originate_timeout=${params.timeout}`)
    if (params.appArgs) vars.push(params.appArgs)

    const varsStr = vars.length > 0 ? `{${vars.join(',')}}` : ''
    const callerId = params.callerId ? ` XML default ${params.callerId}` : ''
    const command = `originate ${varsStr}${params.endpoint} &park()${callerId}`

    const result = await this.sendCommand(command)
    // FreeSWITCH returns "+OK <uuid>" on success
    const uuid = result.replace(/^\+OK\s+/, '').trim()
    return { id: uuid }
  }

  async hangup(channelId: string): Promise<void> {
    try {
      await this.sendCommand(`uuid_kill ${channelId}`)
    } catch (err) {
      console.warn(`[esl] Failed to hangup channel ${channelId}:`, err)
    }
  }

  async answer(channelId: string): Promise<void> {
    await this.sendCommand(`uuid_answer ${channelId}`)
  }

  async bridge(
    channelId1: string,
    channelId2: string,
    _options?: { record?: boolean }
  ): Promise<string> {
    await this.sendCommand(`uuid_bridge ${channelId1} ${channelId2}`)
    // ESL uuid_bridge doesn't create a named bridge — use the pair as bridge ID
    return `${channelId1}:${channelId2}`
  }

  async destroyBridge(_bridgeId: string): Promise<void> {
    // ESL doesn't have explicit bridge objects — channels are bridged directly
    // Hangup both channels if needed, but bridge IDs aren't managed by FreeSWITCH ESL
  }

  // ---- BridgeClient: Media ----

  async playMedia(channelId: string, media: string, _playbackId?: string): Promise<string> {
    await this.sendCommand(`uuid_broadcast ${channelId} ${media}`)
    // Return a synthetic playback ID since ESL doesn't have playback objects
    return `${channelId}-${Date.now()}`
  }

  async stopPlayback(_playbackId: string): Promise<void> {
    // playbackId is "channelId-timestamp" — extract the channelId
    const channelId = _playbackId.split('-')[0]
    try {
      await this.sendCommand(`uuid_break ${channelId}`)
    } catch {
      // Playback may already be done
    }
  }

  async startMoh(channelId: string, _mohClass?: string): Promise<void> {
    await this.sendCommand(`uuid_broadcast ${channelId} local_stream://moh`)
  }

  async stopMoh(channelId: string): Promise<void> {
    try {
      await this.sendCommand(`uuid_break ${channelId}`)
    } catch {
      // MOH may already be stopped
    }
  }

  // ---- BridgeClient: Recording ----

  async recordChannel(
    channelId: string,
    params: {
      name: string
      format?: string
      maxDurationSeconds?: number
      beep?: boolean
      terminateOn?: string
    }
  ): Promise<void> {
    const format = params.format ?? 'wav'
    const maxDuration = (params.maxDurationSeconds ?? 0) * 1000 // ms
    const filePath = `/tmp/recordings/${params.name}.${format}`
    await this.sendCommand(`uuid_record ${channelId} start ${filePath} ${maxDuration}`)
  }

  async recordBridge(
    bridgeId: string,
    params: {
      name: string
      format?: string
      maxDurationSeconds?: number
    }
  ): Promise<void> {
    // ESL doesn't have bridge-level recording — record the first channel in the pair
    const channelId = bridgeId.split(':')[0]
    await this.recordChannel(channelId, params)
  }

  async stopRecording(recordingName: string): Promise<void> {
    // recordingName may be bare name or full path — find the channel via convention
    // We can't easily stop without knowing the channel, so use uuid_record stop on
    // any channel. Callers should use hangup or stopRecording with full path.
    // For now, attempt api uuid_record with the name as-is
    const filePath = recordingName.startsWith('/')
      ? recordingName
      : `/tmp/recordings/${recordingName}`
    try {
      // We need to broadcast-stop; without channelId this is a best-effort
      await this.sendCommand(`uuid_record ${filePath} stop`)
    } catch {
      // May already be stopped
    }
  }

  async getRecordingFile(recordingName: string): Promise<ArrayBuffer | null> {
    const filePath = recordingName.startsWith('/')
      ? recordingName
      : `/tmp/recordings/${recordingName}`
    try {
      const file = Bun.file(filePath)
      const exists = await file.exists()
      if (!exists) return null
      return file.arrayBuffer()
    } catch {
      return null
    }
  }

  async deleteRecording(recordingName: string): Promise<void> {
    const filePath = recordingName.startsWith('/')
      ? recordingName
      : `/tmp/recordings/${recordingName}`
    try {
      await Bun.file(filePath).exists() // check first
      const { unlink } = await import('node:fs/promises')
      await unlink(filePath)
    } catch {
      // Already deleted or doesn't exist
    }
  }

  // ---- BridgeClient: Channel Variables ----

  async setChannelVar(channelId: string, variable: string, value: string): Promise<void> {
    await this.sendCommand(`uuid_setvar ${channelId} ${variable} ${value}`)
  }

  async getChannelVar(channelId: string, variable: string): Promise<string> {
    const result = await this.sendCommand(`uuid_getvar ${channelId} ${variable}`)
    return result.trim()
  }

  // ---- BridgeClient: System ----

  async healthCheck(): Promise<BridgeHealthStatus> {
    const start = Date.now()
    try {
      const result = await this.sendCommand('status')
      const latencyMs = Date.now() - start
      // Parse uptime from "UP x years, y days, z hours, w minutes, v seconds, u milliseconds"
      const uptimeMatch = result.match(/UP\s+(.+)/)
      return {
        ok: true,
        latencyMs,
        details: {
          status: result.split('\n')[0]?.trim(),
          uptime: uptimeMatch?.[1] ?? 'unknown',
        },
      }
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - start,
      }
    }
  }

  async listChannels(): Promise<Array<{ id: string; state: string; caller: string }>> {
    // Parsing "show channels" output is complex — return empty for now
    // Full implementation would parse the tabular output from "show channels"
    return []
  }

  async listBridges(): Promise<Array<{ id: string; channels: string[] }>> {
    // ESL has no native bridge list — return empty
    return []
  }
}
