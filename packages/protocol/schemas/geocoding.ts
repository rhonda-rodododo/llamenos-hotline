import { z } from 'zod'

export const locationPrecisionSchema = z.enum([
  'none', 'city', 'neighborhood', 'block', 'exact',
])
export type LocationPrecision = z.infer<typeof locationPrecisionSchema>

export const locationResultSchema = z.object({
  address: z.string(),
  displayName: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  countryCode: z.string().optional(),
})
export type LocationResult = z.infer<typeof locationResultSchema>

export const geocodingConfigSchema = z.object({
  provider: z.enum(['opencage', 'geoapify', 'llamenos-central']).nullable(),
  countries: z.array(z.string()),
  enabled: z.boolean(),
})
export type GeocodingConfig = z.infer<typeof geocodingConfigSchema>

export const geocodingConfigAdminSchema = geocodingConfigSchema.extend({
  apiKey: z.string(),
})
export type GeocodingConfigAdmin = z.infer<typeof geocodingConfigAdminSchema>

export const geocodingTestResponseSchema = z.object({
  ok: z.boolean(),
  latency: z.number(),
})
export type GeocodingTestResponse = z.infer<typeof geocodingTestResponseSchema>
