// Augment Window with the authed fetch helper injected by test setup
declare global {
  interface Window {
    __authedFetch?: (url: string, options?: RequestInit) => Promise<Response>
  }
}

export * from './auth'
export * from './crypto'
export * from './db'
export * from './call-simulator'

// Re-export TestIds for convenience
export { TestIds } from '../test-ids'

// Re-export page object utilities
export * from '../pages/index'
