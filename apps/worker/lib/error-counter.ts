/**
 * In-memory error counters by category for observability.
 *
 * Categories cover the main failure domains:
 * - auth: authentication/authorization failures
 * - validation: input validation errors
 * - storage: DO storage or R2 errors
 * - telephony: Twilio/provider failures
 * - crypto: encryption/decryption errors
 * - alarm: DO alarm handler errors
 * - unknown: uncategorized errors
 *
 * Counters reset on process restart (stateless design for CF Workers).
 * Use getErrorSummary() for the metrics endpoint.
 */

export type ErrorCategory = 'auth' | 'validation' | 'storage' | 'telephony' | 'crypto' | 'alarm' | 'unknown'

const counters: Record<ErrorCategory, number> = {
  auth: 0,
  validation: 0,
  storage: 0,
  telephony: 0,
  crypto: 0,
  alarm: 0,
  unknown: 0,
}

let totalRequests = 0
const startTime = Date.now()

/** Increment an error counter for the given category */
export function incError(category: ErrorCategory): void {
  counters[category]++
}

/** Increment total request count */
export function incRequests(): void {
  totalRequests++
}

/** Get a snapshot of all error counters */
export function getErrorSummary(): {
  errors: Record<ErrorCategory, number>
  totalErrors: number
  totalRequests: number
  uptimeMs: number
} {
  const totalErrors = Object.values(counters).reduce((sum, n) => sum + n, 0)
  return {
    errors: { ...counters },
    totalErrors,
    totalRequests,
    uptimeMs: Date.now() - startTime,
  }
}

/** Reset all counters (for testing) */
export function resetErrorCounters(): void {
  for (const key of Object.keys(counters) as ErrorCategory[]) {
    counters[key] = 0
  }
  totalRequests = 0
}
