import { ConsentGate } from '@/components/consent-gate'
import { decryptObjectFields } from '@/lib/decrypt-fields'
import { permissionGranted } from '@shared/permissions'
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  logout as apiLogout,
  getMe,
  setOnApiActivity,
  setOnAuthExpired,
  updateMyAvailability,
} from './api'
import { authFacadeClient } from './auth-facade-client'
import { clearHubKeyCache, loadHubKeysForUser } from './hub-key-cache'
import * as keyManager from './key-manager'
import { loginWithPasskey as webauthnLogin } from './webauthn'

interface AuthState {
  isKeyUnlocked: boolean
  publicKey: string | null
  roles: string[]
  hubRoles: { hubId: string; roleIds: string[] }[]
  permissions: string[]
  primaryRoleName: string | null
  name: string | null
  isLoading: boolean
  error: string | null
  transcriptionEnabled: boolean
  spokenLanguages: string[]
  uiLanguage: string
  profileCompleted: boolean
  onBreak: boolean
  callPreference: 'phone' | 'browser' | 'both'
  sessionExpiring: boolean
  sessionExpired: boolean
  adminPubkey: string
  adminDecryptionPubkey: string
}

interface AuthContextValue extends AuthState {
  signIn: (nsec: string) => Promise<void>
  signInWithPasskey: () => Promise<void>
  signOut: () => void
  refreshProfile: () => Promise<void>
  toggleBreak: () => Promise<void>
  renewSession: () => Promise<void>
  unlockWithPin: (pin: string) => Promise<boolean>
  lockKey: () => void
  hasPermission: (permission: string) => boolean
  isAdmin: boolean
  isAuthenticated: boolean
  hasNsec: boolean
  adminPubkey: string
  adminDecryptionPubkey: string
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Helper to build a full AuthState from a /auth/me response */
function stateFromMe(
  me: Awaited<ReturnType<typeof getMe>>,
  overrides: Partial<AuthState> = {}
): AuthState {
  return {
    isKeyUnlocked: false,
    publicKey: me.pubkey,
    roles: me.roles || [],
    hubRoles: me.hubRoles ?? [],
    permissions: me.permissions || [],
    primaryRoleName: me.primaryRole?.name || null,
    name: me.name,
    isLoading: false,
    error: null,
    transcriptionEnabled: me.transcriptionEnabled,
    spokenLanguages: me.spokenLanguages || ['en'],
    uiLanguage: me.uiLanguage || 'en',
    profileCompleted: me.profileCompleted ?? true,
    onBreak: me.onBreak ?? false,
    callPreference: me.callPreference ?? 'phone',
    adminPubkey: me.adminDecryptionPubkey || '',
    adminDecryptionPubkey: me.adminDecryptionPubkey || '',
    sessionExpiring: false,
    sessionExpired: false,
    ...overrides,
  }
}

/** Interval for silent JWT refresh (10 minutes) */
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isKeyUnlocked: false,
    publicKey: null,
    roles: [],
    hubRoles: [],
    permissions: [],
    primaryRoleName: null,
    name: null,
    isLoading: true,
    error: null,
    transcriptionEnabled: true,
    spokenLanguages: ['en'],
    uiLanguage: 'en',
    profileCompleted: true,
    onBreak: false,
    callPreference: 'phone',
    sessionExpiring: false,
    sessionExpired: false,
    adminPubkey: '',
    adminDecryptionPubkey: '',
  })

  const lastApiActivity = useRef(Date.now())

  // Track API activity — called after each successful request
  const markActivity = useCallback(() => {
    lastApiActivity.current = Date.now()
    setState((s) => (s.sessionExpiring ? { ...s, sessionExpiring: false } : s))
  }, [])

  // Listen for key manager lock/unlock events
  useEffect(() => {
    const unsubLock = keyManager.onLock(() => {
      setState((s) => ({ ...s, isKeyUnlocked: false }))
    })
    const unsubUnlock = keyManager.onUnlock(() => {
      // getPublicKeyHex is async now — update state when it resolves
      void keyManager.getPublicKeyHex().then((pubkey) => {
        setState((s) => ({
          ...s,
          isKeyUnlocked: true,
          publicKey: pubkey ?? s.publicKey,
        }))
      })
    })
    return () => {
      unsubLock()
      unsubUnlock()
    }
  }, [])

  // Register auth expiry callback — called by api.ts when a 401 is received
  useEffect(() => {
    setOnAuthExpired(() => {
      setState((s) => ({
        ...s,
        sessionExpired: true,
        sessionExpiring: false,
        ...(s.isKeyUnlocked
          ? {}
          : { roles: [], permissions: [], primaryRoleName: null, name: null }),
      }))
    })
    return () => setOnAuthExpired(null)
  }, [])

  // Register API activity callback
  useEffect(() => {
    setOnApiActivity(markActivity)
    return () => setOnApiActivity(null)
  }, [markActivity])

  // Session expiry warning — check every 60s if idle > 30 min.
  useEffect(() => {
    const hasToken = !!authFacadeClient.getAccessToken()
    if (!state.isKeyUnlocked && !hasToken) return
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastApiActivity.current
      const WARN_THRESHOLD = 30 * 60 * 1000 // 30 minutes
      if (elapsed >= WARN_THRESHOLD && !state.sessionExpired) {
        setState((s) => ({ ...s, sessionExpiring: true }))
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [state.isKeyUnlocked, state.sessionExpired])

  // Restore session on mount — try JWT refresh (httpOnly cookie)
  useEffect(() => {
    let cancelled = false
    async function restoreSession() {
      try {
        // Attempt silent token refresh using the httpOnly refresh cookie
        await authFacadeClient.refreshToken()
        if (cancelled) return

        const me = await getMe()
        if (cancelled) return

        lastApiActivity.current = Date.now()
        const isUnlocked = await keyManager.isUnlocked()
        const pubkey = isUnlocked ? await keyManager.getPublicKeyHex() : null
        if (cancelled) return

        // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
        if (pubkey) {
          await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
        }

        setState(
          stateFromMe(me, {
            isKeyUnlocked: isUnlocked,
            publicKey: pubkey ?? me.pubkey,
          })
        )
      } catch {
        // No valid refresh cookie — user needs to log in
        if (!cancelled) {
          setState((s) => ({ ...s, isLoading: false }))
        }
      }
    }
    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  // Silent JWT refresh on interval (10 minutes)
  useEffect(() => {
    const hasToken = !!authFacadeClient.getAccessToken()
    if (!hasToken) return

    const interval = setInterval(() => {
      void authFacadeClient.refreshToken().catch(() => {
        // Refresh failed — token will expire, 401 handler will catch it
      })
    }, TOKEN_REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [state.publicKey]) // re-establish when auth state changes

  // Sign in with nsec (admin bootstrap / recovery only)
  // NOTE: This flow is kept for admin bootstrap. It does NOT use the facade
  // because nsec import is a local-only operation (encrypt + store + worker load).
  // Sign in after key import + JWT acquisition (used by demo mode and admin bootstrap).
  // Assumes: (1) crypto worker already holds the nsec (via importKey), (2) authFacadeClient
  // already has a valid access token. Just fetches the profile and sets auth state.
  const signIn = useCallback(async (_nsec: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }))
    try {
      const isUnlocked = await keyManager.isUnlocked()
      const pubkey = isUnlocked ? await keyManager.getPublicKeyHex() : null
      if (!isUnlocked || !pubkey) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: 'Key not loaded. Use the full onboarding flow.',
        }))
        return
      }
      const me = await getMe()
      lastApiActivity.current = Date.now()
      await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      const hubIds = (me.hubRoles ?? []).map((hr) => hr.hubId)
      await loadHubKeysForUser(hubIds)
      // Hub-key-dependent queries are invalidated via keyManager.onUnlock in query-client.ts
      setState(
        stateFromMe(me, {
          isKeyUnlocked: true,
          publicKey: pubkey,
        })
      )
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Sign-in failed',
      }))
    }
  }, [])

  // Unlock with PIN (primary day-to-day auth after passkey session)
  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const pubkey = await keyManager.unlock(pin)
    if (!pubkey) return false

    try {
      const me = await getMe()
      lastApiActivity.current = Date.now()
      // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
      await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      // Load hub keys after unlocking (crypto worker handles decryption internally)
      const hubIds = (me.hubRoles ?? []).map((hr) => hr.hubId)
      await loadHubKeysForUser(hubIds)
      // Hub-key-dependent queries are invalidated via keyManager.onUnlock in query-client.ts
      setState(
        stateFromMe(me, {
          isKeyUnlocked: true,
          publicKey: pubkey,
        })
      )
      return true
    } catch {
      await keyManager.lock()
      return false
    }
  }, [])

  const lockKey = useCallback(() => {
    void keyManager.lock()
  }, [])

  const signInWithPasskey = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }))
    try {
      const { pubkey } = await webauthnLogin()
      // The facade client already holds the JWT access token from verifyLogin.
      // The httpOnly refresh cookie is also set by the server response.
      const me = await getMe()
      lastApiActivity.current = Date.now()
      const isUnlocked = await keyManager.isUnlocked()
      // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
      if (isUnlocked) {
        await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      }
      setState(
        stateFromMe(me, {
          isKeyUnlocked: isUnlocked,
          publicKey: pubkey,
        })
      )
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Passkey login failed',
      }))
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    try {
      const me = await getMe()
      lastApiActivity.current = Date.now()
      // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey) {
        await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      }
      setState((s) => ({
        ...s,
        name: me.name,
        roles: me.roles || [],
        permissions: me.permissions || [],
        primaryRoleName: me.primaryRole?.name || null,
        publicKey: me.pubkey,
        transcriptionEnabled: me.transcriptionEnabled,
        spokenLanguages: me.spokenLanguages || ['en'],
        uiLanguage: me.uiLanguage || 'en',
        profileCompleted: me.profileCompleted ?? true,
        onBreak: me.onBreak ?? false,
        callPreference: me.callPreference ?? 'phone',
        adminPubkey: me.adminDecryptionPubkey || '',
        adminDecryptionPubkey: me.adminDecryptionPubkey || '',
        sessionExpiring: false,
        sessionExpired: false,
      }))
    } catch {
      // ignore — if the refresh fails the user stays on the current page
    }
  }, [])

  const renewSession = useCallback(async () => {
    try {
      // Use facade to refresh the JWT, then fetch fresh profile
      await authFacadeClient.refreshToken()
      const me = await getMe()
      lastApiActivity.current = Date.now()
      // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey) {
        await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
      }
      setState((s) => ({
        ...s,
        name: me.name,
        roles: me.roles || [],
        permissions: me.permissions || [],
        primaryRoleName: me.primaryRole?.name || null,
        publicKey: me.pubkey,
        transcriptionEnabled: me.transcriptionEnabled,
        spokenLanguages: me.spokenLanguages || ['en'],
        uiLanguage: me.uiLanguage || 'en',
        profileCompleted: me.profileCompleted ?? true,
        onBreak: me.onBreak ?? false,
        callPreference: me.callPreference ?? 'phone',
        adminPubkey: me.adminDecryptionPubkey || '',
        adminDecryptionPubkey: me.adminDecryptionPubkey || '',
        sessionExpiring: false,
        sessionExpired: false,
      }))
    } catch {
      // Renewal failed — session truly expired
      setState((s) => ({ ...s, sessionExpired: true, sessionExpiring: false }))
    }
  }, [])

  const toggleBreak = useCallback(async () => {
    const newValue = !state.onBreak
    try {
      await updateMyAvailability(newValue)
      setState((s) => ({ ...s, onBreak: newValue }))
    } catch {
      // ignore — toast handled by caller
      throw new Error('Failed to update availability')
    }
  }, [state.onBreak])

  const signOut = useCallback(() => {
    // Revoke server-side session via facade (clears httpOnly cookie + server session)
    void authFacadeClient.revokeSession().catch(() => {
      // Best-effort — clear local state regardless
    })
    // Also call the old API logout endpoint for backward compatibility during migration
    void apiLogout()
    void keyManager.lock()
    clearHubKeyCache()
    // Clean up encrypted drafts from localStorage
    const draftKeys = Object.keys(localStorage).filter((k) => k.startsWith('llamenos-draft:'))
    for (const k of draftKeys) localStorage.removeItem(k)
    setState({
      isKeyUnlocked: false,
      publicKey: null,
      roles: [],
      hubRoles: [],
      permissions: [],
      primaryRoleName: null,
      name: null,
      isLoading: false,
      error: null,
      transcriptionEnabled: true,
      spokenLanguages: ['en'],
      uiLanguage: 'en',
      profileCompleted: true,
      onBreak: false,
      callPreference: 'phone',
      adminPubkey: '',
      adminDecryptionPubkey: '',
      sessionExpiring: false,
      sessionExpired: false,
    })
  }, [])

  const hasAccessToken = typeof window !== 'undefined' && !!authFacadeClient.getAccessToken()

  const value: AuthContextValue = {
    ...state,
    signIn,
    signInWithPasskey,
    signOut,
    refreshProfile,
    toggleBreak,
    renewSession,
    unlockWithPin,
    lockKey,
    hasPermission: (permission: string) => permissionGranted(state.permissions, permission),
    isAdmin: permissionGranted(state.permissions, 'settings:manage'),
    isAuthenticated: (state.isKeyUnlocked || hasAccessToken) && state.roles.length > 0,
    hasNsec: state.isKeyUnlocked,
  }

  return (
    <AuthContext.Provider value={value}>
      <ConsentGate isKeyUnlocked={state.isKeyUnlocked}>{children}</ConsentGate>
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
