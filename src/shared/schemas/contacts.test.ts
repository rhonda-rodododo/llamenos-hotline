import { describe, expect, test } from 'bun:test'
import { CreateContactSchema } from './contacts'

const validEnvelope = {
  pubkey: 'abc123',
  wrappedKey: 'wrapped123',
  ephemeralPubkey: 'eph123',
}

const validContact = {
  contactType: 'caller' as const,
  riskLevel: 'low' as const,
  encryptedDisplayName: 'encrypted-name',
  displayNameEnvelopes: [validEnvelope],
}

describe('CreateContactSchema enum validation', () => {
  test('rejects invalid contactType', () => {
    const result = CreateContactSchema.safeParse({
      ...validContact,
      contactType: 'INVALID',
    })
    expect(result.success).toBe(false)
  })

  test('rejects invalid riskLevel', () => {
    const result = CreateContactSchema.safeParse({
      ...validContact,
      riskLevel: 'extreme',
    })
    expect(result.success).toBe(false)
  })

  test('accepts valid contactType values', () => {
    for (const contactType of ['caller', 'partner-org', 'referral-resource', 'other'] as const) {
      const result = CreateContactSchema.safeParse({
        ...validContact,
        contactType,
      })
      expect(result.success).toBe(true)
    }
  })

  test('accepts valid riskLevel values', () => {
    for (const riskLevel of ['low', 'medium', 'high', 'critical'] as const) {
      const result = CreateContactSchema.safeParse({
        ...validContact,
        riskLevel,
      })
      expect(result.success).toBe(true)
    }
  })
})
