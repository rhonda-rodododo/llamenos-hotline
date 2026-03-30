// --- IdP user and secret types ---

export interface IdPUser {
  /** Nostr public key (hex) — the user's identity */
  pubkey: string
  /** Whether the user exists and is active in the IdP */
  active: boolean
  /** IdP-internal user ID (opaque, adapter-specific) */
  externalId: string
}

export interface NsecSecretRotation {
  current: Uint8Array
  previous?: Uint8Array
}

export interface InviteOpts {
  /** Nostr pubkey of the admin creating the invite */
  createdBy: string
  /** Optional: pre-assigned roles for the invitee */
  roles?: string[]
  /** Expiry duration in milliseconds (default: 7 days) */
  expiresInMs?: number
}

/**
 * IdPAdapter — abstract interface for identity provider integrations.
 * All IdP logic goes through this adapter.
 * Authentik is the first implementation; designed for future provider swaps.
 */
export interface IdPAdapter {
  /** Initialize the adapter (called once at server startup) */
  initialize(): Promise<void>

  // --- User lifecycle ---

  /** Create a new user in the IdP, keyed by Nostr pubkey */
  createUser(pubkey: string): Promise<IdPUser>

  /** Look up a user by Nostr pubkey; returns null if not found */
  getUser(pubkey: string): Promise<IdPUser | null>

  /** Permanently delete a user from the IdP */
  deleteUser(pubkey: string): Promise<void>

  // --- Nsec encryption secret (the idp_value) ---

  /**
   * Retrieve the per-user secret used as one factor in KEK derivation.
   * Requires a valid IdP session for the user (verified via adapter's
   * service account credentials, not the user's OIDC tokens).
   */
  getNsecSecret(pubkey: string): Promise<Uint8Array>

  /**
   * Generate a new nsec secret, retaining the old one for migration.
   * Returns both current (new) and previous (old) values.
   * Call confirmRotation() after the client re-encrypts.
   */
  rotateNsecSecret(pubkey: string): Promise<NsecSecretRotation>

  /** Discard the previous nsec secret after client confirms re-encryption */
  confirmRotation(pubkey: string): Promise<void>

  // --- Session management ---

  /** Check if the user's IdP session is still valid */
  refreshSession(pubkey: string): Promise<{ valid: boolean }>

  /** Revoke a single user's IdP session */
  revokeSession(pubkey: string): Promise<void>

  /** Revoke all sessions for a user (e.g., on departure or compromise) */
  revokeAllSessions(pubkey: string): Promise<void>

  // --- Invite / enrollment ---

  /**
   * Create a single-use invite link for a new user.
   * Returns the full invite URL to be shared out-of-band.
   */
  createInviteLink(opts: InviteOpts): Promise<string>
}
