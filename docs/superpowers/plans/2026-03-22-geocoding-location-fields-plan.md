# Geocoding Provider & Location Custom Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port geocoding provider + location custom field type from v2 to v1. Providers: OpenCage and Geoapify only (no llamenos-central).

**Spec:** `docs/superpowers/specs/2026-03-22-geocoding-location-fields-design.md`
**v2 reference:** `~/projects/llamenos/apps/worker/geocoding/` and `~/projects/llamenos/src/client/components/ui/location-field.tsx`

**Assumes:** Drizzle migration complete. Pre-Drizzle: use SettingsDO patterns with same logic.

---

## Phase 1: Backend — Geocoding Adapter

### 1.1 Shared types
- [ ] Add to `src/shared/types.ts`:
  ```typescript
  export type LocationPrecision = 'none' | 'city' | 'neighborhood' | 'block' | 'exact'
  export type LocationResult = { address: string; displayName?: string; lat: number; lon: number; countryCode?: string }
  export type LocationFieldValue = { address: string; displayName?: string; lat?: number; lon?: number; source: 'geocoded' | 'gps' | 'manual' }
  export type GeocodingProvider = 'opencage' | 'geoapify'
  export type GeocodingConfig = { provider: GeocodingProvider | null; countries: string[]; enabled: boolean }
  export type GeocodingConfigAdmin = GeocodingConfig & { apiKey: string }
  ```
- [ ] Add `fieldType: 'location'` to the `CustomFieldDefinition` union type
- [ ] Add `LocationFieldSettings` to `CustomFieldDefinition` (only present when `fieldType === 'location'`)

### 1.2 Geocoding adapter interface
- [ ] Create `src/server/geocoding/adapter.ts` (port from v2):
  ```typescript
  export interface GeocodingAdapter {
    autocomplete(query: string, opts?: { limit?: number }): Promise<LocationResult[]>
    geocode(address: string): Promise<LocationResult | null>
    reverse(lat: number, lon: number): Promise<LocationResult | null>
  }
  ```

### 1.3 OpenCage provider
- [ ] Create `src/server/geocoding/opencage.ts` (port from v2 `opencage.ts`)
  - Base URL: `https://api.opencagedata.com/geocode/v1/json`
  - Read API key from constructor param
  - Implement `autocomplete(query, { limit })`: `GET ?q=${query}&limit=${limit}&key=${apiKey}&countrycode=${countries}`
  - Implement `geocode(address)`: same endpoint, take first result
  - Implement `reverse(lat, lon)`: `GET ?q=${lat}+${lon}&key=${apiKey}`
  - Map response: `{ formatted: string, geometry: { lat, lng }, components.country_code }` → `LocationResult`
  - Handle rate limit errors (429) with descriptive error message
  - No external dependencies needed (just `fetch`)

### 1.4 Geoapify provider
- [ ] Create `src/server/geocoding/geoapify.ts` (port from v2 `geoapify.ts`)
  - Autocomplete URL: `https://api.geoapify.com/v1/geocode/autocomplete?text=${query}&limit=${limit}&filter=countrycode:${countries}&apiKey=${apiKey}`
  - Geocode URL: `https://api.geoapify.com/v1/geocode/search?text=${address}&apiKey=${apiKey}`
  - Reverse URL: `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${apiKey}`
  - Map response: `features[0].properties.{formatted, lat, lon, country_code}` → `LocationResult`

### 1.5 Null adapter
- [ ] Create `src/server/geocoding/null-adapter.ts`:
  - All methods return `[]` / `null`
  - Used when geocoding is disabled or unconfigured

### 1.6 Factory
- [ ] Create `src/server/geocoding/factory.ts`:
  ```typescript
  export function createGeocodingAdapter(config: GeocodingConfigAdmin | null): GeocodingAdapter {
    if (!config?.enabled || !config.provider) return new NullGeocodingAdapter()
    if (config.provider === 'opencage') return new OpenCageAdapter(config.apiKey, config.countries)
    if (config.provider === 'geoapify') return new GeoapifyAdapter(config.apiKey, config.countries)
    return new NullGeocodingAdapter()
  }
  ```

---

## Phase 2: Database Schema & Settings Service

### 2.1 Database schema
- [ ] Add `geocoding_config` JSONB column to `settings` table in `src/server/db/schema/settings.ts`:
  ```typescript
  geocodingConfig: jsonb('geocoding_config').$type<GeocodingConfigAdmin>().default({ enabled: false, provider: null, apiKey: '', countries: [] })
  ```
- [ ] Run `bunx drizzle-kit generate` to create migration

### 2.2 Zod schemas
- [ ] Add to `src/server/schemas/settings.ts`:
  - `GeocodingConfigAdminSchema` (full, with apiKey)
  - `GeocodingConfigSchema` (omits apiKey, for client responses)
  - `GeocodingTestResponseSchema` = `z.object({ ok: z.boolean(), latency: z.number() })`

### 2.3 Settings service methods
- [ ] Add to `SettingsService`:
  - `getGeocodingConfig(): Promise<GeocodingConfig>` — returns config without apiKey
  - `getGeocodingConfigAdmin(): Promise<GeocodingConfigAdmin>` — full config (server-only use)
  - `updateGeocodingConfig(data: GeocodingConfigAdmin): Promise<void>` — validates + saves

### 2.4 Inject geocoding adapter into app context
- [ ] In `src/server/middleware/services.ts` (or equivalent middleware setup):
  - Read `geocodingConfigAdmin` from settings on startup (or lazily on first request)
  - Create adapter via factory and inject as `c.get('geocoding')`
  - Refresh adapter if config changes (or recreate per-request — adapter is stateless)

---

## Phase 3: API Routes

### 3.1 Geocoding routes
- [ ] Create `src/server/routes/geocoding.ts`:
  ```typescript
  // POST /api/geocoding/autocomplete
  geocoding.post('/autocomplete', requirePermission('notes:create'), async (c) => {
    const { query, limit } = GeocodingAutocompleteSchema.parse(await c.req.json())
    // Rate limit: 60/min per user
    await checkRateLimit(c.get('services').settings, `geocoding:autocomplete:${pubkey}`, 60)
    const adapter = c.get('geocoding')
    return c.json(await adapter.autocomplete(query, { limit }))
  })

  // POST /api/geocoding/geocode
  // POST /api/geocoding/reverse
  // (same pattern, 20/min rate limit)
  ```
- [ ] Register under `/api/geocoding` in `src/server/app.ts`

### 3.2 Settings routes for geocoding
- [ ] Add to `src/server/routes/settings.ts`:
  ```
  GET  /api/settings/geocoding       → GeocodingConfig (no apiKey)
  PUT  /api/settings/geocoding       → requires settings:manage
  GET  /api/settings/geocoding/test  → { ok, latency }
  ```
- [ ] Test endpoint: calls `adapter.geocode('London, UK')` with 5s timeout, measures latency

### 3.3 Add env vars to server config
- [ ] Add `OPENCAGE_API_KEY` and `GEOAPIFY_API_KEY` to `src/server/types.ts` Env type (optional)
- [ ] In setup: if API key env var is set AND no `geocodingConfig` in DB, auto-configure

---

## Phase 4: Frontend — Location Field Component

### 4.1 Port LocationField from v2
- [ ] Create `src/client/components/ui/location-field.tsx` (port from v2):
  - Props: `value: LocationFieldValue | null`, `onChange`, `maxPrecision`, `allowAutocomplete`, `disabled`
  - Debounced autocomplete (300ms) via `POST /api/geocoding/autocomplete`
  - Dropdown suggestion list (max 5)
  - Select: calls `capToPrecision(result, maxPrecision)` before calling `onChange`
  - "Open in maps" button → opens `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}` or address search
  - Clear button
  - If `allowGps`: geolocation button → calls `POST /api/geocoding/reverse` with browser coords
  - Read-only display: shows address + (lat, lon) in muted text
  - Disabled when geocoding not configured (graceful degradation to text input)

### 4.2 capToPrecision helper
- [ ] Add to `src/client/lib/format.ts`:
  ```typescript
  function capToPrecision(result: LocationResult, maxPrecision: LocationPrecision): LocationFieldValue {
    const value: LocationFieldValue = { address: result.address, displayName: result.displayName, source: 'geocoded' }
    if (['block', 'neighborhood', 'city', 'exact'].includes(maxPrecision) && maxPrecision !== 'none') {
      // Only include coords if precision allows
      if (maxPrecision === 'exact' || maxPrecision === 'block') {
        value.lat = result.lat
        value.lon = result.lon
      }
    }
    return value
  }
  ```

### 4.3 Port LocationTriagePanel from v2
- [ ] Create `src/client/components/ui/location-triage-panel.tsx` (port from v2):
  - Takes `text: string` prop (message content or note body)
  - `extractLocationHint(text)` — regex extraction for addresses/intersections
  - Renders pre-populate button if hint found
  - Used in conversation view (optional, integrates with LocationField)

### 4.4 Integrate into CustomFieldInputs
- [ ] Update `src/client/components/custom-field-inputs.tsx`:
  - Add case for `fieldType === 'location'` → render `<LocationField />`
  - Read `maxPrecision` and `allowGps` from field definition settings
  - Store `LocationFieldValue` JSON in the field's value

### 4.5 Admin settings UI — GeocodingSettingsSection
- [ ] Create `src/client/components/admin-settings/geocoding-settings-section.tsx` (port from v2):
  - Provider select: "Disabled" / "OpenCage" / "Geoapify"
  - API key input (type="password")
  - Countries input (comma-separated, e.g., "us,ca,mx")
  - Enable/disable toggle
  - "Test" button → calls `GET /api/settings/geocoding/test` → shows latency or error
  - Save button
- [ ] Add section to admin settings page (collapsible, under "Integrations" or new "Location" section)

### 4.6 Custom field definition editor
- [ ] Update custom field definition editor (`src/client/components/admin-settings/custom-fields-settings-section.tsx`):
  - Add "Location" option to field type dropdown
  - When `location` selected: show `maxPrecision` select and `allowGps` toggle
  - Show note: "Location data is encrypted with note content (zero-knowledge)"

---

## Phase 5: i18n

- [ ] Add location field strings to all 13 locale files:
  - `ui.locationField.placeholder`, `ui.locationField.searching`, `ui.locationField.noResults`
  - `ui.locationField.openInMaps`, `ui.locationField.clearLocation`
  - `ui.locationField.useCurrentLocation` (GPS)
  - `admin.settings.geocoding.title`, `admin.settings.geocoding.provider`, `admin.settings.geocoding.apiKey`, etc.
  - `custom_fields.type.location`

---

## Phase 6: E2E Tests

- [ ] Add to `tests/custom-fields.spec.ts`:
  - Admin adds "location" type custom field to note form
  - Field appears in note creation form
  - Type in location query → suggestions appear (mock API response)
  - Select suggestion → field populated with address
  - Create note → note saved with location field value
  - Reload → location field value shown correctly (displays address, not coords if precision is city-level)
- [ ] Add to `tests/admin-flow.spec.ts` or new `tests/geocoding.spec.ts`:
  - Admin configures geocoding provider (select OpenCage, enter API key, save)
  - Test connection shows latency
  - Changing to Geoapify updates form

---

## Completion Checklist

- [ ] `src/server/geocoding/` directory with adapter, opencage, geoapify, null, factory
- [ ] `geocodingConfig` column in settings table + migration generated
- [ ] `/api/geocoding/autocomplete`, `/geocode`, `/reverse` endpoints working
- [ ] `/api/settings/geocoding` GET/PUT/test endpoints working
- [ ] LocationField component: autocomplete, select, GPS, clear all working
- [ ] GeocodingSettingsSection in admin settings
- [ ] Location field type in custom field editor
- [ ] i18n keys added to all 13 locales
- [ ] API keys never appear in client responses
- [ ] Location values encrypted with note content (E2EE)
- [ ] Graceful degradation when geocoding disabled (free-text input)
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] E2E tests pass
