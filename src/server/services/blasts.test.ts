import { describe, expect, test } from 'bun:test'
import type { Subscriber, SubscriberChannel } from '../types'
import { matchesBlastFilters, selectChannel } from './blasts'

const makeSub = (overrides: Partial<Subscriber> = {}): Subscriber => ({
  id: 'sub-1',
  hubId: 'hub-1',
  identifierHash: 'hash',
  channels: [{ type: 'sms', verified: true }] as SubscriberChannel[],
  tags: [],
  language: 'en',
  status: 'active',
  doubleOptInConfirmed: true,
  subscribedAt: new Date(),
  preferenceToken: 'tok',
  createdAt: new Date(),
  encryptedIdentifier: 'encrypted-data',
  ...overrides,
})

describe('matchesBlastFilters', () => {
  test('matches when no filters specified', () => {
    expect(matchesBlastFilters(makeSub(), [], [], [])).toBe(true)
  })
  test('rejects inactive subscriber', () => {
    expect(matchesBlastFilters(makeSub({ status: 'paused' }), [], [], [])).toBe(false)
  })
  test('rejects subscriber without encrypted identifier', () => {
    expect(matchesBlastFilters(makeSub({ encryptedIdentifier: null }), [], [], [])).toBe(false)
  })
  test('filters by target channel — verified only', () => {
    const sub = makeSub({
      channels: [
        { type: 'sms', verified: false },
        { type: 'whatsapp', verified: true },
      ] as SubscriberChannel[],
    })
    expect(matchesBlastFilters(sub, ['sms'], [], [])).toBe(false)
    expect(matchesBlastFilters(sub, ['whatsapp'], [], [])).toBe(true)
  })
  test('filters by tag', () => {
    const sub = makeSub({ tags: ['urgent'] })
    expect(matchesBlastFilters(sub, [], ['urgent'], [])).toBe(true)
    expect(matchesBlastFilters(sub, [], ['weather'], [])).toBe(false)
  })
  test('filters by language', () => {
    const sub = makeSub({ language: 'es' })
    expect(matchesBlastFilters(sub, [], [], ['es', 'en'])).toBe(true)
    expect(matchesBlastFilters(sub, [], [], ['fr'])).toBe(false)
  })
})

describe('selectChannel', () => {
  test('returns first verified channel when no filter', () => {
    const sub = makeSub({ channels: [{ type: 'sms', verified: true }] as SubscriberChannel[] })
    expect(selectChannel(sub, [])).toEqual({ type: 'sms', verified: true })
  })
  test('skips unverified channels', () => {
    const sub = makeSub({
      channels: [
        { type: 'sms', verified: false },
        { type: 'whatsapp', verified: true },
      ] as SubscriberChannel[],
    })
    expect(selectChannel(sub, [])?.type).toBe('whatsapp')
  })
  test('returns null when no matching verified channel', () => {
    const sub = makeSub({ channels: [{ type: 'sms', verified: false }] as SubscriberChannel[] })
    expect(selectChannel(sub, ['sms'])).toBeNull()
  })
  test('filters by target channels', () => {
    const sub = makeSub({
      channels: [
        { type: 'sms', verified: true },
        { type: 'whatsapp', verified: true },
      ] as SubscriberChannel[],
    })
    expect(selectChannel(sub, ['whatsapp'])?.type).toBe('whatsapp')
  })
})
