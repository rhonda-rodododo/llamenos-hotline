import { describe, expect, test } from 'bun:test'
import { extractContactEntities } from './transcript-extraction'

describe('transcript entity extraction', () => {
  test('extracts US phone numbers', () => {
    const entities = extractContactEntities('Call me at (555) 123-4567')
    const phones = entities.filter((e) => e.type === 'phone')
    expect(phones).toHaveLength(1)
    expect(phones[0].value).toContain('555')
  })

  test('extracts E.164 phone numbers with high confidence', () => {
    const entities = extractContactEntities('My number is +15551234567')
    const phones = entities.filter((e) => e.type === 'phone')
    expect(phones).toHaveLength(1)
    expect(phones[0].confidence).toBe('high')
  })

  test('extracts email addresses', () => {
    const entities = extractContactEntities('Email me at john@example.com please')
    const emails = entities.filter((e) => e.type === 'email')
    expect(emails).toHaveLength(1)
    expect(emails[0].value).toBe('john@example.com')
    expect(emails[0].confidence).toBe('high')
  })

  test('extracts names with relationship context', () => {
    const entities = extractContactEntities('His sister Maria Garcia can help')
    const names = entities.filter((e) => e.type === 'name')
    expect(names).toHaveLength(1)
    expect(names[0].value).toBe('Maria Garcia')
  })

  test('extracts self-introductions', () => {
    const entities = extractContactEntities('My name is John Smith and I need help')
    const names = entities.filter((e) => e.type === 'name')
    expect(names).toHaveLength(1)
    expect(names[0].value).toBe('John Smith')
    expect(names[0].confidence).toBe('high')
  })

  test('provides context around matches', () => {
    const entities = extractContactEntities('Please call (555) 123-4567 after 5pm')
    expect(entities[0].context).toContain('call')
  })

  test('returns empty array for no matches', () => {
    const entities = extractContactEntities('Hello, how are you doing today?')
    expect(entities).toHaveLength(0)
  })

  test('does not false-positive on common words', () => {
    const entities = extractContactEntities('The weather is nice and I feel good about this')
    expect(entities.filter((e) => e.type === 'name')).toHaveLength(0)
  })
})
