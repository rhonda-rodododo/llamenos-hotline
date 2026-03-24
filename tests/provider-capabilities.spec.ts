import { test, expect } from '@playwright/test'

test.describe('provider Zod schemas', () => {
  test('TwilioConfigSchema validates correct config', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(true)
  })

  test('TwilioConfigSchema rejects invalid accountSid', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'INVALID',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })

  test('TelephonyProviderConfigSchema discriminates by type', async () => {
    const { TelephonyProviderConfigSchema } = await import('../src/shared/schemas/providers')
    const twilio = TelephonyProviderConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(twilio.success).toBe(true)

    const asterisk = TelephonyProviderConfigSchema.safeParse({
      type: 'asterisk',
      phoneNumber: '+15551234567',
      ariUrl: 'http://localhost:8088/ari',
      ariUsername: 'admin',
      ariPassword: 'secret',
    })
    expect(asterisk.success).toBe(true)

    const invalid = TelephonyProviderConfigSchema.safeParse({
      type: 'unknown_provider',
      phoneNumber: '+15551234567',
    })
    expect(invalid.success).toBe(false)
  })

  test('rejects phone numbers not in E.164 format', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '5551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })

  test('TelnyxConfigSchema validates', async () => {
    const { TelnyxConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TelnyxConfigSchema.safeParse({
      type: 'telnyx',
      phoneNumber: '+15551234567',
      apiKey: 'KEY01234567890ABCDEF',
    })
    expect(result.success).toBe(true)
  })
})
