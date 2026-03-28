import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

/**
 * Symmetric encryption using XChaCha20-Poly1305.
 * Returns hex-encoded: nonce(24 bytes) || ciphertext.
 */
export function symmetricEncrypt(plaintext: Uint8Array, key: Uint8Array): string {
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(plaintext)
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}

/**
 * Symmetric decryption using XChaCha20-Poly1305.
 * Input: hex-encoded nonce(24) || ciphertext.
 */
export function symmetricDecrypt(packed: string, key: Uint8Array): Uint8Array {
  const data = hexToBytes(packed)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(key, nonce)
  return cipher.decrypt(ciphertext)
}

/**
 * ECIES key wrapping for a single recipient.
 * Generates ephemeral secp256k1 keypair, derives shared secret via ECDH,
 * derives symmetric key via SHA-256(label || sharedX), wraps with XChaCha20-Poly1305.
 */
export function eciesWrapKey(
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
 * ECIES key unwrapping. Recovers the symmetric key from an ECIES envelope.
 */
export function eciesUnwrapKey(
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
 * HMAC-SHA256. Returns raw bytes (caller converts to hex as needed).
 */
export function hmacSha256(key: Uint8Array, input: Uint8Array): Uint8Array {
  return hmac(sha256, key, input)
}

/**
 * HKDF-SHA256 key derivation.
 */
export function hkdfDerive(
  secret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  return hkdf(sha256, secret, salt, info, length)
}
