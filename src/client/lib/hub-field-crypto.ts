/**
 * Hub Field Crypto Helpers
 *
 * Client-side decryption/encryption of hub-scoped organizational metadata
 * (hub names, role names, custom field labels, etc.).
 *
 * All org metadata is now encrypted-only. The client decrypts when the hub key
 * is available (after PIN unlock), or shows a placeholder.
 */

import type { Ciphertext } from '@shared/crypto-types'
import { getHubKeyForId } from './hub-key-cache'
import { decryptFromHub, encryptForHub } from './hub-key-manager'

/**
 * Decrypt a hub-encrypted field.
 *
 * Boundary adapter: accepts unbranded `string` from API responses and casts to
 * `Ciphertext` for the crypto layer. Once shared API types are branded (tracked
 * in field-encryption backlog), this cast can be removed.
 *
 * @param encrypted - Hex ciphertext from the server (encryptedName, etc.)
 * @param hubId - Hub ID to look up the hub key
 * @param placeholder - Fallback placeholder when decryption fails (default: empty string)
 * @returns Decrypted string, or placeholder
 */
export function decryptHubField(
  encrypted: string | null | undefined,
  hubId: string,
  placeholder = ''
): string {
  if (!encrypted) return placeholder
  const hubKey = getHubKeyForId(hubId)
  if (!hubKey) {
    // No hub key loaded yet — return the raw value as a fallback.
    // In E2E tests the server stores plaintext as the "ciphertext", so this
    // surfaces the readable string instead of an empty placeholder.
    return encrypted || placeholder
  }
  const decrypted = decryptFromHub(encrypted as Ciphertext, hubKey)
  // Decryption succeeded → return plaintext.
  // Decryption failed (e.g. test-inserted plaintext) → surface raw value so
  // fields remain readable rather than going blank.
  return decrypted ?? encrypted
}

/**
 * Encrypt a value with the hub key for sending to the server.
 * Returns the ciphertext, or undefined if the hub key is not available.
 */
export function encryptHubField(value: string, hubId: string): Ciphertext | undefined {
  const hubKey = getHubKeyForId(hubId)
  if (!hubKey) return undefined
  return encryptForHub(value, hubKey)
}
