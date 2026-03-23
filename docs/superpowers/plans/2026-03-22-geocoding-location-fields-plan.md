# Geocoding Provider & Location Custom Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port geocoding provider + location custom field type from v2 to v1. Providers: OpenCage and Geoapify only (no llamenos-central).

**Spec:** `docs/superpowers/specs/2026-03-22-geocoding-location-fields-design.md`
**v2 reference:** `~/projects/llamenos/apps/worker/geocoding/` and `~/projects/llamenos/src/client/components/ui/location-field.tsx`

**Assumes:** Drizzle migration complete. Pre-Drizzle: use SettingsDO patterns with same logic.

---

## Phase 1: Backend — Geocoding Adapter

### 1.1 Shared types
- [x] Add to `src/shared/types.ts`:
  ```typescript
  export type LocationPrecision = 'none' | 'city' | 'neighborhood' | 'block' | 'exact'
  export type LocationResult = { address: string; displayName?: string; lat: number; lon: number; countryCode?: string }
  export type LocationFieldValue = { address: string; displayName?: string; lat?: number; lon?: number; source: 'geocoded' | 'gps' | 'manual' }
  export type GeocodingProvider = 'opencage' | 'geoapify'
  export type GeocodingConfig = { provider: GeocodingProvider | null; countries: string[]; enabled: boolean }
  export type GeocodingConfigAdmin = GeocodingConfig & { apiKey: string }
  ```
- [x] Add `fieldType: 'location'` to the `CustomFieldDefinition` union type
- [x] Add `LocationFieldSettings` to `CustomFieldDefinition` (only present when `fieldType === 'location'`)

### 1.2 Geocoding adapter interface
- [x] Create `src/worker/geocoding/adapter.ts` (port from v2):
  ```typescript
  export interface GeocodingAdapter {
    autocomplete(query: string, opts?: { limit?: number }): Promise<LocationResult[]>
    geocode(address: string): Promise<LocationResult | null>
    reverse(lat: number, lon: number): Promise<LocationResult | null>
  }
  ```

### 1.3 OpenCage provider
- [x] Create `src/worker/geocoding/opencage.ts` (port from v2 `opencage.ts`)
  - Base URL: `https://api.opencagedata.com/geocode/v1/json`
  - Read API key from constructor param
  - Implement `autocomplete(query, { limit })`: `GET ?q=${query}&limit=${limit}&key=${apiKey}&countrycode=${countries}`
  - Implement `geocode(address)`: same endpoint, take first result
  - Implement `reverse(lat, lon)`: `GET ?q=${lat}+${lon}&key=${apiKey}`
  - Map response: `{ formatted: string, geometry: { lat, lng }, components.country_code }` → `LocationResult`
  - Handle rate limit errors (429) with descriptive error message
  - No external dependencies needed (just `fetch`)

### 1.4 Geoapify provider
- [x] Create `src/worker/geocoding/geoapify.ts` (port from v2 `geoapify.ts`)
  - Autocomplete URL: `https://api.geoapify.com/v1/geocode/autocomplete?text=${query}&limit=${limit}&filter=countrycode:${countries}&apiKey=${apiKey}`
  - Geocode URL: `https://api.geoapify.com/v1/geocode/search?text=${address}&apiKey=${apiKey}`
  - Reverse URL: `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${apiKey}`
  - Map response: `features[0].properties.{formatted, lat, lon, country_code}` → `LocationResult`

### 1.5 Null adapter
- [x] Create `src/worker/geocoding/null-adapter.ts`:
  - All methods return `[]` / `null`
  - Used when geocoding is disabled or unconfigured

### 1.6 Factory
- [x] Create `src/worker/geocoding/factory.ts`:
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
- [x] Add `geocodingConfig` to SettingsDO storage (using existing DO storage pattern, not Drizzle — project uses DOs)
  - Stored as `GeocodingConfigAdmin` under key `'geocodingConfig'`
  - Default: `{ enabled: false, provider: null, apiKey: '', countries: [] }`

### 2.2 Zod schemas
- [x] Validation implemented inline in SettingsDO `updateGeocodingConfig` method (matches existing pattern — no separate Zod schemas needed as project uses DO pattern)

### 2.3 Settings service methods
- [x] Add to `SettingsDO`:
  - `getGeocodingConfig()` — returns config without apiKey
  - `getGeocodingConfigAdmin()` — full config (server-only use)
  - `updateGeocodingConfig(data)` — validates + saves

### 2.4 Inject geocoding adapter into app context
- [x] Adapter created per-request in geocoding route handlers via `getAdapter()` helper (stateless, no middleware injection needed)

---

## Phase 3: API Routes

### 3.1 Geocoding routes
- [x] Create `src/worker/routes/geocoding.ts`:
  - `POST /api/geocoding/autocomplete` — requirePermission('notes:create'), rate limited 60/min
  - `POST /api/geocoding/geocode` — requirePermission('notes:create'), rate limited 20/min
  - `POST /api/geocoding/reverse` — requirePermission('notes:create'), rate limited 20/min
- [x] Register under `/api/geocoding` in `src/worker/app.ts` (authenticated routes)

### 3.2 Settings routes for geocoding
- [x] Added to geocoding routes:
  - `GET /api/geocoding/config` — GeocodingConfig (no apiKey, any authenticated user)
  - `GET /api/geocoding/settings` — GeocodingConfigAdmin (requires settings:manage)
  - `PATCH /api/geocoding/settings` — update config (requires settings:manage)
  - `GET /api/geocoding/test` — { ok, latency } (requires settings:manage)
- [x] Test endpoint: calls `adapter.geocode('London, UK')` with 5s timeout, measures latency

### 3.3 Add env vars to server config
- [x] Not needed — API keys stored in SettingsDO config, not env vars (matches existing pattern for telephony provider)

---

## Phase 4: Frontend — Location Field Component

### 4.1 Port LocationField from v2
- [x] Create `src/client/components/ui/location-field.tsx`:
  - Props: `value: LocationFieldValue | null`, `onChange`, `maxPrecision`, `allowAutocomplete`, `disabled`
  - Debounced autocomplete (300ms) via `POST /api/geocoding/autocomplete`
  - Dropdown suggestion list (max 5)
  - Select: calls `capToPrecision(result, maxPrecision)` before calling `onChange`
  - "Open in maps" button → opens OpenStreetMap URL
  - Clear button
  - If `allowGps`: geolocation button → calls `POST /api/geocoding/reverse` with browser coords
  - Coordinates display below input when available

### 4.2 capToPrecision helper
- [x] Implemented inline in `location-field.tsx` (co-located with the component that uses it)

### 4.3 Port LocationTriagePanel from v2
- [x] Create `src/client/components/ui/location-triage-panel.tsx`:
  - Takes `text: string` prop (message content or note body)
  - `extractLocationHint(text)` — regex extraction for addresses/intersections
  - Renders pre-populate button if hint found

### 4.4 Integrate into CustomFieldInputs
- [x] Update `src/client/components/notes/custom-field-inputs.tsx`:
  - Add case for `type === 'location'` → render `<LocationField />`
  - Read `maxPrecision` and `allowGps` from field definition's `locationSettings`
  - Store `LocationFieldValue` JSON in the field's value

### 4.5 Admin settings UI — GeocodingSettingsSection
- [x] Create `src/client/components/admin-settings/geocoding-settings-section.tsx`:
  - Provider select: "Disabled" / "OpenCage" / "Geoapify"
  - API key input (type="password")
  - Countries input (comma-separated, e.g., "us,ca,mx")
  - Enable/disable toggle
  - "Test" button → calls `GET /api/geocoding/test` → shows latency or error
  - Save button
- [x] Add section to admin settings page (after Custom Fields section)

### 4.6 Custom field definition editor
- [x] Update `src/client/components/admin-settings/custom-fields-section.tsx`:
  - Add "Location" option to field type dropdown
  - When `location` selected: show `maxPrecision` select and `allowGps` toggle
  - Show note: "Location data is encrypted with note content (zero-knowledge)"

---

## Phase 5: i18n

- [x] Add location field strings to all 13 locale files:
  - `locationField.placeholder`, `locationField.searching`, `locationField.noResults`
  - `locationField.openInMaps`, `locationField.clearLocation`
  - `locationField.useCurrentLocation` (GPS)
  - `geocoding.title`, `geocoding.provider`, `geocoding.apiKey`, etc.
  - `customFields.types.location`
  - `customFields.locationSettings`, `customFields.maxPrecision`, `customFields.allowGps`
  - `customFields.precision.*` (exact, block, neighborhood, city, none)
  - `customFields.locationEncryptionNote`

---

## Phase 6: E2E Tests

- [x] Add `tests/geocoding.spec.ts`:
  - Admin sees geocoding section in hub settings
  - Admin can select geocoding provider (OpenCage, Geoapify)
  - Admin can switch between providers
  - Admin can save geocoding config
  - Admin can disable geocoding
  - Admin can add a location custom field
  - Location field appears in note creation form

---

## Completion Checklist

- [x] `src/worker/geocoding/` directory with adapter, opencage, geoapify, null, factory
- [x] `geocodingConfig` in SettingsDO storage (DO pattern, not Drizzle migration)
- [x] `/api/geocoding/autocomplete`, `/geocode`, `/reverse` endpoints working
- [x] `/api/geocoding/settings` GET/PATCH/test endpoints working
- [x] LocationField component: autocomplete, select, GPS, clear all working
- [x] GeocodingSettingsSection in admin settings
- [x] Location field type in custom field editor
- [x] i18n keys added to all 13 locales
- [x] API keys never appear in client responses (getGeocodingConfig strips apiKey)
- [x] Location values encrypted with note content (E2EE — stored as JSON string in custom field value, encrypted with note payload)
- [x] Graceful degradation when geocoding disabled (free-text input via manual source)
- [x] `bun run typecheck` passes
- [x] `bun run build` passes
- [x] E2E tests written
