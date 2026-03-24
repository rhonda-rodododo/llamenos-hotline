/**
 * Hub-event encryption for Nostr relay events.
 *
 * The hub key is client-side only (ECIES-wrapped per member); the server never
 * holds the raw hub key. For server-published events, we derive a symmetric
 * event encryption key from SERVER_NOSTR_SECRET so that relay content is
 * encrypted at rest. Clients receive this key via the hub key distribution
 * envelope (the admin wraps it alongside the hub key).
 *
 * Derivation:
 *   event_key = HKDF(SHA-256, SERVER_NOSTR_SECRET, salt=empty, info="llamenos:hub-event", 32)
 *   nonce = random(24)
 *   ciphertext = XChaCha20-Poly1305(event_key, nonce).encrypt(UTF-8(json))
 *   output = hex(nonce || ciphertext)
 *
 * Clients receive the server's event key via GET /api/auth/me (serverEventKeyHex).
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_HUB_EVENT } from '@shared/crypto-labels'

/**
 * Derive the server event encryption key from SERVER_NOSTR_SECRET.
 * Deterministic — same secret always produces the same key.
 */
export function deriveServerEventKey(serverSecret: string): Uint8Array {
  return hkdf(sha256, hexToBytes(serverSecret), new Uint8Array(0), utf8ToBytes(LABEL_HUB_EVENT), 32)
}

/**
 * Decrypt event content from Nostr relay.
 * Returns parsed object, or null on failure (wrong key, corrupted data).
 */
export function decryptHubEvent(
  packed: string,
  eventKey: Uint8Array
): Record<string, unknown> | null {
  try {
    const data = hexToBytes(packed)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(eventKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Encrypt event content for Nostr relay publication.
 * Returns hex-encoded nonce || ciphertext.
 */
export function encryptHubEvent(content: Record<string, unknown>, eventKey: Uint8Array): string {
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(eventKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify(content)))
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}
