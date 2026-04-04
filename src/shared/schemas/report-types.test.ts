import { describe, expect, test } from 'bun:test'
import { CreateReportTypeSchema } from './report-types'

describe('CreateReportTypeSchema', () => {
  test('rejects empty object (neither name nor encryptedName)', () => {
    const result = CreateReportTypeSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  test('accepts object with just name', () => {
    const result = CreateReportTypeSchema.safeParse({ name: 'Incident Report' })
    expect(result.success).toBe(true)
  })

  test('accepts object with just encryptedName', () => {
    const result = CreateReportTypeSchema.safeParse({ encryptedName: 'encrypted-value' })
    expect(result.success).toBe(true)
  })

  test('accepts object with both name and encryptedName', () => {
    const result = CreateReportTypeSchema.safeParse({
      name: 'Incident Report',
      encryptedName: 'encrypted-value',
    })
    expect(result.success).toBe(true)
  })

  test('rejects when name is empty string (min 1)', () => {
    const result = CreateReportTypeSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })
})
