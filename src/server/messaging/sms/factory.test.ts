import { describe, expect, mock, test } from 'bun:test'
import type { SMSConfig, TelephonyProviderConfig } from '../../../shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import { createSMSAdapter } from './factory'
import { PlivoSMSAdapter } from './plivo'
import { SignalWireSMSAdapter } from './signalwire'
import { TelnyxSMSAdapter } from './telnyx'
import { TwilioSMSAdapter } from './twilio'
import { VonageSMSAdapter } from './vonage'

const smsConfig: SMSConfig = {
  enabled: true,
}

function makeCrypto(): CryptoService {
  return {
    hmac: mock((input: string, label: string) => `hmac:${label}:${input}`),
  } as unknown as CryptoService
}

describe('createSMSAdapter', () => {
  // ─── Twilio ──────────────────────────────────────────────────

  test('returns TwilioSMSAdapter for twilio config', () => {
    const config: TelephonyProviderConfig = {
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'AC00000000000000000000000000000000',
      authToken: 'a'.repeat(32),
    }

    const adapter = createSMSAdapter(config, smsConfig, makeCrypto())
    expect(adapter).toBeInstanceOf(TwilioSMSAdapter)
  })

  test('throws for twilio with missing accountSid', () => {
    const config = {
      type: 'twilio' as const,
      phoneNumber: '+15551234567',
      accountSid: '',
      authToken: 'a'.repeat(32),
    } as TelephonyProviderConfig

    expect(() => createSMSAdapter(config, smsConfig, makeCrypto())).toThrow(
      /Twilio SMS requires accountSid and authToken/
    )
  })

  test('throws for twilio with missing authToken', () => {
    const config = {
      type: 'twilio' as const,
      phoneNumber: '+15551234567',
      accountSid: 'AC00000000000000000000000000000000',
      authToken: '',
    } as TelephonyProviderConfig

    expect(() => createSMSAdapter(config, smsConfig, makeCrypto())).toThrow(
      /Twilio SMS requires accountSid and authToken/
    )
  })

  // ─── Telnyx ──────────────────────────────────────────────────

  test('returns TelnyxSMSAdapter for telnyx config', () => {
    const config: TelephonyProviderConfig = {
      type: 'telnyx',
      phoneNumber: '+15551234567',
      apiKey: 'KEY_test_abc123',
    }

    const adapter = createSMSAdapter(config, smsConfig, makeCrypto())
    expect(adapter).toBeInstanceOf(TelnyxSMSAdapter)
  })

  test('throws for telnyx with missing apiKey', () => {
    const config = {
      type: 'telnyx' as const,
      phoneNumber: '+15551234567',
      apiKey: '',
    } as TelephonyProviderConfig

    expect(() => createSMSAdapter(config, smsConfig, makeCrypto())).toThrow(
      /Telnyx SMS requires apiKey/
    )
  })

  // ─── SignalWire ──────────────────────────────────────────────

  test('returns SignalWireSMSAdapter for signalwire config', () => {
    const config: TelephonyProviderConfig = {
      type: 'signalwire',
      phoneNumber: '+15551234567',
      accountSid: 'sw-account-id',
      authToken: 'sw-auth-token',
      signalwireSpace: 'myspace',
    }

    const adapter = createSMSAdapter(config, smsConfig, makeCrypto())
    expect(adapter).toBeInstanceOf(SignalWireSMSAdapter)
  })

  test('throws for signalwire with missing signalwireSpace', () => {
    const config = {
      type: 'signalwire' as const,
      phoneNumber: '+15551234567',
      accountSid: 'sw-account-id',
      authToken: 'sw-auth-token',
      signalwireSpace: '',
    } as TelephonyProviderConfig

    expect(() => createSMSAdapter(config, smsConfig, makeCrypto())).toThrow(
      /SignalWire SMS requires accountSid, authToken, and signalwireSpace/
    )
  })

  // ─── Vonage ──────────────────────────────────────────────────

  test('returns VonageSMSAdapter for vonage config', () => {
    const config: TelephonyProviderConfig = {
      type: 'vonage',
      phoneNumber: '+15551234567',
      apiKey: 'vonage-key',
      apiSecret: 'vonage-secret',
      applicationId: '00000000-0000-0000-0000-000000000000',
    }

    const adapter = createSMSAdapter(config, smsConfig, makeCrypto())
    expect(adapter).toBeInstanceOf(VonageSMSAdapter)
  })

  test('throws for vonage with missing apiSecret', () => {
    const config = {
      type: 'vonage' as const,
      phoneNumber: '+15551234567',
      apiKey: 'vonage-key',
      apiSecret: '',
    } as TelephonyProviderConfig

    expect(() => createSMSAdapter(config, smsConfig, makeCrypto())).toThrow(
      /Vonage SMS requires apiKey and apiSecret/
    )
  })

  // ─── Plivo ───────────────────────────────────────────────────

  test('returns PlivoSMSAdapter for plivo config', () => {
    const config: TelephonyProviderConfig = {
      type: 'plivo',
      phoneNumber: '+15551234567',
      authId: 'plivo-auth-id',
      authToken: 'plivo-auth-token',
    }

    const adapter = createSMSAdapter(config, smsConfig, makeCrypto())
    expect(adapter).toBeInstanceOf(PlivoSMSAdapter)
  })

  test('throws for plivo with missing authId', () => {
    const config = {
      type: 'plivo' as const,
      phoneNumber: '+15551234567',
      authId: '',
      authToken: 'plivo-auth-token',
    } as TelephonyProviderConfig

    expect(() => createSMSAdapter(config, smsConfig, makeCrypto())).toThrow(
      /Plivo SMS requires authId and authToken/
    )
  })

  // ─── Asterisk ────────────────────────────────────────────────

  test('throws for asterisk (no native SMS)', () => {
    const config: TelephonyProviderConfig = {
      type: 'asterisk',
      phoneNumber: '+15551234567',
      ariUrl: 'http://localhost:8088',
      ariUsername: 'test',
      ariPassword: 'test',
    }

    expect(() => createSMSAdapter(config, smsConfig, makeCrypto())).toThrow(
      /Asterisk does not support SMS/
    )
  })

  // ─── Bandwidth ───────────────────────────────────────────────

  test('throws for bandwidth (not yet implemented)', () => {
    const config: TelephonyProviderConfig = {
      type: 'bandwidth',
      phoneNumber: '+15551234567',
      accountId: 'bw-account',
      apiToken: 'bw-token',
      apiSecret: 'bw-secret',
      applicationId: 'bw-app',
    }

    expect(() => createSMSAdapter(config, smsConfig, makeCrypto())).toThrow(
      /Bandwidth SMS adapter not yet implemented/
    )
  })
})
