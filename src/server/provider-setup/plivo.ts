import type { NumberInfo } from '../../shared/types'
import type { ProvisionNumberResult } from './types'
import { ProviderApiError } from './types'

/**
 * Plivo provider module for credential validation,
 * number management, and webhook configuration.
 */
export class PlivoProvider {
  private authHeader(authId: string, authToken: string): string {
    return `Basic ${btoa(`${authId}:${authToken}`)}`
  }

  async validateCredentials(authId: string, authToken: string): Promise<void> {
    const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/`, {
      headers: { Authorization: this.authHeader(authId, authToken) },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Plivo credential validation failed', res.status, text)
    }
  }

  async listNumbers(authId: string, authToken: string): Promise<NumberInfo[]> {
    const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Number/`, {
      headers: { Authorization: this.authHeader(authId, authToken) },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to list Plivo numbers', res.status, text)
    }

    const data = (await res.json()) as {
      objects: Array<{
        number: string
        alias: string
        resource_uri: string
        voice_enabled: boolean
        sms_enabled: boolean
      }>
    }

    return (data.objects || []).map((n) => ({
      phoneNumber: `+${n.number}`,
      friendlyName: n.alias || `+${n.number}`,
      sid: n.number,
      capabilities: {
        voice: n.voice_enabled,
        sms: n.sms_enabled,
        mms: false,
      },
    }))
  }

  async configureWebhooks(
    authId: string,
    authToken: string,
    number: string,
    domain: string,
    enableSms: boolean
  ): Promise<void> {
    const auth = this.authHeader(authId, authToken)

    // Create Plivo Application
    const appBody: Record<string, unknown> = {
      app_name: `Llamenos - ${domain}`,
      answer_url: `https://${domain}/api/telephony/incoming`,
      answer_method: 'POST',
      hangup_url: `https://${domain}/api/telephony/status`,
      hangup_method: 'POST',
    }

    if (enableSms) {
      appBody.message_url = `https://${domain}/api/messaging/sms/webhook`
      appBody.message_method = 'POST'
    }

    const appRes = await fetch(`https://api.plivo.com/v1/Account/${authId}/Application/`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(appBody),
    })

    if (!appRes.ok) {
      const text = await appRes.text()
      throw new ProviderApiError('Failed to create Plivo application', appRes.status, text)
    }

    const appData = (await appRes.json()) as { app_id: string }

    // Associate number with application
    const numStr = number.replace('+', '')
    const numRes = await fetch(`https://api.plivo.com/v1/Account/${authId}/Number/${numStr}/`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app_id: appData.app_id }),
    })

    if (!numRes.ok) {
      const text = await numRes.text()
      throw new ProviderApiError('Failed to associate Plivo number', numRes.status, text)
    }
  }

  async provisionNumber(
    authId: string,
    authToken: string,
    country?: string
  ): Promise<ProvisionNumberResult> {
    const auth = this.authHeader(authId, authToken)
    const countryIso = country || 'US'

    // Search available numbers
    const searchRes = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/PhoneNumber/?country_iso=${countryIso}&limit=1&type=local`,
      { headers: { Authorization: auth } }
    )

    if (!searchRes.ok) {
      const text = await searchRes.text()
      throw new ProviderApiError('Failed to search Plivo numbers', searchRes.status, text)
    }

    const searchData = (await searchRes.json()) as {
      objects: Array<{ number: string }>
    }

    if (!searchData.objects || searchData.objects.length === 0) {
      throw new ProviderApiError('No available numbers found', 404, 'No numbers available')
    }

    const phoneNumber = searchData.objects[0].number

    // Buy the number
    const buyRes = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/PhoneNumber/${phoneNumber}/`,
      {
        method: 'POST',
        headers: { Authorization: auth },
      }
    )

    if (!buyRes.ok) {
      const text = await buyRes.text()
      throw new ProviderApiError('Failed to provision Plivo number', buyRes.status, text)
    }

    return { phoneNumber: `+${phoneNumber}`, sid: phoneNumber }
  }
}
