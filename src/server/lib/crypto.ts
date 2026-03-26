import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  HMAC_IP_PREFIX,
  HMAC_PHONE_PREFIX,
  LABEL_CALL_META,
  LABEL_HUB_KEY_WRAP,
  LABEL_MESSAGE,
  LABEL_PROVIDER_CREDENTIAL_WRAP,
  LABEL_SERVER_NOSTR_KEY,
  LABEL_SERVER_NOSTR_KEY_INFO,
} from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import type { MessageKeyEnvelope } from '../types'

/**
 * Hash a phone number for storage (one-way — compare by re-hashing).
 * Uses HMAC-SHA256 with a server secret to prevent precomputation attacks.
 */
export function hashPhone(phone: string, secret: string): string {
  const key = hexToBytes(secret)
  const input = utf8ToBytes(`${HMAC_PHONE_PREFIX}${phone}`)
  return bytesToHex(hmac(sha256, key, input))
}

/**
 * Hash an IP address for storage in audit logs.
 * Uses HMAC-SHA256 with a server secret, truncated to 96 bits.
 */
export function hashIP(ip: string, secret: string): string {
  const key = hexToBytes(secret)
  const input = utf8ToBytes(`${HMAC_IP_PREFIX}${ip}`)
  return bytesToHex(hmac(sha256, key, input)).slice(0, 24)
}

// --- Envelope-Pattern Message Encryption (Epic 74) ---

/**
 * ECIES key wrapping for a single recipient (server-side).
 * Mirrors the client-side eciesWrapKey from src/client/lib/crypto.ts.
 */
function eciesWrapKeyServer(
  key: Uint8Array,
  recipientPubkeyHex: string,
  label: string
): { wrappedKey: string; ephemeralPubkey: string } {
  const ephemeralSecret = new Uint8Array(32)
  crypto.getRandomValues(ephemeralSecret)
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)

  const recipientCompressed = hexToBytes(`02${recipientPubkeyHex}`)
  const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const ciphertext = cipher.encrypt(key)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    wrappedKey: bytesToHex(packed),
    ephemeralPubkey: bytesToHex(ephemeralPublicKey),
  }
}

/**
 * Encrypt a message for storage using the envelope pattern.
 * Generates a random per-message symmetric key, encrypts the plaintext,
 * then wraps the key for each reader via ECIES.
 *
 * Used server-side when inbound messages arrive via webhooks.
 * The plaintext is discarded after encryption — the server cannot read
 * stored messages after this function returns.
 *
 * @param plaintext - Message text (from SMS/WhatsApp/Signal webhook)
 * @param readerPubkeys - Pubkeys of authorized readers (assigned volunteer + admins)
 */
export function encryptMessageForStorage(
  plaintext: string,
  readerPubkeys: string[],
  label: string = LABEL_MESSAGE
): { encryptedContent: string; readerEnvelopes: MessageKeyEnvelope[] } {
  // Generate random per-message symmetric key
  const messageKey = new Uint8Array(32)
  crypto.getRandomValues(messageKey)

  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(messageKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encryptedContent: bytesToHex(packed),
    readerEnvelopes: readerPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKeyServer(messageKey, pk, label),
    })),
  }
  // messageKey goes out of scope — never stored
}

/**
 * Encrypt call record metadata for history storage (Epic 77).
 * Uses the same envelope pattern as messages: random per-record key
 * wrapped via ECIES for each admin pubkey.
 *
 * @param metadata - JSON-serializable call metadata (answeredBy, callerNumber, etc.)
 * @param adminPubkeys - Admin decryption pubkeys
 */
export function encryptCallRecordForStorage(
  metadata: Record<string, unknown>,
  adminPubkeys: string[]
): { encryptedContent: string; adminEnvelopes: MessageKeyEnvelope[] } {
  const recordKey = new Uint8Array(32)
  crypto.getRandomValues(recordKey)

  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(recordKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify(metadata)))

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encryptedContent: bytesToHex(packed),
    adminEnvelopes: adminPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKeyServer(recordKey, pk, LABEL_CALL_META),
    })),
  }
}

// ── Binary Encryption (Voicemail Audio) ──

/**
 * ECIES key unwrapping for a single recipient (server-side).
 * Inverse of eciesWrapKeyServer: recovers the symmetric key from an envelope.
 */
export function eciesUnwrapKeyServer(
  envelope: { wrappedKey: string; ephemeralPubkey: string },
  privateKey: Uint8Array,
  label: string
): Uint8Array {
  const ephemeralPub = hexToBytes(envelope.ephemeralPubkey)
  const shared = secp256k1.getSharedSecret(privateKey, ephemeralPub)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const packed = hexToBytes(envelope.wrappedKey)
  const nonce = packed.slice(0, 24)
  const ciphertext = packed.slice(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  return cipher.decrypt(ciphertext)
}

/**
 * Encrypt binary data for storage using the envelope pattern.
 * Generates a random per-item symmetric key, encrypts the plaintext binary,
 * then wraps the key for each reader via ECIES.
 *
 * Used for voicemail audio and other binary blobs that need E2EE at rest.
 * The plaintext is discarded after encryption.
 *
 * @param plaintext - Binary data to encrypt
 * @param readerPubkeys - x-only pubkeys of authorized readers (hex)
 * @param label - Domain separation label (e.g. LABEL_VOICEMAIL_WRAP)
 */
export function encryptBinaryForStorage(
  plaintext: Uint8Array,
  readerPubkeys: string[],
  label: string
): { encryptedContent: string; readerEnvelopes: RecipientEnvelope[] } {
  const dataKey = new Uint8Array(32)
  crypto.getRandomValues(dataKey)

  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(dataKey, nonce)
  const ciphertext = cipher.encrypt(plaintext)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encryptedContent: bytesToHex(packed),
    readerEnvelopes: readerPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKeyServer(dataKey, pk, label),
    })),
  }
  // dataKey goes out of scope — never stored
}

/**
 * Decrypt binary data from storage using the envelope pattern.
 * Unwraps the symmetric key from the recipient's envelope, then decrypts.
 *
 * @param encryptedContentHex - Hex-encoded nonce(24) || ciphertext
 * @param envelope - The recipient's ECIES envelope
 * @param privateKey - Recipient's secp256k1 private key
 * @param label - Domain separation label (must match encryption)
 */
export function decryptBinaryFromStorage(
  encryptedContentHex: string,
  envelope: { wrappedKey: string; ephemeralPubkey: string },
  privateKey: Uint8Array,
  label: string
): Uint8Array {
  const dataKey = eciesUnwrapKeyServer(envelope, privateKey, label)

  const packed = hexToBytes(encryptedContentHex)
  const nonce = packed.slice(0, 24)
  const ciphertext = packed.slice(24)
  const cipher = xchacha20poly1305(dataKey, nonce)
  return cipher.decrypt(ciphertext)
}

// ── Hub Key Encryption ──

/**
 * Encrypt arbitrary data with a hub key using XChaCha20-Poly1305.
 * Returns hex: nonce(24) + ciphertext.
 * Server-side mirror of client-side hub-key-manager.ts function.
 */
export function encryptForHub(plaintext: string, hubKey: Uint8Array): string {
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const cipher = xchacha20poly1305(hubKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}

/**
 * Decrypt hub-encrypted data using the hub key.
 * Returns null on decryption failure.
 */
export function decryptFromHub(packed: string, hubKey: Uint8Array): string | null {
  try {
    const data = hexToBytes(packed)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(hubKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

/**
 * Unwrap the hub key for server-side use (blast delivery, etc.).
 * Derives the server's Nostr keypair from SERVER_NOSTR_SECRET via HKDF,
 * finds the server's hub key envelope, and ECIES-unwraps the hub key.
 *
 * IMPORTANT: The HKDF derivation must exactly match nostr-publisher.ts.
 */
export function unwrapHubKeyForServer(
  serverSecret: string,
  envelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
): Uint8Array {
  const secretBytes = hexToBytes(serverSecret)
  const serverPrivateKey = hkdf(
    sha256,
    secretBytes,
    utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
    utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
    32
  )
  const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

  const envelope = envelopes.find((e) => e.pubkey === serverPubkey)
  if (!envelope) {
    throw new Error(`No hub key envelope for server pubkey ${serverPubkey}`)
  }

  return eciesUnwrapKeyServer(envelope, serverPrivateKey, LABEL_HUB_KEY_WRAP)
}

// ── Provider Credential Encryption ──

function deriveProviderKey(serverSecret: string): Uint8Array {
  return hkdf(
    sha256,
    hexToBytes(serverSecret),
    new Uint8Array(0),
    utf8ToBytes(LABEL_PROVIDER_CREDENTIAL_WRAP),
    32
  )
}

export function encryptProviderCredentials(plaintext: string, serverSecret: string): string {
  const key = deriveProviderKey(serverSecret)
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))
  const packed = new Uint8Array(24 + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, 24)
  return bytesToHex(packed)
}

export function decryptProviderCredentials(encrypted: string, serverSecret: string): string {
  const bytes = hexToBytes(encrypted)
  const nonce = bytes.slice(0, 24)
  const ciphertext = bytes.slice(24)
  const key = deriveProviderKey(serverSecret)
  const cipher = xchacha20poly1305(key, nonce)
  return new TextDecoder().decode(cipher.decrypt(ciphertext))
}

/**
 * Compute SHA-256 hash of an audit entry's core content for chain linking.
 */
export function hashAuditEntry(entry: {
  id: string
  event: string
  actorPubkey: string
  details: Record<string, unknown>
  createdAt: string
  previousEntryHash?: string
}): string {
  const content = `${entry.id}:${entry.event}:${entry.actorPubkey}:${entry.createdAt}:${JSON.stringify(entry.details)}:${entry.previousEntryHash || ''}`
  return bytesToHex(sha256(utf8ToBytes(content)))
}
