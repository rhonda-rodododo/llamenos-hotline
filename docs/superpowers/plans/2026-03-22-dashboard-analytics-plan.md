# Dashboard Analytics & Historical Call Charts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add historical call volume charts, message volume trends, and summary statistics to the admin dashboard. The dashboard currently shows live counts; this adds a 7-day / 30-day retrospective view.

**Current state:** Dashboard has: active call count, today's call volume, volunteer presence, shift status. Missing: charts, trends, historical breakdown.

---

## Phase 1: Analytics API

### 1.1 Define analytics query methods
- [ ] Add to `RecordsService` (or new `AnalyticsService`):
  ```typescript
  // Call volume per day for last N days
  getCallVolumeByDay(hubId: string, days: 7 | 30): Promise<Array<{ date: string, count: number, answered: number, voicemail: number }>>

  // Average call duration per day
  getAvgCallDurationByDay(hubId: string, days: 7 | 30): Promise<Array<{ date: string, avgSeconds: number }>>

  // Top call hours (0-23)
  getCallHourDistribution(hubId: string, days: 30): Promise<Array<{ hour: number, count: number }>>

  // Volunteer performance summary (admin only)
  getVolunteerCallStats(hubId: string, days: 30): Promise<Array<{ pubkey: string, name: string, callsAnswered: number, avgDuration: number }>>
  ```

### 1.2 Analytics API route
- [ ] Add to `src/server/routes/calls.ts` or new `src/server/routes/analytics.ts`:
  ```
  GET /api/analytics/calls?days=7|30    → CallVolumeResponse
  GET /api/analytics/hours?days=30       → HourDistributionResponse
  GET /api/analytics/volunteers?days=30  → VolunteerStatsResponse (admin only)
  ```
- [ ] Permission: `audit:read` for volunteer stats, `calls:read-history` for call analytics
- [ ] Zod schemas for all response types

### 1.3 Efficient SQL queries
- [ ] Call volume by day:
  ```sql
  SELECT DATE(created_at) as date, COUNT(*) as count,
    SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered,
    SUM(CASE WHEN status = 'voicemail' THEN 1 ELSE 0 END) as voicemail
  FROM calls
  WHERE hub_id = $1 AND created_at >= NOW() - INTERVAL '$2 days'
  GROUP BY DATE(created_at)
  ORDER BY date ASC
  ```
- [ ] Hour distribution query (for "peak hours" chart)
- [ ] Performance-tune with index on `(hub_id, created_at)` — verify Drizzle schema has this

---

## Phase 2: Chart Components

### 2.1 Choose chart library
- [ ] Add `recharts` dependency (lightweight, React-native, widely used):
  ```bash
  bun add recharts
  ```
- [ ] Alternative: `@tremor/react` for pre-built dashboard cards — evaluate based on bundle size
- [ ] Decision: use `recharts` (more control, lighter than Chart.js)

### 2.2 CallVolumeChart component
- [ ] Create `src/client/components/dashboard/call-volume-chart.tsx`:
  - Bar chart: answered calls (green) vs voicemail (yellow) vs unanswered (red)
  - X-axis: last 7 or 30 days (date labels)
  - Y-axis: call count
  - Period selector: "7 days" / "30 days" toggle
  - Loading skeleton state
  - Empty state: "No calls in this period"
  - Tooltip: `"Dec 21: 12 calls (10 answered, 2 voicemail)"`

### 2.3 CallHoursChart component
- [ ] Create `src/client/components/dashboard/call-hours-chart.tsx`:
  - Horizontal bar chart: 24 hours (0=midnight to 23=11pm)
  - Shows peak call times
  - Highlights "business hours" vs off-hours
  - Useful for shift scheduling decisions

### 2.4 VolunteerStatsTable component (admin only)
- [ ] Create `src/client/components/dashboard/volunteer-stats-table.tsx`:
  - Table: volunteer name, calls answered, avg duration
  - Sortable by calls answered
  - Only visible to admins with `audit:read`
  - Last 30 days by default

---

## Phase 3: Dashboard Integration

- [ ] Open `src/client/routes/index.tsx`
- [ ] Add "Analytics" collapsible section below the live stats (admin-only):
  - "Call Volume (last 7 days)" — CallVolumeChart
  - "Peak Hours" — CallHoursChart
  - "Team Performance" — VolunteerStatsTable
- [ ] Section is collapsed by default, expanded on click
- [ ] Analytics data fetched lazily (on section expand, not on page load)
- [ ] Add `GET /api/analytics/calls?days=7` call to `src/client/lib/api.ts`

---

## Phase 4: Client API Functions

- [ ] Add to `src/client/lib/api.ts`:
  ```typescript
  getCallAnalytics(days: 7 | 30): Promise<CallVolumeResponse>
  getCallHoursAnalytics(days: 30): Promise<HourDistributionResponse>
  getVolunteerStats(days: 30): Promise<VolunteerStatsResponse>
  ```

---

## Phase 5: i18n

- [ ] Add to all 13 locale files:
  - `dashboard.analytics.title`
  - `dashboard.analytics.callVolume`, `.callVolume7d`, `.callVolume30d`
  - `dashboard.analytics.peakHours`
  - `dashboard.analytics.teamPerformance`
  - `dashboard.analytics.answered`, `.voicemail`, `.unanswered`
  - `dashboard.analytics.noData`

---

## Phase 6: E2E Tests

- [ ] Add to `tests/admin-flow.spec.ts` or new `tests/dashboard-analytics.spec.ts`:
  - Analytics section hidden from volunteers
  - Analytics section visible to admins
  - Charts render (no JS errors)
  - Period toggle switches between 7 and 30 days
  - Data fetched only when section is expanded (lazy load)

---

## Completion Checklist

- [ ] `GET /api/analytics/calls` returns data grouped by day
- [ ] `recharts` bundle impact <50KB gzipped (spot check)
- [ ] CallVolumeChart renders in admin dashboard
- [ ] CallHoursChart renders
- [ ] VolunteerStatsTable shows data for admin
- [ ] Analytics section hidden for non-admins
- [ ] Lazy loading: analytics API not called until section expanded
- [ ] All i18n keys added to 13 locales
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] E2E tests pass
