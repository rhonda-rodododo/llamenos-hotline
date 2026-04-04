import type {
  AutoConfigResult,
  ConnectionTestResult,
  NumberSearchQuery,
  PhoneNumberInfo,
  ProvisionResult,
  SipTrunkOptions,
  TelephonyProviderConfig,
  TelephonyProviderType,
  WebhookUrlSet,
} from '@shared/types'
import type { z } from 'zod/v4'

export interface ProviderCapabilities<T extends TelephonyProviderConfig = TelephonyProviderConfig> {
  readonly type: TelephonyProviderType
  readonly displayName: string
  readonly description: string
  readonly credentialSchema: z.ZodType<T>

  readonly supportsOAuth: boolean
  readonly supportsSms: boolean
  readonly supportsSip: boolean
  readonly supportsWebRtc: boolean
  readonly supportsNumberProvisioning: boolean
  readonly supportsWebhookAutoConfig: boolean

  testConnection(credentials: T): Promise<ConnectionTestResult>
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet

  listOwnedNumbers?(credentials: T): Promise<PhoneNumberInfo[]>
  searchAvailableNumbers?(credentials: T, query: NumberSearchQuery): Promise<PhoneNumberInfo[]>
  provisionNumber?(credentials: T, number: string): Promise<ProvisionResult>
  configureWebhooks?(
    credentials: T,
    phoneNumber: string,
    webhookUrls: WebhookUrlSet
  ): Promise<AutoConfigResult>
  configureSipTrunk?(credentials: T, options: SipTrunkOptions): Promise<AutoConfigResult>
}

import { asteriskCapabilities } from './asterisk-capabilities'
import { bandwidthCapabilities } from './bandwidth-capabilities'
import { freeswitchCapabilities } from './freeswitch-capabilities'
import { plivoCapabilities } from './plivo-capabilities'
import { signalwireCapabilities } from './signalwire-capabilities'
import { telnyxCapabilities } from './telnyx-capabilities'
// Registry — imports from per-provider capability files
import { twilioCapabilities } from './twilio-capabilities'
import { vonageCapabilities } from './vonage-capabilities'

export const TELEPHONY_CAPABILITIES: Record<TelephonyProviderType, ProviderCapabilities> = {
  twilio: twilioCapabilities,
  signalwire: signalwireCapabilities,
  vonage: vonageCapabilities,
  plivo: plivoCapabilities,
  asterisk: asteriskCapabilities,
  telnyx: telnyxCapabilities,
  bandwidth: bandwidthCapabilities,
  freeswitch: freeswitchCapabilities,
}
