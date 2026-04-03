/**
 * Telnyx Call Control API v2 client.
 *
 * Thin wrapper around the Telnyx REST API for issuing call control commands.
 * All commands are issued as POST requests with Bearer token authentication.
 *
 * Reference: https://developers.telnyx.com/docs/v2/call-control
 */

import { AppError } from '../lib/errors'

const TELNYX_API_BASE = 'https://api.telnyx.com/v2'

export interface TelnyxCreateCallResult {
  call_control_id: string
  call_leg_id: string
  call_session_id: string
}

/**
 * TelnyxCallControlClient — issues REST commands to Telnyx Call Control API.
 */
export class TelnyxCallControlClient {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Issue a call control command to an active call.
   * POST /v2/calls/{call_control_id}/actions/{action}
   */
  async command(
    callControlId: string,
    action: string,
    body?: Record<string, unknown>
  ): Promise<void> {
    const url = `${TELNYX_API_BASE}/calls/${encodeURIComponent(callControlId)}/actions/${action}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : '{}',
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown error')
      throw new AppError(500, `Telnyx API error (${action}): ${res.status} ${errorText}`)
    }
  }

  /**
   * Create an outbound call.
   * POST /v2/calls
   */
  async createCall(params: {
    to: string
    from: string
    connection_id: string
    webhook_url?: string
    webhook_url_method?: string
    client_state?: string
    timeout_secs?: number
  }): Promise<TelnyxCreateCallResult> {
    const url = `${TELNYX_API_BASE}/calls`
    const body: Record<string, unknown> = {
      to: params.to,
      from: params.from,
      connection_id: params.connection_id,
    }
    if (params.webhook_url) body.webhook_url = params.webhook_url
    if (params.webhook_url_method) body.webhook_url_method = params.webhook_url_method
    if (params.client_state) body.client_state = params.client_state
    if (params.timeout_secs) body.timeout_secs = params.timeout_secs

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown error')
      throw new AppError(500, `Telnyx API error (createCall): ${res.status} ${errorText}`)
    }

    const data = (await res.json()) as {
      data: {
        call_control_id: string
        call_leg_id: string
        call_session_id: string
      }
    }
    return data.data
  }

  /**
   * Fetch recording audio from a Telnyx recording URL.
   */
  async getRecording(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!res.ok) {
      throw new AppError(500, `Telnyx API error (getRecording): ${res.status}`)
    }

    return res.arrayBuffer()
  }

  /**
   * Delete a recording by its ID.
   * DELETE /v2/recordings/{recording_id}
   */
  async deleteRecording(recordingId: string): Promise<void> {
    const url = `${TELNYX_API_BASE}/recordings/${encodeURIComponent(recordingId)}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'unknown error')
      throw new AppError(500, `Telnyx API error (deleteRecording): ${res.status} ${errorText}`)
    }
  }

  /**
   * Fetch Telnyx's public key for webhook signature verification.
   * GET /v2/public_key
   */
  async getPublicKey(): Promise<string> {
    const url = `${TELNYX_API_BASE}/public_key`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!res.ok) {
      throw new AppError(500, `Telnyx API error (getPublicKey): ${res.status}`)
    }

    const data = (await res.json()) as { data: { public_key: string } }
    return data.data.public_key
  }

  /**
   * Test connection to Telnyx API.
   * GET /v2/phone_numbers
   */
  async testConnection(): Promise<boolean> {
    const url = `${TELNYX_API_BASE}/phone_numbers?page[size]=1`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })
    return res.ok
  }

  /**
   * Get Call Control App configuration for webhook verification.
   * GET /v2/call_control_applications/{id}
   */
  async getCallControlApp(appId: string): Promise<{
    webhook_event_url?: string
    webhook_event_failover_url?: string
  } | null> {
    const url = `${TELNYX_API_BASE}/call_control_applications/${encodeURIComponent(appId)}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!res.ok) return null

    const data = (await res.json()) as {
      data: {
        webhook_event_url?: string
        webhook_event_failover_url?: string
      }
    }
    return data.data
  }
}
