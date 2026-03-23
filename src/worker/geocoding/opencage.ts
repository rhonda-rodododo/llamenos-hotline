import type { LocationResult } from '../../shared/types'
import type { GeocodingAdapter } from './adapter'

const BASE_URL = 'https://api.opencagedata.com/geocode/v1/json'

interface OpenCageResult {
  formatted: string
  geometry: { lat: number; lng: number }
  components: { country_code?: string; _type?: string }
}

interface OpenCageResponse {
  results: OpenCageResult[]
  status: { code: number; message: string }
  rate: { remaining: number }
}

function mapResult(r: OpenCageResult): LocationResult {
  return {
    address: r.formatted,
    lat: r.geometry.lat,
    lon: r.geometry.lng,
    countryCode: r.components.country_code,
  }
}

export class OpenCageAdapter implements GeocodingAdapter {
  constructor(
    private apiKey: string,
    private countries: string[] = []
  ) {}

  async autocomplete(query: string, opts?: { limit?: number }): Promise<LocationResult[]> {
    const limit = opts?.limit ?? 5
    const params = new URLSearchParams({
      q: query,
      key: this.apiKey,
      limit: String(limit),
      no_annotations: '1',
    })
    if (this.countries.length > 0) {
      params.set('countrycode', this.countries.join(','))
    }

    const res = await fetch(`${BASE_URL}?${params}`)
    if (res.status === 429) {
      throw new Error('OpenCage rate limit exceeded. Please try again later.')
    }
    if (!res.ok) {
      throw new Error(`OpenCage API error: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as OpenCageResponse
    return data.results.map(mapResult)
  }

  async geocode(address: string): Promise<LocationResult | null> {
    const results = await this.autocomplete(address, { limit: 1 })
    return results[0] ?? null
  }

  async reverse(lat: number, lon: number): Promise<LocationResult | null> {
    const params = new URLSearchParams({
      q: `${lat}+${lon}`,
      key: this.apiKey,
      limit: '1',
      no_annotations: '1',
    })

    const res = await fetch(`${BASE_URL}?${params}`)
    if (res.status === 429) {
      throw new Error('OpenCage rate limit exceeded. Please try again later.')
    }
    if (!res.ok) {
      throw new Error(`OpenCage API error: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as OpenCageResponse
    return data.results[0] ? mapResult(data.results[0]) : null
  }
}
