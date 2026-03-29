/**
 * WebAuthn client-side helpers for passkey registration, login, and credential management.
 * Uses @simplewebauthn/browser for browser API interaction.
 * Auth is handled via the auth facade client (JWT access tokens).
 */

import { LABEL_KEK_PRF } from '@shared/crypto-labels'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { type WebAuthnCredentialInfo, authFacadeClient } from './auth-facade-client'

// Re-export for consumers that import WebAuthnCredentialInfo from this module
export type { WebAuthnCredentialInfo } from './auth-facade-client'

/**
 * Check if WebAuthn is supported in this browser.
 */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  )
}

/**
 * Request WebAuthn PRF evaluation for KEK derivation.
 * Returns the PRF output (32 bytes) or null if PRF is not supported.
 */
export async function requestWebAuthnPRF(): Promise<Uint8Array | null> {
  if (!isWebAuthnAvailable()) return null

  try {
    const saltBytes = new TextEncoder().encode(LABEL_KEK_PRF)
    const salt: ArrayBuffer = saltBytes.buffer.slice(
      saltBytes.byteOffset,
      saltBytes.byteOffset + saltBytes.byteLength
    ) as ArrayBuffer
    const challengeBytes = new Uint8Array(32)
    crypto.getRandomValues(challengeBytes)
    const challenge: ArrayBuffer = challengeBytes.buffer.slice(0) as ArrayBuffer
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        extensions: {
          prf: { eval: { first: salt } },
        },
      },
    })) as PublicKeyCredential

    const results = credential.getClientExtensionResults() as Record<string, unknown>
    const prf = results.prf as { results?: { first?: ArrayBuffer } } | undefined
    if (!prf?.results?.first) return null

    return new Uint8Array(prf.results.first)
  } catch {
    return null
  }
}

/**
 * Register a new WebAuthn credential (passkey).
 * Requires existing auth (access token via auth facade client).
 */
export async function registerCredential(label: string): Promise<void> {
  // 1. Get registration options from server (authenticated)
  const optionsResponse = await authFacadeClient.getRegisterOptions()
  const { challengeId, ...optionsJSON } = optionsResponse

  // 2. Create credential via browser WebAuthn API
  const attestation = await startRegistration({ optionsJSON })

  // 3. Verify with server
  await authFacadeClient.verifyRegistration(attestation, label, challengeId)
}

/**
 * Login with a passkey. Returns access token + pubkey.
 * No auth required — uses discoverable credentials.
 */
export async function loginWithPasskey(): Promise<{ token: string; pubkey: string }> {
  // 1. Get authentication options from server (no auth needed)
  const optionsResponse = await authFacadeClient.getLoginOptions()
  const { challengeId, ...optionsJSON } = optionsResponse

  // 2. Authenticate via browser WebAuthn API
  const assertion = await startAuthentication({ optionsJSON })

  // 3. Verify with server — returns access token
  const { accessToken, pubkey } = await authFacadeClient.verifyLogin(assertion, challengeId)

  return { token: accessToken, pubkey }
}

/**
 * List registered credentials for the current user.
 */
export async function listCredentials(): Promise<WebAuthnCredentialInfo[]> {
  const { devices } = await authFacadeClient.listDevices()
  return devices
}

/**
 * Delete a registered credential.
 */
export async function deleteCredential(id: string): Promise<void> {
  await authFacadeClient.deleteDevice(id)
}
