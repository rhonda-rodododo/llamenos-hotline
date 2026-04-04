import { describe, expect, test } from 'bun:test'
import { CreateTagSchema } from './tags'

describe('CreateTagSchema', () => {
  test('rejects empty object (neither name nor encryptedLabel)', () => {
    const result = CreateTagSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  test('accepts object with just name', () => {
    const result = CreateTagSchema.safeParse({ name: 'urgent' })
    expect(result.success).toBe(true)
  })

  test('accepts object with just encryptedLabel', () => {
    const result = CreateTagSchema.safeParse({ encryptedLabel: 'encrypted-label-value' })
    expect(result.success).toBe(true)
  })

  test('accepts object with both name and encryptedLabel', () => {
    const result = CreateTagSchema.safeParse({
      name: 'urgent',
      encryptedLabel: 'encrypted-label-value',
    })
    expect(result.success).toBe(true)
  })

  test('rejects when name is empty string (min 1)', () => {
    const result = CreateTagSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  test('rejects when encryptedLabel is empty string (min 1)', () => {
    const result = CreateTagSchema.safeParse({ encryptedLabel: '' })
    expect(result.success).toBe(false)
  })
})
