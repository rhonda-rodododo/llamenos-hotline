import type { GeocodingConfigAdmin } from '../../shared/types'
import type { GeocodingAdapter } from './adapter'
import { GeoapifyAdapter } from './geoapify'
import { NullGeocodingAdapter } from './null-adapter'
import { OpenCageAdapter } from './opencage'

/**
 * Create a geocoding adapter from the admin config.
 * Returns NullGeocodingAdapter when geocoding is disabled or unconfigured.
 */
export function createGeocodingAdapter(config: GeocodingConfigAdmin | null): GeocodingAdapter {
  if (!config?.enabled || !config.provider || !config.apiKey) {
    return new NullGeocodingAdapter()
  }
  if (config.provider === 'opencage') {
    return new OpenCageAdapter(config.apiKey, config.countries)
  }
  if (config.provider === 'geoapify') {
    return new GeoapifyAdapter(config.apiKey, config.countries)
  }
  return new NullGeocodingAdapter()
}
