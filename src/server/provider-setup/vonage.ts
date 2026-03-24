import type { NumberInfo } from '../../shared/types'
import type { ProvisionNumberResult } from './types'
import { ProviderApiError } from './types'

/**
 * Vonage provider module for credential validation,
 * number management, and webhook configuration.
 */
export class VonageProvider {
  async validateCredentials(apiKey: string, apiSecret: string): Promise<void> {
    const res = await fetch('https://api.nexmo.com/v2/applications?page_size=1', {
      headers: {
        Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
      },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Vonage credential validation failed', res.status, text)
    }
  }

  async listNumbers(apiKey: string, apiSecret: string): Promise<NumberInfo[]> {
    const params = new URLSearchParams({
      api_key: apiKey,
      api_secret: apiSecret,
    })

    const res = await fetch(`https://rest.nexmo.com/account/numbers?${params.toString()}`)

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to list Vonage numbers', res.status, text)
    }

    const data = (await res.json()) as {
      numbers: Array<{
        msisdn: string
        country: string
        type: string
        features: string[]
      }>
    }

    return (data.numbers || []).map((n) => ({
      phoneNumber: `+${n.msisdn}`,
      friendlyName: `+${n.msisdn} (${n.country})`,
      sid: n.msisdn,
      capabilities: {
        voice: n.features?.includes('VOICE') ?? true,
        sms: n.features?.includes('SMS') ?? true,
        mms: n.features?.includes('MMS') ?? false,
      },
    }))
  }

  async configureWebhooks(
    apiKey: string,
    apiSecret: string,
    number: string,
    domain: string,
    enableSms: boolean
  ): Promise<void> {
    const authHeader = `Basic ${btoa(`${apiKey}:${apiSecret}`)}`

    // Create or update Vonage Application with webhook URLs
    const appBody: Record<string, unknown> = {
      name: `Llamenos - ${domain}`,
      capabilities: {
        voice: {
          webhooks: {
            answer_url: {
              address: `https://${domain}/api/telephony/incoming`,
              http_method: 'POST',
            },
            event_url: {
              address: `https://${domain}/api/telephony/status`,
              http_method: 'POST',
            },
          },
        },
      },
    }

    if (enableSms) {
      ;(appBody.capabilities as Record<string, unknown>).messages = {
        webhooks: {
          inbound_url: {
            address: `https://${domain}/api/messaging/sms/webhook`,
            http_method: 'POST',
          },
          status_url: {
            address: `https://${domain}/api/messaging/sms/status`,
            http_method: 'POST',
          },
        },
      }
    }

    const appRes = await fetch('https://api.nexmo.com/v2/applications', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(appBody),
    })

    if (!appRes.ok) {
      const text = await appRes.text()
      throw new ProviderApiError('Failed to create Vonage application', appRes.status, text)
    }

    const appData = (await appRes.json()) as { id: string }

    // Link number to application
    const msisdn = number.replace('+', '')
    const linkParams = new URLSearchParams({
      api_key: apiKey,
      api_secret: apiSecret,
      country: msisdn.length > 10 ? msisdn.slice(0, msisdn.length - 10) : 'US',
      msisdn,
      app_id: appData.id,
    })

    const linkRes = await fetch('https://rest.nexmo.com/number/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: linkParams.toString(),
    })

    if (!linkRes.ok) {
      const text = await linkRes.text()
      throw new ProviderApiError(
        'Failed to link Vonage number to application',
        linkRes.status,
        text
      )
    }
  }

  async provisionNumber(
    apiKey: string,
    apiSecret: string,
    country?: string
  ): Promise<ProvisionNumberResult> {
    const countryCode = country || 'US'
    const searchParams = new URLSearchParams({
      api_key: apiKey,
      api_secret: apiSecret,
      country: countryCode,
      features: 'VOICE,SMS',
      size: '1',
    })

    const searchRes = await fetch(`https://rest.nexmo.com/number/search?${searchParams.toString()}`)

    if (!searchRes.ok) {
      const text = await searchRes.text()
      throw new ProviderApiError('Failed to search Vonage numbers', searchRes.status, text)
    }

    const searchData = (await searchRes.json()) as {
      numbers: Array<{ msisdn: string; country: string }>
    }

    if (!searchData.numbers || searchData.numbers.length === 0) {
      throw new ProviderApiError('No available numbers found', 404, 'No numbers available')
    }

    const msisdn = searchData.numbers[0].msisdn
    const buyCountry = searchData.numbers[0].country

    const buyParams = new URLSearchParams({
      api_key: apiKey,
      api_secret: apiSecret,
      country: buyCountry,
      msisdn,
    })

    const buyRes = await fetch('https://rest.nexmo.com/number/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buyParams.toString(),
    })

    if (!buyRes.ok) {
      const text = await buyRes.text()
      throw new ProviderApiError('Failed to provision Vonage number', buyRes.status, text)
    }

    return { phoneNumber: `+${msisdn}`, sid: msisdn }
  }
}
