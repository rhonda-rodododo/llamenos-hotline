import type { SMSConfig, TelephonyProviderConfig } from '../../../shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import type { MessagingAdapter } from '../adapter'
import { PlivoSMSAdapter } from './plivo'
import { SignalWireSMSAdapter } from './signalwire'
import { TelnyxSMSAdapter } from './telnyx'
import { TwilioSMSAdapter } from './twilio'
import { VonageSMSAdapter } from './vonage'

/**
 * Create an SMS messaging adapter based on the telephony provider configuration.
 * SMS reuses the telephony provider credentials -- no separate SMS credentials needed.
 *
 * @param telephonyConfig - The telephony provider configuration (credentials, type)
 * @param _smsConfig - SMS-specific configuration (enabled state, auto-responses).
 *                     Prefixed with _ because the factory only needs telephonyConfig
 *                     for adapter creation; smsConfig is consumed by the router layer.
 */
export function createSMSAdapter(
  telephonyConfig: TelephonyProviderConfig,
  _smsConfig: SMSConfig,
  crypto: CryptoService
): MessagingAdapter {
  const phoneNumber = telephonyConfig.phoneNumber

  switch (telephonyConfig.type) {
    case 'twilio': {
      if (!telephonyConfig.accountSid || !telephonyConfig.authToken) {
        throw new Error('Twilio SMS requires accountSid and authToken')
      }
      return new TwilioSMSAdapter(
        telephonyConfig.accountSid,
        telephonyConfig.authToken,
        phoneNumber,
        crypto
      )
    }

    case 'signalwire': {
      if (
        !telephonyConfig.accountSid ||
        !telephonyConfig.authToken ||
        !telephonyConfig.signalwireSpace
      ) {
        throw new Error('SignalWire SMS requires accountSid, authToken, and signalwireSpace')
      }
      return new SignalWireSMSAdapter(
        telephonyConfig.accountSid,
        telephonyConfig.authToken,
        phoneNumber,
        telephonyConfig.signalwireSpace,
        crypto
      )
    }

    case 'vonage': {
      if (!telephonyConfig.apiKey || !telephonyConfig.apiSecret) {
        throw new Error('Vonage SMS requires apiKey and apiSecret')
      }
      return new VonageSMSAdapter(
        telephonyConfig.apiKey,
        telephonyConfig.apiSecret,
        phoneNumber,
        crypto
      )
    }

    case 'plivo': {
      if (!telephonyConfig.authId || !telephonyConfig.authToken) {
        throw new Error('Plivo SMS requires authId and authToken')
      }
      return new PlivoSMSAdapter(
        telephonyConfig.authId,
        telephonyConfig.authToken,
        phoneNumber,
        crypto
      )
    }

    case 'asterisk': {
      // Asterisk has no native SMS — a dedicated SMS provider must be configured separately
      throw new Error(
        'Asterisk does not support SMS. Configure a separate SMS provider (e.g., Twilio) for SMS support.'
      )
    }

    case 'telnyx': {
      if (!telephonyConfig.apiKey) {
        throw new Error('Telnyx SMS requires apiKey')
      }
      return new TelnyxSMSAdapter(telephonyConfig.apiKey, phoneNumber, crypto)
    }
  }
}
