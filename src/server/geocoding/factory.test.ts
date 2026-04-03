import { describe, expect, test } from 'bun:test'
import type { GeocodingConfigAdmin } from '../../shared/types'
import { createGeocodingAdapter } from './factory'
import { GeoapifyAdapter } from './geoapify'
import { NullGeocodingAdapter } from './null-adapter'
import { OpenCageAdapter } from './opencage'

describe('createGeocodingAdapter', () => {
  test('returns OpenCageAdapter for opencage provider', () => {
    const config: GeocodingConfigAdmin = {
      provider: 'opencage',
      apiKey: 'oc-key',
      countries: ['us'],
      enabled: true,
    }
    const adapter = createGeocodingAdapter(config)
    expect(adapter).toBeInstanceOf(OpenCageAdapter)
  })

  test('returns GeoapifyAdapter for geoapify provider', () => {
    const config: GeocodingConfigAdmin = {
      provider: 'geoapify',
      apiKey: 'ga-key',
      countries: [],
      enabled: true,
    }
    const adapter = createGeocodingAdapter(config)
    expect(adapter).toBeInstanceOf(GeoapifyAdapter)
  })

  test('returns NullAdapter when config is null', () => {
    const adapter = createGeocodingAdapter(null)
    expect(adapter).toBeInstanceOf(NullGeocodingAdapter)
  })

  test('returns NullAdapter when enabled is false', () => {
    const config: GeocodingConfigAdmin = {
      provider: 'opencage',
      apiKey: 'key',
      countries: [],
      enabled: false,
    }
    const adapter = createGeocodingAdapter(config)
    expect(adapter).toBeInstanceOf(NullGeocodingAdapter)
  })

  test('returns NullAdapter when provider is null', () => {
    const config: GeocodingConfigAdmin = {
      provider: null,
      apiKey: 'key',
      countries: [],
      enabled: true,
    }
    const adapter = createGeocodingAdapter(config)
    expect(adapter).toBeInstanceOf(NullGeocodingAdapter)
  })

  test('returns NullAdapter when apiKey is empty', () => {
    const config: GeocodingConfigAdmin = {
      provider: 'opencage',
      apiKey: '',
      countries: [],
      enabled: true,
    }
    const adapter = createGeocodingAdapter(config)
    expect(adapter).toBeInstanceOf(NullGeocodingAdapter)
  })

  test('returns NullAdapter for unknown provider', () => {
    const config = {
      provider: 'mapbox' as 'opencage',
      apiKey: 'key',
      countries: [],
      enabled: true,
    }
    const adapter = createGeocodingAdapter(config)
    expect(adapter).toBeInstanceOf(NullGeocodingAdapter)
  })
})
