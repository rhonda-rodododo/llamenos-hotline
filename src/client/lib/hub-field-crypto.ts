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
/**
 * A real ciphertext is an even-length hex string of at least 48 chars
 * (24-byte nonce + 16-byte poly1305 tag in hex). If the stored "encrypted"
 * value is NOT a valid ciphertext, it's plaintext (fallback path on the server
 * when the client has no hub key). Safe to surface to UI either way.
 */
function looksLikeCiphertext(s: string): boolean {
  return s.length >= 48 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s)
}

export function decryptHubField(
  encrypted: string | null | undefined,
  hubId: string,
  placeholder = ''
): string {
  if (!encrypted) return placeholder
  const hubKey = getHubKeyForId(hubId)
  if (!hubKey) {
    // If the stored value looks like real ciphertext, we can't decrypt it without
    // the key — show placeholder rather than leaking hex to the UI. If it's not
    // ciphertext (plaintext server-fallback path), surface the readable value.
    return looksLikeCiphertext(encrypted) ? placeholder : encrypted
  }
  const decrypted = decryptFromHub(encrypted as Ciphertext, hubKey)
  // Decryption succeeded → return plaintext.
  // Decryption failed on a ciphertext-looking value → placeholder (don't leak hex).
  // Decryption failed on a plaintext value → surface it (test/plaintext fallback).
  return decrypted ?? (looksLikeCiphertext(encrypted) ? placeholder : encrypted)
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
