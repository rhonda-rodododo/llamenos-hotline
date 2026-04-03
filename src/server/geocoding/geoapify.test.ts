import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GeoapifyAdapter } from './geoapify'

const FAKE_KEY = 'test-geoapify-key-456'

function makeResponse(features: unknown[]) {
  return new Response(JSON.stringify({ features }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const sampleFeature = {
  properties: {
    formatted: '456 Oak Ave, Portland, OR, USA',
    name: 'Oak Ave',
    lat: 45.5155,
    lon: -122.6789,
    country_code: 'us',
  },
}

describe('GeoapifyAdapter', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    fetchMock = mock(() => Promise.resolve(makeResponse([sampleFeature])))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('autocomplete', () => {
    test('uses autocomplete URL with text param', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await adapter.autocomplete('Portland')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/autocomplete')
      expect(url.searchParams.get('text')).toBe('Portland')
      expect(url.searchParams.get('apiKey')).toBe(FAKE_KEY)
      expect(url.searchParams.get('format')).toBe('geojson')
    })

    test('sends default limit of 5', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await adapter.autocomplete('test')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.get('limit')).toBe('5')
    })

    test('sends custom limit', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await adapter.autocomplete('test', { limit: 10 })

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.get('limit')).toBe('10')
    })

    test('includes country filter when countries specified', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY, ['us', 'mx'])
      await adapter.autocomplete('test')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.get('filter')).toBe('countrycode:us,mx')
    })

    test('omits filter when no countries', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await adapter.autocomplete('test')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.has('filter')).toBe(false)
    })

    test('maps features to LocationResult with displayName', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      const results = await adapter.autocomplete('Portland')

      expect(results).toEqual([
        {
          address: '456 Oak Ave, Portland, OR, USA',
          displayName: 'Oak Ave',
          lat: 45.5155,
          lon: -122.6789,
          countryCode: 'us',
        },
      ])
    })

    test('returns empty array when features is missing', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      ) as unknown as typeof fetch

      const adapter = new GeoapifyAdapter(FAKE_KEY)
      const results = await adapter.autocomplete('nothing')
      expect(results).toEqual([])
    })

    test('throws on 429 rate limit', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 429 }))
      ) as unknown as typeof fetch

      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await expect(adapter.autocomplete('test')).rejects.toThrow('Geoapify rate limit exceeded')
    })

    test('throws on non-ok response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 500, statusText: 'Internal Server Error' }))
      ) as unknown as typeof fetch

      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await expect(adapter.autocomplete('test')).rejects.toThrow(
        'Geoapify API error: 500 Internal Server Error'
      )
    })
  })

  describe('geocode', () => {
    test('uses search URL with text param and limit 1', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await adapter.geocode('456 Oak Ave, Portland')

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/search')
      expect(url.searchParams.get('text')).toBe('456 Oak Ave, Portland')
      expect(url.searchParams.get('limit')).toBe('1')
    })

    test('returns mapped result', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      const result = await adapter.geocode('456 Oak Ave')

      expect(result).toEqual({
        address: '456 Oak Ave, Portland, OR, USA',
        displayName: 'Oak Ave',
        lat: 45.5155,
        lon: -122.6789,
        countryCode: 'us',
      })
    })

    test('returns null when no features', async () => {
      globalThis.fetch = mock(() => Promise.resolve(makeResponse([]))) as unknown as typeof fetch

      const adapter = new GeoapifyAdapter(FAKE_KEY)
      const result = await adapter.geocode('nonexistent')
      expect(result).toBeNull()
    })

    test('throws on 429 rate limit', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 429 }))
      ) as unknown as typeof fetch

      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await expect(adapter.geocode('test')).rejects.toThrow('Geoapify rate limit exceeded')
    })
  })

  describe('reverse', () => {
    test('uses reverse URL with lat/lon params', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await adapter.reverse(45.5155, -122.6789)

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/reverse')
      expect(url.searchParams.get('lat')).toBe('45.5155')
      expect(url.searchParams.get('lon')).toBe('-122.6789')
      expect(url.searchParams.get('apiKey')).toBe(FAKE_KEY)
      expect(url.searchParams.get('format')).toBe('geojson')
    })

    test('returns mapped result', async () => {
      const adapter = new GeoapifyAdapter(FAKE_KEY)
      const result = await adapter.reverse(45.5155, -122.6789)

      expect(result).toEqual({
        address: '456 Oak Ave, Portland, OR, USA',
        displayName: 'Oak Ave',
        lat: 45.5155,
        lon: -122.6789,
        countryCode: 'us',
      })
    })

    test('returns null when no features', async () => {
      globalThis.fetch = mock(() => Promise.resolve(makeResponse([]))) as unknown as typeof fetch

      const adapter = new GeoapifyAdapter(FAKE_KEY)
      const result = await adapter.reverse(0, 0)
      expect(result).toBeNull()
    })

    test('throws on 429 rate limit', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 429 }))
      ) as unknown as typeof fetch

      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await expect(adapter.reverse(0, 0)).rejects.toThrow('Geoapify rate limit exceeded')
    })

    test('throws on non-ok response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('', { status: 502, statusText: 'Bad Gateway' }))
      ) as unknown as typeof fetch

      const adapter = new GeoapifyAdapter(FAKE_KEY)
      await expect(adapter.reverse(0, 0)).rejects.toThrow('Geoapify API error: 502 Bad Gateway')
    })
  })
})
