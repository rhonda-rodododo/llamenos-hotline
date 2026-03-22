# Dashboard Analytics & Historical Charts — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

The admin dashboard shows only live/today data: active call count, today's call volume, volunteer presence, shift status. There is no historical view. Admins cannot see trends, identify peak hours, or assess team performance over time. This makes capacity planning and shift scheduling decisions uninformed.

## Goals

1. Add a "7-day" and "30-day" call volume chart to the admin dashboard.
2. Add a peak-hours distribution chart (24-hour histogram).
3. Add a volunteer performance summary table (calls answered, avg duration — admin only).
4. All analytics data loaded lazily (only when the section is expanded — not on page load).
5. Keep bundle size impact minimal.

## Non-Goals

- Real-time analytics updating during the current day (live stats already exist).
- Per-volunteer detailed call logs in the analytics section (that belongs on the call history page).
- Analytics export/CSV (future).
- Message analytics (deferred — can add `getMessageVolumeByDay` once call analytics is stable).

## Privacy Considerations

Analytics aggregate data only — no per-call detail in the analytics endpoints. Volunteer stats are returned as `{ pubkey, callsAnswered, avgDuration }[]` — no names in the server response. The client resolves pubkeys to display names locally. This avoids any server-side aggregation against encrypted fields.

The analytics section is **admin-only**. Volunteers do not see team performance data.

## Architecture

### Server-side: SQL aggregations

New service methods (in `RecordsService` or a dedicated `AnalyticsService`):

```typescript
getCallVolumeByDay(hubId, days: 7 | 30):
  → { date: string, count: number, answered: number, voicemail: number }[]

getAvgCallDurationByDay(hubId, days: 7 | 30):
  → { date: string, avgSeconds: number }[]

getCallHourDistribution(hubId, days: 30):
  → { hour: number, count: number }[]   // hour: 0–23

getVolunteerCallStats(hubId, days: 30):
  → { pubkey: string, callsAnswered: number, avgDuration: number }[]
```

> **Zero-knowledge constraint:** `answeredBy` is part of the encrypted call payload — the server cannot read volunteer names from call records to do stats aggregation. `getVolunteerCallStats` must NOT attempt to derive names server-side. Instead, maintain a separate plaintext counter table `volunteer_call_counts(hub_id, pubkey, date, count)` incremented on call answer (before encryption, at the time of the event), without storing any PII. The API response returns `{ pubkey, callsAnswered, avgDuration }[]` only. The client resolves volunteer names from the hub's volunteer list (which provides pubkey → display name mapping already available client-side).

These use `GROUP BY DATE(created_at)` / `GROUP BY EXTRACT(HOUR FROM created_at)` SQL patterns. Index on `(hub_id, created_at)` required (verify schema has it).

> **Backend abstraction note:** Implementation must handle both storage backends. For PostgreSQL (primary/Bun server), use standard SQL `GROUP BY` queries with date indexes. For Cloudflare DO (demo), implement equivalent aggregation using DO storage iteration with in-memory grouping. The analytics service must detect which path to use based on the platform abstraction layer.

### API

```
GET /api/analytics/calls?days=7     → CallVolumeResponse
GET /api/analytics/calls?days=30    → CallVolumeResponse
GET /api/analytics/hours?days=30    → HourDistributionResponse
GET /api/analytics/volunteers?days=30 → VolunteerStatsResponse  (admin: audit:read perm)
```

All endpoints require `calls:read-history` as the minimum permission. This permission is NOT held by the volunteer role, so volunteers are correctly excluded. `calls:answer` is held by volunteers and must NOT be used as the gate. The `volunteers` endpoint additionally requires `audit:read`.

### Client: chart library

**Option A: recharts** (recommended)
- ~45KB gzipped, React-native API, composable
- Good TypeScript support
- Widely used, stable

**Option B: @tremor/react**
- Pre-styled dashboard components, faster to implement
- Heavier bundle (~90KB), opinionated styling (harder to match shadcn/ui)

**Decision: recharts.** Lighter bundle, more control over styling to match existing UI.

> **Bundle note:** Use dynamic import (`React.lazy` / `import()`) to prevent bundling recharts into the main chunk. The analytics section is admin-only and loaded on demand, so it should be code-split accordingly.

### Component structure

```
src/client/components/dashboard/
  analytics-section.tsx        — collapsible wrapper, lazy-loads on expand
  call-volume-chart.tsx        — bar chart, period toggle (7d/30d)
  call-hours-chart.tsx         — horizontal bar chart, 24 hours
  volunteer-stats-table.tsx    — sortable table, admin-only
```

### Lazy loading

The analytics section renders a collapsed `<details>`-like component. On first expand:
- `useQuery` hooks fire for the selected period
- Loading skeletons shown while fetching
- Data cached by TanStack Query with 5-minute stale time

On subsequent opens: cached data shown immediately, background refetch if stale.

## CallVolumeChart Design

Bar chart with stacked/grouped bars per day:
- Green: answered calls
- Yellow: voicemail
- Red: unanswered (ringing with no answer)
- X-axis: dates (abbreviated: "Dec 21")
- Y-axis: count
- Period toggle: "7 days" / "30 days" buttons (pill style)
- Tooltip: "Dec 21: 12 calls (10 answered, 2 voicemail, 0 unanswered)"
- Empty state: "No calls in this period"

## CallHoursChart Design

Horizontal bar chart:
- Y-axis: hours 0–23 (labelled "12am", "1am" … "11pm")
- X-axis: call count
- Bars highlight business hours (9am–5pm) vs off-hours
- No period toggle — always 30 days (enough data for meaningful pattern)
- Useful for shift scheduling: "we get most calls 7–9pm, let's staff accordingly"

## VolunteerStatsTable Design

Simple table:
- Columns: Name (resolved client-side from pubkey via hub volunteer list), Calls Answered, Avg Duration
- Server returns `{ pubkey, callsAnswered, avgDuration }[]`; client maps pubkey → display name
- Sortable by Calls Answered (descending default)
- Truncate long names at 30 chars
- "Last 30 days" label
- Admin-only (hidden entirely from non-admins, not just greyed out)

## Dashboard Integration

```
[ Live Stats (existing) ]
────────────────────────
[ ▼ Analytics (last 7 days)  ]     ← collapsible, admin-only
  [ CallVolumeChart         ]
  [ CallHoursChart          ]
  [ VolunteerStatsTable     ]
```

Section is collapsed by default on first visit. State persisted in `localStorage` so admin's preference is remembered.

## Performance

- SQL queries run against indexed `(hub_id, created_at)` column
- For typical volumes (thousands of calls), aggregation queries complete in <50ms
- No caching needed server-side at this scale; TanStack Query handles client-side caching
- recharts bundle: ~45KB gzipped — acceptable given admin-only load

## Testing

- Analytics section is not rendered for volunteers
- Expanding section triggers analytics API calls
- Period toggle fetches new data
- Charts render without JS errors (E2E: check for no console errors)
- VolunteerStatsTable visible to admin, absent for volunteer
