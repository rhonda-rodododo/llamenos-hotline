import type { LocationResult } from '../../shared/types'

/**
 * Abstract geocoding adapter interface.
 * Implementations: OpenCage, Geoapify, NullAdapter (fallback when unconfigured).
 */
export interface GeocodingAdapter {
  /** Search for addresses matching a partial query string. */
  autocomplete(query: string, opts?: { limit?: number }): Promise<LocationResult[]>

  /** Forward geocode: resolve a full address to coordinates. */
  geocode(address: string): Promise<LocationResult | null>

  /** Reverse geocode: resolve coordinates to an address. */
  reverse(lat: number, lon: number): Promise<LocationResult | null>
}
