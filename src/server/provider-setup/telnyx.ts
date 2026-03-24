import type { NumberInfo, SipTrunkConfig } from '../../shared/types'
import type { OAuthStartResult, ProvisionNumberResult, TelnyxCredentials } from './types'
import { ProviderApiError } from './types'

/**
 * Telnyx provider module for OAuth flow, number management,
 * webhook configuration, and SIP connection.
 */
export class TelnyxProvider {
  constructor(
    private readonly domain: string,
    private readonly oauthClientId: string,
    private readonly oauthClientSecret: string
  ) {}

  oauthStart(state: string): OAuthStartResult {
    const redirectUri = `https://${this.domain}/api/setup/provider/telnyx/oauth/callback`
    const params = new URLSearchParams({
      client_id: this.oauthClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'phone_numbers messaging call_control',
      state,
    })
    return { authUrl: `https://sso.telnyx.com/oauth2/auth?${params.toString()}` }
  }

  async oauthCallback(code: string): Promise<TelnyxCredentials> {
    const redirectUri = `https://${this.domain}/api/setup/provider/telnyx/oauth/callback`

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.oauthClientId,
      client_secret: this.oauthClientSecret,
    })

    const res = await fetch('https://sso.telnyx.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Telnyx OAuth token exchange failed', res.status, text)
    }

    const data = (await res.json()) as { access_token: string }
    return { accessToken: data.access_token }
  }

  async listNumbers(accessToken: string): Promise<NumberInfo[]> {
    const res = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=250', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to list Telnyx numbers', res.status, text)
    }

    const data = (await res.json()) as {
      data: Array<{
        id: string
        phone_number: string
        connection_name: string
        status: string
      }>
    }

    return data.data.map((n) => ({
      phoneNumber: n.phone_number,
      friendlyName: n.connection_name || n.phone_number,
      sid: n.id,
      capabilities: { voice: true, sms: true, mms: true },
    }))
  }

  async configureWebhooks(
    accessToken: string,
    numberId: string,
    domain: string,
    enableSms: boolean
  ): Promise<void> {
    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    // Create or update a Call Control Application
    const appBody: Record<string, unknown> = {
      application_name: `Llamenos - ${domain}`,
      webhook_event_url: `https://${domain}/api/telephony/incoming`,
      webhook_event_failover_url: `https://${domain}/api/telephony/status`,
      active: true,
    }

    if (enableSms) {
      appBody.inbound_message_webhook_url = `https://${domain}/api/messaging/sms/webhook`
    }

    const appRes = await fetch('https://api.telnyx.com/v2/call_control_applications', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(appBody),
    })

    if (!appRes.ok) {
      const text = await appRes.text()
      throw new ProviderApiError('Failed to create Telnyx application', appRes.status, text)
    }

    const appData = (await appRes.json()) as { data: { id: string } }
    const appId = appData.data.id

    // Associate number with the application
    const patchRes = await fetch(`https://api.telnyx.com/v2/phone_numbers/${numberId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        connection_id: appId,
      }),
    })

    if (!patchRes.ok) {
      const text = await patchRes.text()
      throw new ProviderApiError(
        'Failed to associate Telnyx number with application',
        patchRes.status,
        text
      )
    }
  }

  async provisionNumber(accessToken: string, areaCode?: string): Promise<ProvisionNumberResult> {
    // Search for available numbers
    const searchParams = new URLSearchParams({ 'filter[limit]': '1' })
    if (areaCode) searchParams.set('filter[national_destination_code]', areaCode)

    const searchRes = await fetch(
      `https://api.telnyx.com/v2/available_phone_numbers?${searchParams.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!searchRes.ok) {
      const text = await searchRes.text()
      throw new ProviderApiError('Failed to search Telnyx numbers', searchRes.status, text)
    }

    const searchData = (await searchRes.json()) as {
      data: Array<{ phone_number: string }>
    }

    if (searchData.data.length === 0) {
      throw new ProviderApiError('No available numbers found', 404, 'No numbers available')
    }

    const phoneNumber = searchData.data[0].phone_number

    // Order the number
    const orderRes = await fetch('https://api.telnyx.com/v2/number_orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_numbers: [{ phone_number: phoneNumber }],
      }),
    })

    if (!orderRes.ok) {
      const text = await orderRes.text()
      throw new ProviderApiError('Failed to provision Telnyx number', orderRes.status, text)
    }

    const orderData = (await orderRes.json()) as {
      data: { id: string; phone_numbers: Array<{ phone_number: string }> }
    }

    return {
      phoneNumber: orderData.data.phone_numbers[0]?.phone_number || phoneNumber,
      sid: orderData.data.id,
    }
  }

  async createSipConnection(accessToken: string, domain: string): Promise<SipTrunkConfig> {
    const sipUsername = `llamenos-${crypto.randomUUID().slice(0, 8)}`
    const sipPassword = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 32)

    const res = await fetch('https://api.telnyx.com/v2/ip_connections', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_name: `Llamenos SIP - ${domain}`,
        active: true,
        transport_protocol: 'UDP',
        default_on_hold_comfort_noise_enabled: true,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to create Telnyx SIP connection', res.status, text)
    }

    const data = (await res.json()) as { data: { id: string } }

    return {
      sipProvider: 'sip.telnyx.com',
      sipUsername,
      sipPassword,
      connectionId: data.data.id,
    }
  }
}
