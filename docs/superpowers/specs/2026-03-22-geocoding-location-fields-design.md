# Geocoding Provider & Location Custom Fields — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Backport the geocoding provider and `location` custom field type from v2 (`~/projects/llamenos`). This enables volunteers to attach structured location data (with autocomplete) to call notes, helping the organisation map crisis hotspots, dispatch resources, or simply provide richer case records.

v2 reference: `~/projects/llamenos/apps/worker/geocoding/`

---

## 1. Geocoding Providers

### Supported providers (2 external, trustworthy)

| Provider | Env var | Free tier | Notes |
|---|---|---|---|
| **OpenCage** | `OPENCAGE_API_KEY` | 2,500 req/day | EU-based, GDPR-friendly, excellent coverage |
| **Geoapify** | `GEOAPIFY_API_KEY` | 3,000 req/day | Strong EU/global, supports autocomplete |

Both providers support country filtering (ISO 3166-1 alpha-2 codes, comma-separated). The `llamenos-central` provider from v2 is NOT included — we only want external trustworthy services.

### GeocodingAdapter interface

```typescript
interface GeocodingAdapter {
  autocomplete(query: string, opts?: { limit?: number }): Promise<LocationResult[]>
  geocode(address: string): Promise<LocationResult | null>
  reverse(lat: number, lon: number): Promise<LocationResult | null>
}
```

### LocationResult schema

```typescript
{
  address: string          // Full formatted address
  displayName?: string     // Short display label (city + country)
  lat: number              // Latitude
  lon: number              // Longitude
  countryCode?: string     // ISO 3166-1 alpha-2
}
```

### Null adapter
When geocoding is not configured or disabled, a `NullGeocodingAdapter` is used — returns empty arrays / null. Feature degrades gracefully; location fields become free-text inputs.

---

## 2. Location Precision (Privacy)

Callers' locations are sensitive. The `maxPrecision` field on the custom field definition controls how precisely a location is stored.

| Precision | Stored data | Use case |
|---|---|---|
| `none` | Address string only, no coordinates | Log description without geospatial queries |
| `city` | City + country + coords (city-level) | Heat maps by city |
| `neighborhood` | Neighbourhood + city + coords | District-level analysis |
| `block` | Block-level address + coords | Emergency dispatch |
| `exact` | Full address + precise coords | Maximum detail (default) |

When the volunteer selects an address, the `capToPrecision()` function strips coordinates if the field's `maxPrecision` is below the threshold that coords apply.

---

## 3. Location Custom Field Type

### Field definition extension

The `CustomFieldDefinition` type gains a new `fieldType: 'location'` option, plus location-specific settings:

```typescript
type LocationFieldSettings = {
  allowGps: boolean             // Allow browser geolocation (navigator.geolocation)
  maxPrecision: LocationPrecision  // Cap on stored precision (see above)
  restrictToCountries?: string[] // Filter autocomplete suggestions
}
```

### Stored value format

```typescript
type LocationFieldValue = {
  address: string               // Human-readable formatted address
  displayName?: string          // Short label (city + country)
  lat?: number                  // Latitude (if precision allows)
  lon?: number                  // Longitude (if precision allows)
  source: 'geocoded' | 'gps' | 'manual'  // How the value was set
}
```

This is stored as JSONB in the note's custom fields payload. It is encrypted along with the rest of the note content (E2EE applies — the server never sees plaintext location data).

---

## 4. API Endpoints

### Geocoding endpoints (volunteer-accessible)

```
POST /api/geocoding/autocomplete   { query: string, limit?: number }     → LocationResult[]
POST /api/geocoding/geocode        { address: string }                    → LocationResult | null
POST /api/geocoding/reverse        { lat: number, lon: number }           → LocationResult | null
```

**Rate limits (per user):** autocomplete 60/min, geocode/reverse 20/min
**Permission required:** `notes:create` (volunteers writing notes)

### Geocoding settings (admin)

```
GET  /api/settings/geocoding        → GeocodingConfig (no API key)
PUT  /api/settings/geocoding        { provider, apiKey, countries, enabled }  → 204
GET  /api/settings/geocoding/test   → { ok: boolean, latency: number }
```

**Permission required for PUT/test:** `settings:manage`

---

## 5. Security & Privacy Considerations

- **API keys are server-only**: Never returned in `GET /api/settings/geocoding` (apiKey field omitted)
- **Geocoding requests are server-proxied**: Client posts the query to our API, which forwards to the provider. The provider never receives the volunteer's IP directly.
- **Location data is E2EE**: Location values stored inside note custom fields are encrypted alongside note content. Server cannot read locations at rest.
- **GDPR**: Location data is personal data. It is subject to the same retention policy as note content. On volunteer deletion (GDPR erasure), location data is erased with the note envelope.
- **Precision caps**: Field definitions can cap maximum precision to prevent over-collection.

---

## 6. Location Triage Panel

A helper component (`LocationTriagePanel`) appears in the conversation view when a caller's message contains location patterns. It extracts location hints from text (e.g., "corner of Main and Oak", "123 Elm Street") and offers a pre-populated location field to attach to a note.

Pattern extraction (regex):
- `\d+\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct)` — Street address
- `corner of ([^,]+) and ([^,]+)` — Intersection
- `([A-Z][a-z]+)\s+&\s+([A-Z][a-z]+)` — Cross streets

---

## 7. Admin Settings UI

A new `GeocodingSettingsSection` in the admin settings panel:
- Provider dropdown: None / OpenCage / Geoapify
- API key input (masked)
- Country restriction (comma-separated ISO codes, optional)
- Enable/disable toggle
- "Test connection" button — shows latency or error

---

## 8. Dependencies

- v2 reference implementations: `opencage.ts`, `geoapify.ts`, `adapter.ts`, `factory.ts`
- New `location-field.tsx` UI component (port from v2)
- New `location-triage-panel.tsx` (port from v2)
- `OPENCAGE_API_KEY` / `GEOAPIFY_API_KEY` env vars
- `geocodingConfig` column in settings table (JSONB)

> **Note:** Assumes Drizzle migration complete. Pre-Drizzle: store `geocodingConfig` in SettingsDO under `settings:geocoding` key.
