import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// OpenCage Geocoding API Response Schemas
//
// The OpenCage API returns JSON from GET https://api.opencagedata.com/geocode/v1/json
// Rate limit metadata is in the response body AND in HTTP response headers.
//
// Reference: https://opencagedata.com/api#response-format
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Coordinate pair — reused across geometry and bounds
// ---------------------------------------------------------------------------

export const LatLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

export type LatLng = z.infer<typeof LatLngSchema>

// ---------------------------------------------------------------------------
// Result components
// Address components extracted from the matched result.
// Keys vary by result type and country; all fields are optional.
// ---------------------------------------------------------------------------

export const OpenCageComponentsSchema = z.looseObject({
  /** Internal type tag (e.g. "city", "road", "building") */
  _type: z.string().optional(),
  /** Internal category (e.g. "place") */
  _category: z.string().optional(),
  /** Normalised city name for deduplication */
  _normalized_city: z.string().optional(),
  /** ISO 3166-1 alpha-2 country code, lower-cased (e.g. "us", "de") */
  country_code: z.string().optional(),
  /** ISO 3166-1 alpha-3 country code */
  'ISO_3166-1_alpha-3': z.string().optional(),
  /** ISO 3166-2 subdivision codes */
  'ISO_3166-2': z.array(z.string()).optional(),
  continent: z.string().optional(),
  country: z.string().optional(),
  /** First-level administrative division (state, province, region) */
  state: z.string().optional(),
  state_code: z.string().optional(),
  /** Second-level administrative division (county, district) */
  county: z.string().optional(),
  city: z.string().optional(),
  /** Sub-city district or borough */
  city_district: z.string().optional(),
  /** Neighbourhood / suburb */
  suburb: z.string().optional(),
  neighbourhood: z.string().optional(),
  postcode: z.string().optional(),
  road: z.string().optional(),
  road_type: z.string().optional(),
  house_number: z.string().optional(),
  building: z.string().optional(),
})

export type OpenCageComponents = z.infer<typeof OpenCageComponentsSchema>

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

export const OpenCageBoundsSchema = z.object({
  northeast: LatLngSchema,
  southwest: LatLngSchema,
})

export type OpenCageBounds = z.infer<typeof OpenCageBoundsSchema>

// ---------------------------------------------------------------------------
// Annotations (optional enrichment data)
// Only present when annotations are requested (no_annotations=0, the default).
// All sub-objects are optional as availability depends on location data.
// ---------------------------------------------------------------------------

export const OpenCageAnnotationsSchema = z.looseObject({
  /** Degrees Minutes Seconds representation */
  DMS: z
    .object({
      lat: z.string(),
      lng: z.string(),
    })
    .optional(),
  /** Military Grid Reference System */
  MGRS: z.string().optional(),
  /** Maidenhead / QTH locator */
  Maidenhead: z.string().optional(),
  Mercator: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  /** Country calling code (e.g. 1 for US) */
  callingcode: z.number().optional(),
  currency: z
    .looseObject({
      iso_code: z.string().optional(),
      name: z.string().optional(),
      symbol: z.string().optional(),
      decimal_mark: z.string().optional(),
      thousands_separator: z.string().optional(),
      iso_numeric: z.string().optional(),
      subunit: z.string().optional(),
      subunit_to_unit: z.number().optional(),
      html_entity: z.string().optional(),
    })
    .optional(),
  /** Unicode flag emoji for the country */
  flag: z.string().optional(),
  /** Geohash string */
  geohash: z.string().optional(),
  /** Qibla direction in degrees from North */
  qibla: z.number().optional(),
  roadinfo: z
    .looseObject({
      drive_on: z.enum(['left', 'right']).optional(),
      road: z.string().optional(),
      road_type: z.string().optional(),
      speed_in: z.enum(['km/h', 'mph']).optional(),
    })
    .optional(),
  sun: z
    .looseObject({
      rise: z
        .object({
          apparent: z.number(),
          astronomical: z.number(),
          civil: z.number(),
          nautical: z.number(),
        })
        .optional(),
      set: z
        .object({
          apparent: z.number(),
          astronomical: z.number(),
          civil: z.number(),
          nautical: z.number(),
        })
        .optional(),
    })
    .optional(),
  timezone: z
    .looseObject({
      name: z.string(),
      offset_sec: z.number(),
      offset_string: z.string(),
      short_name: z.string(),
      now_in_dst: z.number(),
    })
    .optional(),
  what3words: z
    .object({
      words: z.string(),
    })
    .optional(),
  OSM: z
    .looseObject({
      url: z.string().optional(),
      note_url: z.string().optional(),
      edit_url: z.string().optional(),
    })
    .optional(),
  UN_M49: z
    .looseObject({
      regions: z.record(z.string(), z.string()).optional(),
      statistical_groupings: z.array(z.string()).optional(),
    })
    .optional(),
})

export type OpenCageAnnotations = z.infer<typeof OpenCageAnnotationsSchema>

// ---------------------------------------------------------------------------
// Single geocode result
// ---------------------------------------------------------------------------

export const OpenCageResultSchema = z.looseObject({
  /** Human-readable formatted address */
  formatted: z.string(),
  geometry: LatLngSchema,
  components: OpenCageComponentsSchema,
  bounds: OpenCageBoundsSchema.optional(),
  /**
   * Confidence score 0–10 indicating precision of the match.
   * 10 = rooftop-level, 1 = country-level. Not used for ranking.
   */
  confidence: z.number().int().min(0).max(10),
  annotations: OpenCageAnnotationsSchema.optional(),
  /**
   * Distance in meters between the query and this result.
   * Only present for reverse geocoding with a known point of reference.
   */
  distance_from_q: z
    .object({
      meters: z.number(),
    })
    .optional(),
})

export type OpenCageResult = z.infer<typeof OpenCageResultSchema>

// ---------------------------------------------------------------------------
// Rate limit info (body)
// Present in all responses; may be omitted for accounts without hard limits.
// ---------------------------------------------------------------------------

export const OpenCageRateSchema = z.object({
  /** Daily request quota */
  limit: z.number().int(),
  /** Requests remaining today */
  remaining: z.number().int(),
  /** Unix timestamp when the quota resets (midnight UTC) */
  reset: z.number().int(),
})

export type OpenCageRate = z.infer<typeof OpenCageRateSchema>

// ---------------------------------------------------------------------------
// API status object
// ---------------------------------------------------------------------------

export const OpenCageStatusSchema = z.object({
  /** HTTP-style status code (200 = OK, 400 = bad request, 402 = quota exceeded, etc.) */
  code: z.number().int(),
  message: z.string(),
})

export type OpenCageStatus = z.infer<typeof OpenCageStatusSchema>

// ---------------------------------------------------------------------------
// Top-level geocoding response
// ---------------------------------------------------------------------------

export const OpenCageGeocodeResponseSchema = z.looseObject({
  results: z.array(OpenCageResultSchema),
  status: OpenCageStatusSchema,
  total_results: z.number().int(),
  rate: OpenCageRateSchema.optional(),
  /** Documentation URL included in every response */
  documentation: z.string().optional(),
  licenses: z
    .array(
      z.object({
        name: z.string(),
        url: z.string(),
      })
    )
    .optional(),
  timestamp: z
    .object({
      created_http: z.string(),
      created_unix: z.number().int(),
    })
    .optional(),
})

export type OpenCageGeocodeResponse = z.infer<typeof OpenCageGeocodeResponseSchema>

// ---------------------------------------------------------------------------
// Rate limit HTTP response headers
// Included in every response for accounts with hard limits.
// Header names are case-insensitive; typical Node/Hono header access is lower-cased.
// ---------------------------------------------------------------------------

export const OpenCageRateLimitHeadersSchema = z.object({
  'x-ratelimit-limit': z.string(),
  'x-ratelimit-remaining': z.string(),
  'x-ratelimit-reset': z.string(),
})

export type OpenCageRateLimitHeaders = z.infer<typeof OpenCageRateLimitHeadersSchema>

/**
 * Parse OpenCage rate limit values from response headers.
 * Returns null if any required header is missing.
 */
export function parseOpenCageRateLimitHeaders(
  headers: Record<string, string | undefined>
): { limit: number; remaining: number; reset: number } | null {
  const limit = headers['x-ratelimit-limit']
  const remaining = headers['x-ratelimit-remaining']
  const reset = headers['x-ratelimit-reset']
  if (!limit || !remaining || !reset) return null
  return {
    limit: Number.parseInt(limit, 10),
    remaining: Number.parseInt(remaining, 10),
    reset: Number.parseInt(reset, 10),
  }
}
