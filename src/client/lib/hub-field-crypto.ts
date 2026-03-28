/**
 * Hub Field Crypto Helpers
 *
 * Client-side decryption/encryption of hub-scoped organizational metadata
 * (hub names, role names, custom field labels, etc.).
 *
 * During the transition period, the server returns both plaintext and
 * encrypted fields. The client prefers the encrypted value when the
 * hub key is available (after PIN unlock), falling back to plaintext.
 */

import { getHubKeyForId } from './hub-key-cache'
import { decryptFromHub, encryptForHub } from './hub-key-manager'

/**
 * Decrypt a hub-encrypted field, falling back to plaintext.
 *
 * @param encrypted - Hex ciphertext from the server (encryptedName, etc.)
 * @param plaintext - Fallback plaintext value (name, etc.)
 * @param hubId - Hub ID to look up the hub key
 * @returns Decrypted string, or plaintext fallback, or empty string
 */
export function decryptHubField(
  encrypted: string | null | undefined,
  plaintext: string | null | undefined,
  hubId: string
): string {
  if (encrypted) {
    const hubKey = getHubKeyForId(hubId)
    if (hubKey) {
      const decrypted = decryptFromHub(encrypted, hubKey)
      if (decrypted) return decrypted
    }
  }
  return plaintext ?? ''
}

/**
 * Encrypt a value with the hub key for sending to the server.
 * Returns the ciphertext hex string, or undefined if the hub key is not available.
 */
export function encryptHubField(value: string, hubId: string): string | undefined {
  const hubKey = getHubKeyForId(hubId)
  if (!hubKey) return undefined
  return encryptForHub(value, hubKey)
}
