import type { LocationResult } from '../../shared/types'
import type { GeocodingAdapter } from './adapter'

/**
 * No-op geocoding adapter used when geocoding is disabled or unconfigured.
 * Returns empty results for all operations.
 */
export class NullGeocodingAdapter implements GeocodingAdapter {
  async autocomplete(_query: string, _opts?: { limit?: number }): Promise<LocationResult[]> {
    return []
  }

  async geocode(_address: string): Promise<LocationResult | null> {
    return null
  }

  async reverse(_lat: number, _lon: number): Promise<LocationResult | null> {
    return null
  }
}
