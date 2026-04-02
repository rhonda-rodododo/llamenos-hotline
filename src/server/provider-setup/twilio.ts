import type { NumberInfo, SipTrunkConfig } from '../../shared/types'
import type {
  A2pBrandResult,
  A2pStatusResult,
  OAuthStartResult,
  ProvisionNumberResult,
  TwilioCredentials,
} from './types'
import { ProviderApiError } from './types'

/**
 * Twilio provider module for OAuth flow, number management,
 * webhook configuration, SIP trunk, and A2P 10DLC.
 */
export class TwilioProvider {
  constructor(
    private readonly domain: string,
    private readonly oauthClientId: string,
    private readonly oauthClientSecret: string
  ) {}

  oauthStart(state: string): OAuthStartResult {
    const redirectUri = `https://${this.domain}/api/setup/provider/twilio/oauth/callback`
    const params = new URLSearchParams({
      client_id: this.oauthClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'account:read phone-number:read phone-number:write',
      state,
    })
    return { authUrl: `https://www.twilio.com/authorize?${params.toString()}` }
  }

  async oauthCallback(code: string): Promise<TwilioCredentials> {
    const redirectUri = `https://${this.domain}/api/setup/provider/twilio/oauth/callback`
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.oauthClientId,
      client_secret: this.oauthClientSecret,
    })

    const res = await fetch('https://login.twilio.com/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Twilio OAuth token exchange failed', res.status, text)
    }

    const data = (await res.json()) as Record<string, string>
    return {
      accountSid: data.account_sid,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      subAccountSid: data.sub_account_sid || undefined,
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<TwilioCredentials> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.oauthClientId,
      client_secret: this.oauthClientSecret,
    })

    const res = await fetch('https://login.twilio.com/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Twilio token refresh failed', res.status, text)
    }

    const data = (await res.json()) as Record<string, string>
    return {
      accountSid: data.account_sid,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      subAccountSid: data.sub_account_sid || undefined,
    }
  }

  async listNumbers(credentials: TwilioCredentials): Promise<NumberInfo[]> {
    const sid = credentials.subAccountSid || credentials.accountSid
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`
    const authHeader = `Basic ${btoa(`${sid}:${credentials.accessToken}`)}`

    const res = await fetch(url, {
      headers: { Authorization: authHeader },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to list Twilio numbers', res.status, text)
    }

    const data = (await res.json()) as {
      incoming_phone_numbers: Array<{
        phone_number: string
        friendly_name: string
        sid: string
        capabilities: { voice: boolean; SMS: boolean; MMS: boolean }
      }>
    }

    return data.incoming_phone_numbers.map((n) => ({
      phoneNumber: n.phone_number,
      friendlyName: n.friendly_name,
      sid: n.sid,
      capabilities: {
        voice: n.capabilities.voice,
        sms: n.capabilities.SMS,
        mms: n.capabilities.MMS,
      },
    }))
  }

  async configureWebhooks(
    credentials: TwilioCredentials,
    numberSid: string,
    domain: string,
    enableSms: boolean
  ): Promise<void> {
    const sid = credentials.subAccountSid || credentials.accountSid
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${numberSid}.json`
    const authHeader = `Basic ${btoa(`${sid}:${credentials.accessToken}`)}`

    const params = new URLSearchParams({
      VoiceUrl: `https://${domain}/telephony/incoming`,
      VoiceMethod: 'POST',
      StatusCallback: `https://${domain}/telephony/status`,
      StatusCallbackMethod: 'POST',
    })

    if (enableSms) {
      params.set('SmsUrl', `https://${domain}/api/messaging/sms/webhook`)
      params.set('SmsMethod', 'POST')
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to configure Twilio webhooks', res.status, text)
    }
  }

  async provisionNumber(
    credentials: TwilioCredentials,
    areaCode?: string,
    country?: string
  ): Promise<ProvisionNumberResult> {
    const sid = credentials.subAccountSid || credentials.accountSid
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`
    const authHeader = `Basic ${btoa(`${sid}:${credentials.accessToken}`)}`

    const params = new URLSearchParams()
    if (areaCode) params.set('AreaCode', areaCode)
    if (country) params.set('PhoneNumber', country)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to provision Twilio number', res.status, text)
    }

    const data = (await res.json()) as { phone_number: string; sid: string }
    return { phoneNumber: data.phone_number, sid: data.sid }
  }

  async createSipTrunk(credentials: TwilioCredentials, domain: string): Promise<SipTrunkConfig> {
    const sid = credentials.subAccountSid || credentials.accountSid
    const authHeader = `Basic ${btoa(`${sid}:${credentials.accessToken}`)}`

    // Create SIP trunk
    const trunkRes = await fetch('https://trunking.twilio.com/v1/Trunks', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        FriendlyName: `Llamenos SIP Trunk - ${domain}`,
      }).toString(),
    })

    if (!trunkRes.ok) {
      const text = await trunkRes.text()
      throw new ProviderApiError('Failed to create Twilio SIP trunk', trunkRes.status, text)
    }

    const trunk = (await trunkRes.json()) as { sid: string }

    // Add origination URI
    const originationRes = await fetch(
      `https://trunking.twilio.com/v1/Trunks/${trunk.sid}/OriginationUrls`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          FriendlyName: 'Llamenos Origination',
          SipUrl: `sip:${domain}`,
          Priority: '1',
          Weight: '1',
          Enabled: 'true',
        }).toString(),
      }
    )

    if (!originationRes.ok) {
      const text = await originationRes.text()
      throw new ProviderApiError(
        'Failed to configure SIP trunk origination',
        originationRes.status,
        text
      )
    }

    // Generate SIP credentials
    const sipUsername = `llamenos-${crypto.randomUUID().slice(0, 8)}`
    const sipPassword = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 32)

    return {
      sipProvider: 'sip.twilio.com',
      sipUsername,
      sipPassword,
      trunkSid: trunk.sid,
    }
  }

  async submitA2pBrand(
    credentials: TwilioCredentials,
    brandInfo: Record<string, string>
  ): Promise<A2pBrandResult> {
    const sid = credentials.subAccountSid || credentials.accountSid
    const authHeader = `Basic ${btoa(`${sid}:${credentials.accessToken}`)}`

    const res = await fetch('https://messaging.twilio.com/v1/a2p/BrandRegistrations', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(brandInfo).toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to submit A2P brand', res.status, text)
    }

    const data = (await res.json()) as { sid: string; status: string }
    return { brandSid: data.sid, status: 'pending' }
  }

  async submitA2pCampaign(
    credentials: TwilioCredentials,
    brandSid: string,
    messagingServiceSid: string,
    campaignBody: Record<string, unknown>
  ): Promise<{ campaignSid: string; status: 'pending' }> {
    const sid = credentials.subAccountSid || credentials.accountSid
    const authHeader = `Basic ${btoa(`${sid}:${credentials.accessToken}`)}`

    const body: Record<string, string> = {
      BrandRegistrationSid: brandSid,
    }
    for (const [key, value] of Object.entries(campaignBody)) {
      body[key] = String(value)
    }

    const res = await fetch(
      `https://messaging.twilio.com/v1/Services/${messagingServiceSid}/UsAppToPerson`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(body).toString(),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('Failed to submit A2P campaign', res.status, text)
    }

    const data = (await res.json()) as { sid: string; status: string }
    return { campaignSid: data.sid, status: 'pending' }
  }

  async getA2pStatus(
    credentials: TwilioCredentials,
    brandSid: string,
    campaignSid?: string,
    messagingServiceSid?: string
  ): Promise<A2pStatusResult> {
    const sid = credentials.subAccountSid || credentials.accountSid
    const authHeader = `Basic ${btoa(`${sid}:${credentials.accessToken}`)}`

    // Fetch brand status
    const brandRes = await fetch(
      `https://messaging.twilio.com/v1/a2p/BrandRegistrations/${brandSid}`,
      { headers: { Authorization: authHeader } }
    )

    if (!brandRes.ok) {
      const text = await brandRes.text()
      throw new ProviderApiError('Failed to get A2P brand status', brandRes.status, text)
    }

    const brandData = (await brandRes.json()) as { status: string }
    const brandStatus = mapA2pStatus(brandData.status)

    const result: A2pStatusResult = { brandStatus }

    // Fetch campaign status if we have a campaign SID
    if (campaignSid && messagingServiceSid) {
      const campaignRes = await fetch(
        `https://messaging.twilio.com/v1/Services/${messagingServiceSid}/UsAppToPerson/${campaignSid}`,
        { headers: { Authorization: authHeader } }
      )

      if (campaignRes.ok) {
        const campaignData = (await campaignRes.json()) as { sid: string; status: string }
        result.campaignStatus = mapA2pStatus(campaignData.status)
        result.campaignSid = campaignData.sid
      }
    }

    return result
  }
}

function mapA2pStatus(status: string): 'pending' | 'approved' | 'failed' {
  const upper = status.toUpperCase()
  if (upper === 'APPROVED' || upper === 'VERIFIED') return 'approved'
  if (upper.includes('FAIL') || upper.includes('REJECT')) return 'failed'
  return 'pending'
}
