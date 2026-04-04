import type {
  BridgeClient,
  BridgeEvent,
  BridgeHealthStatus,
  OriginateParams,
} from '../bridge-client'

export interface KamailioConfig {
  /** JSONRPC endpoint URL, e.g. http://kamailio:5060/jsonrpc */
  jsonrpcUrl: string
  /** Dispatcher set ID for dispatcher.list/set_state calls. Default: 1 */
  dispatcherSetId?: number
}

export interface DispatcherEntry {
  uri: string
  /** AP=active+probing, IP=inactive+probing, DX=disabled, etc. */
  flags: string
  priority: number
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string }
}

/**
 * Kamailio JSONRPC Client — management-only BridgeClient adapter.
 *
 * Kamailio is a SIP proxy and load balancer, NOT a PBX. It has no concept of
 * channels, bridges, or call control. All call-control methods throw to make
 * misconfiguration obvious at runtime.
 *
 * Implements BridgeClient so the sip-bridge host can treat all PBX/proxy
 * clients uniformly for health checking and lifecycle management.
 *
 * Transport: plain HTTP POST to the Kamailio JSONRPC endpoint (stateless).
 */
export class KamailioClient implements BridgeClient {
  private readonly config: KamailioConfig
  private readonly dispatcherSetId: number
  private rpcId = 0

  constructor(config: KamailioConfig) {
    this.config = config
    this.dispatcherSetId = config.dispatcherSetId ?? 1
  }

  // ---- BridgeClient lifecycle ----

  /** Verify the JSONRPC endpoint is reachable by running a health check. */
  async connect(): Promise<void> {
    const health = await this.healthCheck()
    if (!health.ok) {
      throw new Error(
        `[kamailio] Cannot connect: JSONRPC endpoint not reachable at ${this.config.jsonrpcUrl}`
      )
    }
    console.log('[kamailio] JSONRPC endpoint reachable — connection verified')
  }

  /** No-op: the HTTP client is stateless. */
  disconnect(): void {
    // HTTP is stateless — nothing to close
  }

  /** Always true: stateless HTTP, no persistent connection. */
  isConnected(): boolean {
    return true
  }

  /** No-op: Kamailio does not emit call events. */
  onEvent(_handler: (event: BridgeEvent) => void): void {
    // Kamailio is a SIP proxy and does not push call events over JSONRPC
  }

  // ---- BridgeClient: System ----

  /**
   * Query Kamailio's JSONRPC core.version endpoint.
   * Returns ok=true with version details on success, ok=false on any failure.
   */
  async healthCheck(): Promise<BridgeHealthStatus> {
    const start = Date.now()
    try {
      const result = await this.jsonrpc<{ version: string }>('core.version')
      const latencyMs = Date.now() - start
      return {
        ok: true,
        latencyMs,
        details: {
          version: result.version,
          endpoint: this.config.jsonrpcUrl,
        },
      }
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - start,
      }
    }
  }

  // ---- BridgeClient: Call Control — not supported ----

  async originate(_params: OriginateParams): Promise<{ id: string }> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async hangup(_channelId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async answer(_channelId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async bridge(
    _channelId1: string,
    _channelId2: string,
    _options?: { record?: boolean }
  ): Promise<string> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  async destroyBridge(_bridgeId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — call control is not supported. Use the PBX client.')
  }

  // ---- BridgeClient: Media — not supported ----

  async playMedia(_channelId: string, _media: string, _playbackId?: string): Promise<string> {
    throw new Error('Kamailio is a SIP proxy — media control is not supported. Use the PBX client.')
  }

  async stopPlayback(_playbackId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — media control is not supported. Use the PBX client.')
  }

  async startMoh(_channelId: string, _mohClass?: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — media control is not supported. Use the PBX client.')
  }

  async stopMoh(_channelId: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — media control is not supported. Use the PBX client.')
  }

  // ---- BridgeClient: Recording — not supported ----

  async recordChannel(
    _channelId: string,
    _params: {
      name: string
      format?: string
      maxDurationSeconds?: number
      beep?: boolean
      terminateOn?: string
    }
  ): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async recordBridge(
    _bridgeId: string,
    _params: {
      name: string
      format?: string
      maxDurationSeconds?: number
    }
  ): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async stopRecording(_recordingName: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async getRecordingFile(_recordingName: string): Promise<ArrayBuffer | null> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  async deleteRecording(_recordingName: string): Promise<void> {
    throw new Error('Kamailio is a SIP proxy — recording is not supported. Use the PBX client.')
  }

  // ---- BridgeClient: Channel Variables — not supported ----

  async setChannelVar(_channelId: string, _variable: string, _value: string): Promise<void> {
    throw new Error(
      'Kamailio is a SIP proxy — channel variables are not supported. Use the PBX client.'
    )
  }

  async getChannelVar(_channelId: string, _variable: string): Promise<string> {
    throw new Error(
      'Kamailio is a SIP proxy — channel variables are not supported. Use the PBX client.'
    )
  }

  async listChannels(): Promise<Array<{ id: string; state: string; caller: string }>> {
    throw new Error(
      'Kamailio is a SIP proxy — channel listing is not supported. Use the PBX client.'
    )
  }

  async listBridges(): Promise<Array<{ id: string; channels: string[] }>> {
    throw new Error(
      'Kamailio is a SIP proxy — bridge listing is not supported. Use the PBX client.'
    )
  }

  // ---- Kamailio-specific management methods ----

  /**
   * List all dispatcher entries for the configured set ID.
   * Calls JSONRPC `dispatcher.list` and normalises the response.
   *
   * The Kamailio dispatcher.list response embeds destinations inside nested
   * structures: result → RECORDS → [{ SET: { ID, TARGETS: [{ DEST: { URI, FLAGS, PRIORITY } }] } }]
   */
  async getDispatchers(): Promise<DispatcherEntry[]> {
    const result = await this.jsonrpc<{
      RECORDS?: Array<{
        SET: {
          ID: number
          TARGETS: Array<{
            DEST: {
              URI: string
              FLAGS: string
              PRIORITY: number
            }
          }>
        }
      }>
    }>('dispatcher.list')

    const entries: DispatcherEntry[] = []
    for (const record of result.RECORDS ?? []) {
      if (record.SET.ID !== this.dispatcherSetId) continue
      for (const target of record.SET.TARGETS ?? []) {
        entries.push({
          uri: target.DEST.URI,
          flags: target.DEST.FLAGS,
          priority: target.DEST.PRIORITY,
        })
      }
    }
    return entries
  }

  /**
   * Set a dispatcher destination's state to active or inactive.
   * Calls JSONRPC `dispatcher.set_state` with state=0 (active) or state=1 (inactive).
   *
   * Kamailio dispatcher.set_state params: state (int), group (int), address (str)
   *   state 0 = active, state 1 = inactive/disabled
   */
  async setDispatcherState(uri: string, state: 'active' | 'inactive'): Promise<void> {
    const stateCode = state === 'active' ? 0 : 1
    await this.jsonrpc('dispatcher.set_state', [stateCode, this.dispatcherSetId, uri])
  }

  /**
   * Reload the dispatcher list from the database.
   * Calls JSONRPC `dispatcher.reload`.
   */
  async reloadDispatchers(): Promise<void> {
    await this.jsonrpc('dispatcher.reload')
  }

  /**
   * Get statistics from Kamailio.
   * Calls JSONRPC `stats.get_statistics`. Pass a group (e.g. 'core:') to filter,
   * or omit for all statistics.
   */
  async getStatistics(group?: string): Promise<Record<string, unknown>> {
    const params = group ? [group] : ['all']
    return this.jsonrpc<Record<string, unknown>>('stats.get_statistics', params)
  }

  // ---- Private helpers ----

  /**
   * Execute a JSONRPC 2.0 request against the Kamailio JSONRPC endpoint.
   * Throws on HTTP error, non-200 status, or JSONRPC error response.
   */
  private async jsonrpc<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    const id = ++this.rpcId
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params: params ?? [],
      id,
    })

    let response: Response
    try {
      response = await globalThis.fetch(this.config.jsonrpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    } catch (err) {
      throw new Error(
        `[kamailio] JSONRPC fetch failed for method "${method}": ${err instanceof Error ? err.message : String(err)}`
      )
    }

    if (!response.ok) {
      throw new Error(
        `[kamailio] JSONRPC HTTP ${response.status} for method "${method}": ${response.statusText}`
      )
    }

    const data = (await response.json()) as JsonRpcResponse<T>

    if (data.error) {
      throw new Error(
        `[kamailio] JSONRPC error for method "${method}": [${data.error.code}] ${data.error.message}`
      )
    }

    return data.result as T
  }
}
