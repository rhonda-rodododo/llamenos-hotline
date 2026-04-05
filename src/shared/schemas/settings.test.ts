import { describe, expect, test } from 'bun:test'
import { EnabledChannelsSchema } from './settings'

describe('EnabledChannelsSchema', () => {
  const validChannels = {
    voice: true,
    sms: true,
    whatsapp: false,
    signal: false,
    rcs: false,
    telegram: false,
    reports: true,
  }

  test('accepts valid object with all channels including telegram', () => {
    const result = EnabledChannelsSchema.safeParse(validChannels)
    expect(result.success).toBe(true)
  })

  test('requires telegram boolean field', () => {
    const { telegram: _, ...withoutTelegram } = validChannels
    const result = EnabledChannelsSchema.safeParse(withoutTelegram)
    expect(result.success).toBe(false)
  })

  test('rejects non-boolean telegram value', () => {
    const result = EnabledChannelsSchema.safeParse({
      ...validChannels,
      telegram: 'yes',
    })
    expect(result.success).toBe(false)
  })

  test('telegram field is present in parsed output', () => {
    const result = EnabledChannelsSchema.safeParse(validChannels)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(typeof result.data.telegram).toBe('boolean')
      expect(result.data.telegram).toBe(false)
    }
  })
})
