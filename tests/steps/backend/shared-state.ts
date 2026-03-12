/**
 * Shared mutable state for backend BDD step definitions.
 *
 * All step files that need to share state (e.g., last API response)
 * import and mutate this module's exports. The Before hook in each
 * step file resets relevant parts before each scenario.
 */

export interface SharedResponseState {
  lastResponse?: { status: number; data: unknown }
}

/** Global response state — written by When steps, read by Then steps. */
export const shared: SharedResponseState = {}

/** Reset shared state. Call from Before hooks. */
export function resetSharedState(): void {
  shared.lastResponse = undefined
}
