import { QueryClient } from '@tanstack/react-query'
import * as keyManager from './key-manager'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

/**
 * Query keys that contain encrypted data and must be cleared on lock
 * and invalidated on unlock to force re-fetch with fresh decryption.
 */
export const ENCRYPTED_QUERY_KEYS = [
  'users',
  'contacts',
  'notes',
  'calls',
  'audit',
  'blasts',
  'reports',
  'conversations',
  'invites',
  'bans',
  'credentials',
] as const

// On lock: remove all encrypted queries so stale ciphertext is not
// served to an unauthenticated session.
keyManager.onLock(() => {
  for (const key of ENCRYPTED_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: [key] })
  }
})

// On unlock: invalidate encrypted queries so they are re-fetched and
// decrypted with the newly loaded key — but only if there's an active
// auth session. During bootstrap/onboarding the key unlocks before
// a JWT exists; firing queries without a token causes a 401 cascade.
keyManager.onUnlock(() => {
  // Dynamic import to avoid circular dependency
  import('./auth-facade-client').then(({ authFacadeClient }) => {
    if (!authFacadeClient.getAccessToken()) return
    for (const key of ENCRYPTED_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [key] })
    }
  })
})
