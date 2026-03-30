/**
 * React Query hooks for dashboard analytics.
 *
 * All analytics queries are lazy-loaded by default (enabled=false) so they
 * only fire when the analytics section is expanded. staleTime is 5 minutes.
 */

import {
  type CallHourBucket,
  type CallVolumeDay,
  type VolunteerStatEntry,
  getCallAnalytics,
  getCallHoursAnalytics,
  getVolunteerStats,
} from '@/lib/api'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { queryKeys } from './keys'

const STALE_5_MIN = 5 * 60_000

// ---------------------------------------------------------------------------
// callAnalyticsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch call volume data for the given number of days.
 * Pass enabled=false to defer loading (e.g. until analytics panel opens).
 */
export const callAnalyticsOptions = (days: 7 | 30 = 7, enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.callVolume(days),
    queryFn: async (): Promise<CallVolumeDay[]> => {
      const res = await getCallAnalytics(days)
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

// ---------------------------------------------------------------------------
// useCallAnalytics
// ---------------------------------------------------------------------------

export function useCallAnalytics(days: 7 | 30 = 7, enabled = true) {
  return useQuery(callAnalyticsOptions(days, enabled))
}

// ---------------------------------------------------------------------------
// callHoursAnalyticsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch peak-hours distribution data.
 * Pass enabled=false to defer loading.
 */
export const callHoursAnalyticsOptions = (enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.callHours(),
    queryFn: async (): Promise<CallHourBucket[]> => {
      const res = await getCallHoursAnalytics()
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

// ---------------------------------------------------------------------------
// useCallHoursAnalytics
// ---------------------------------------------------------------------------

export function useCallHoursAnalytics(enabled = true) {
  return useQuery(callHoursAnalyticsOptions(enabled))
}

// ---------------------------------------------------------------------------
// volunteerStatsAnalyticsOptions
// ---------------------------------------------------------------------------

/**
 * Fetch volunteer performance stats.
 * Pass enabled=false to defer loading.
 */
export const volunteerStatsAnalyticsOptions = (enabled = true) =>
  queryOptions({
    queryKey: queryKeys.analytics.volunteerStats(),
    queryFn: async (): Promise<VolunteerStatEntry[]> => {
      const res = await getVolunteerStats()
      return res.data
    },
    staleTime: STALE_5_MIN,
    enabled,
  })

// ---------------------------------------------------------------------------
// useVolunteerStatsAnalytics
// ---------------------------------------------------------------------------

export function useVolunteerStatsAnalytics(enabled = true) {
  return useQuery(volunteerStatsAnalyticsOptions(enabled))
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------
export type { CallHourBucket, CallVolumeDay, VolunteerStatEntry }
