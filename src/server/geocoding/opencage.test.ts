import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { OpenCageAdapter } from './opencage'

const FAKE_KEY = 'test-opencage-key-123'

function makeResponse(results: unknown[], status = 200) {
  return new Response(
    JSON.stringify({
      results,
      status: { code: status, message: 'OK' },
      rate: { remaining: 2499 },
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

const sampleResult = {
  formatted: '123 Main St, Springfield, US',
  geometry: { lat: 39.7817, lng: -89.6501 },
  components: { country_code: 'us', _type: 'building' },
}

describe('OpenCageAdapter', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    fetchMock = mock(() => Promise.resolve(makeResponse([sampleResult])))
    globalThis.fetch = fetchMock as unknown as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('autocomplete', () => {
    test('constructs correct URL with query and API key', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY)
      await adapter.autocomplete('Springfield')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.origin + url.pathname).toBe('https://api.opencagedata.com/geocode/v1/json')
      expect(url.searchParams.get('q')).toBe('Springfield')
      expect(url.searchParams.get('key')).toBe(FAKE_KEY)
      expect(url.searchParams.get('no_annotations')).toBe('1')
    })

    test('sends limit param (default 5)', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY)
      await adapter.autocomplete('test')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.get('limit')).toBe('5')
    })

    test('sends custom limit', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY)
      await adapter.autocomplete('test', { limit: 3 })

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.get('limit')).toBe('3')
    })

    test('includes countrycode when countries specified', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY, ['us', 'ca'])
      await adapter.autocomplete('test')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.get('countrycode')).toBe('us,ca')
    })

    test('omits countrycode when no countries', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY)
      await adapter.autocomplete('test')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.has('countrycode')).toBe(false)
    })

    test('maps results to LocationResult', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY)
      const results = await adapter.autocomplete('Springfield')

      expect(results).toEqual([
        {
          address: '123 Main St, Springfield, US',
          lat: 39.7817,
          lon: -89.6501,
          countryCode: 'us',
        },
      ])
    })

    test('throws on 429 rate limit', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 429 }))
      ) as unknown as typeof fetch

      const adapter = new OpenCageAdapter(FAKE_KEY)
      await expect(adapter.autocomplete('test')).rejects.toThrow('OpenCage rate limit exceeded')
    })

    test('throws on non-ok response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 500, statusText: 'Internal Server Error' }))
      ) as unknown as typeof fetch

      const adapter = new OpenCageAdapter(FAKE_KEY)
      await expect(adapter.autocomplete('test')).rejects.toThrow(
        'OpenCage API error: 500 Internal Server Error'
      )
    })
  })

  describe('geocode', () => {
    test('returns first result from autocomplete with limit 1', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY)
      const result = await adapter.geocode('123 Main St')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.get('limit')).toBe('1')
      expect(result).toEqual({
        address: '123 Main St, Springfield, US',
        lat: 39.7817,
        lon: -89.6501,
        countryCode: 'us',
      })
    })

    test('returns null when no results', async () => {
      globalThis.fetch = mock(() => Promise.resolve(makeResponse([]))) as unknown as typeof fetch

      const adapter = new OpenCageAdapter(FAKE_KEY)
      const result = await adapter.geocode('nonexistent place')
      expect(result).toBeNull()
    })
  })

  describe('reverse', () => {
    test('sends lat+lng in query param', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY)
      await adapter.reverse(40.7128, -74.006)

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.get('q')).toBe('40.7128+-74.006')
      expect(url.searchParams.get('key')).toBe(FAKE_KEY)
      expect(url.searchParams.get('limit')).toBe('1')
    })

    test('returns mapped result', async () => {
      const adapter = new OpenCageAdapter(FAKE_KEY)
      const result = await adapter.reverse(39.7817, -89.6501)

      expect(result).toEqual({
        address: '123 Main St, Springfield, US',
        lat: 39.7817,
        lon: -89.6501,
        countryCode: 'us',
      })
    })

    test('returns null when no results', async () => {
      globalThis.fetch = mock(() => Promise.resolve(makeResponse([]))) as unknown as typeof fetch

      const adapter = new OpenCageAdapter(FAKE_KEY)
      const result = await adapter.reverse(0, 0)
      expect(result).toBeNull()
    })

    test('throws on 429 rate limit', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 429 }))
      ) as unknown as typeof fetch

      const adapter = new OpenCageAdapter(FAKE_KEY)
      await expect(adapter.reverse(40, -74)).rejects.toThrow('OpenCage rate limit exceeded')
    })

    test('throws on non-ok response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 503, statusText: 'Service Unavailable' }))
      ) as unknown as typeof fetch

      const adapter = new OpenCageAdapter(FAKE_KEY)
      await expect(adapter.reverse(40, -74)).rejects.toThrow(
        'OpenCage API error: 503 Service Unavailable'
      )
    })
  })
})
