/**
 * Hub Field Crypto Helpers
 *
 * Client-side decryption/encryption of hub-scoped organizational metadata
 * (hub names, role names, custom field labels, etc.).
 *
 * All org metadata is now encrypted-only. The client decrypts when the hub key
 * is available (after PIN unlock), or shows a placeholder.
 */

import { getHubKeyForId } from './hub-key-cache'
import { decryptFromHub, encryptForHub } from './hub-key-manager'

/**
 * Decrypt a hub-encrypted field.
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
  if (encrypted) {
    const hubKey = getHubKeyForId(hubId)
    if (hubKey) {
      const decrypted = decryptFromHub(encrypted, hubKey)
      if (decrypted) return decrypted
    }
  }
  return placeholder
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
