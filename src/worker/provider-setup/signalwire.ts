import type { NumberInfo } from '../../shared/types'
import type { ProvisionNumberResult } from './types'
import { ProviderApiError } from './types'

/**
 * SignalWire provider module for credential validation,
 * number management, and webhook configuration.
 */
export class SignalWireProvider {
  private authHeader(projectId: string, apiToken: string): string {
    return `Basic ${btoa(`${projectId}:${apiToken}`)}`
  }

  async validateCredentials(
    projectId: string,
    apiToken: string,
    spaceUrl: string
  ): Promise<void> {
    const res = await fetch(
      `https://${spaceUrl}/api/relay/rest/phone_numbers?page_size=1`,
      { headers: { Authorization: this.authHeader(projectId, apiToken) } }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('SignalWire credential validation failed', res.status, text)
    }
  }

  async listNumbers(
    projectId: string,
    apiToken: string,
    spaceUrl: string
  ): Promise<NumberInfo[]> {
    const res = await fetch(
      `https://${spaceUrl}/api/relay/rest/phone_numbers`,
      { headers: { Authorization: this.authHeader(projectId, apiToken) } }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to list SignalWire numbers', res.status, text)
    }

    const data = (await res.json()) as {
      data: Array<{
        id: string
        number: string
        name: string
        capabilities: { voice: boolean; sms: boolean; mms: boolean }
      }>
    }

    return data.data.map((n) => ({
      phoneNumber: n.number,
      friendlyName: n.name || n.number,
      sid: n.id,
      capabilities: {
        voice: n.capabilities?.voice ?? true,
        sms: n.capabilities?.sms ?? true,
        mms: n.capabilities?.mms ?? false,
      },
    }))
  }

  async configureWebhooks(
    projectId: string,
    apiToken: string,
    spaceUrl: string,
    numberId: string,
    domain: string,
    enableSms: boolean
  ): Promise<void> {
    const body: Record<string, string> = {
      call_handler: 'relay_rest_api',
      call_request_url: `https://${domain}/api/telephony/incoming`,
      call_status_callback_url: `https://${domain}/api/telephony/status`,
    }

    if (enableSms) {
      body.message_handler = 'relay_rest_api'
      body.message_request_url = `https://${domain}/api/messaging/sms/webhook`
    }

    const res = await fetch(
      `https://${spaceUrl}/api/relay/rest/phone_numbers/${numberId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: this.authHeader(projectId, apiToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to configure SignalWire webhooks', res.status, text)
    }
  }

  async provisionNumber(
    projectId: string,
    apiToken: string,
    spaceUrl: string,
    areaCode?: string
  ): Promise<ProvisionNumberResult> {
    const searchParams = new URLSearchParams({ page_size: '1' })
    if (areaCode) searchParams.set('area_code', areaCode)

    const searchRes = await fetch(
      `https://${spaceUrl}/api/relay/rest/phone_numbers/available?${searchParams.toString()}`,
      { headers: { Authorization: this.authHeader(projectId, apiToken) } }
    )

    if (!searchRes.ok) {
      const text = await searchRes.text()
      throw new ProviderApiError('Failed to search SignalWire numbers', searchRes.status, text)
    }

    const searchData = (await searchRes.json()) as {
      data: Array<{ number: string }>
    }

    if (searchData.data.length === 0) {
      throw new ProviderApiError('No available numbers found', 404, 'No numbers available')
    }

    const phoneNumber = searchData.data[0].number

    const buyRes = await fetch(
      `https://${spaceUrl}/api/relay/rest/phone_numbers`,
      {
        method: 'POST',
        headers: {
          Authorization: this.authHeader(projectId, apiToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ number: phoneNumber }),
      }
    )

    if (!buyRes.ok) {
      const text = await buyRes.text()
      throw new ProviderApiError('Failed to provision SignalWire number', buyRes.status, text)
    }

    const buyData = (await buyRes.json()) as { data: { id: string; number: string } }
    return { phoneNumber: buyData.data.number, sid: buyData.data.id }
  }
}
