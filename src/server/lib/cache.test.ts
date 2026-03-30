import { describe, expect, test } from 'bun:test'
import { TtlCache } from './cache'

describe('TtlCache', () => {
  test('returns cached value within TTL', () => {
    const cache = new TtlCache<string>(5000)
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })

  test('returns undefined after TTL expires', () => {
    const cache = new TtlCache<string>(0) // 0ms TTL = immediate expiry
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBeUndefined()
  })

  test('getOrSet calls factory on miss', async () => {
    const cache = new TtlCache<string>(5000)
    let calls = 0
    const result = await cache.getOrSet('key1', async () => {
      calls++
      return 'computed'
    })
    expect(result).toBe('computed')
    expect(calls).toBe(1)
    const result2 = await cache.getOrSet('key1', async () => {
      calls++
      return 'computed2'
    })
    expect(result2).toBe('computed')
    expect(calls).toBe(1)
  })

  test('clear removes all entries', () => {
    const cache = new TtlCache<string>(5000)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })

  test('delete removes single entry', () => {
    const cache = new TtlCache<string>(5000)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
  })
})
