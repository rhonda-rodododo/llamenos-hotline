import type { LocationResult } from '../../shared/types'
import type { GeocodingAdapter } from './adapter'

const AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete'
const SEARCH_URL = 'https://api.geoapify.com/v1/geocode/search'
const REVERSE_URL = 'https://api.geoapify.com/v1/geocode/reverse'

interface GeoapifyFeature {
  properties: {
    formatted: string
    lat: number
    lon: number
    country_code?: string
    name?: string
  }
}

interface GeoapifyResponse {
  features: GeoapifyFeature[]
}

function mapFeature(f: GeoapifyFeature): LocationResult {
  return {
    address: f.properties.formatted,
    displayName: f.properties.name,
    lat: f.properties.lat,
    lon: f.properties.lon,
    countryCode: f.properties.country_code,
  }
}

export class GeoapifyAdapter implements GeocodingAdapter {
  constructor(
    private apiKey: string,
    private countries: string[] = []
  ) {}

  async autocomplete(query: string, opts?: { limit?: number }): Promise<LocationResult[]> {
    const limit = opts?.limit ?? 5
    const params = new URLSearchParams({
      text: query,
      apiKey: this.apiKey,
      limit: String(limit),
      format: 'geojson',
    })
    if (this.countries.length > 0) {
      params.set('filter', `countrycode:${this.countries.join(',')}`)
    }

    const res = await fetch(`${AUTOCOMPLETE_URL}?${params}`)
    if (res.status === 429) {
      throw new Error('Geoapify rate limit exceeded. Please try again later.')
    }
    if (!res.ok) {
      throw new Error(`Geoapify API error: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as GeoapifyResponse
    return (data.features || []).map(mapFeature)
  }

  async geocode(address: string): Promise<LocationResult | null> {
    const params = new URLSearchParams({
      text: address,
      apiKey: this.apiKey,
      limit: '1',
      format: 'geojson',
    })

    const res = await fetch(`${SEARCH_URL}?${params}`)
    if (res.status === 429) {
      throw new Error('Geoapify rate limit exceeded. Please try again later.')
    }
    if (!res.ok) {
      throw new Error(`Geoapify API error: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as GeoapifyResponse
    return data.features?.[0] ? mapFeature(data.features[0]) : null
  }

  async reverse(lat: number, lon: number): Promise<LocationResult | null> {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      apiKey: this.apiKey,
      format: 'geojson',
    })

    const res = await fetch(`${REVERSE_URL}?${params}`)
    if (res.status === 429) {
      throw new Error('Geoapify rate limit exceeded. Please try again later.')
    }
    if (!res.ok) {
      throw new Error(`Geoapify API error: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as GeoapifyResponse
    return data.features?.[0] ? mapFeature(data.features[0]) : null
  }
}
