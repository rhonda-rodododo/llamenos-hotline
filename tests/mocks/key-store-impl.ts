/**
 * Mock key-store PIN encryption/decryption for Tauri IPC mock.
 * Mirrors the PBKDF2 + XChaCha20-Poly1305 scheme from the original key-store.ts.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'

const PBKDF2_ITERATIONS = 600_000

async function deriveKEK(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const pinBytes = utf8ToBytes(pin)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    pinBytes.buffer as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    256,
  )
  return new Uint8Array(derived)
}

export async function storeEncryptedKey(
  nsec: string,
  pin: string,
  pubkey: string,
): Promise<{
  salt: string
  iterations: number
  nonce: string
  ciphertext: string
  pubkey: string
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const kek = await deriveKEK(pin, salt)
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const cipher = xchacha20poly1305(kek, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(nsec))

  const hashInput = utf8ToBytes(`llamenos:keyid:${pubkey}`)
  const hashBuf = await crypto.subtle.digest('SHA-256', hashInput.buffer as ArrayBuffer)
  const pubkeyHash = bytesToHex(new Uint8Array(hashBuf)).slice(0, 16)

  return {
    salt: bytesToHex(salt),
    iterations: PBKDF2_ITERATIONS,
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
    pubkey: pubkeyHash,
  }
}

export async function decryptWithPin(
  data: Record<string, unknown>,
  pin: string,
): Promise<string | null> {
  try {
    const salt = hexToBytes(data.salt as string)
    const nonce = hexToBytes(data.nonce as string)
    const ciphertext = hexToBytes(data.ciphertext as string)
    const kek = await deriveKEK(pin, salt)
    const cipher = xchacha20poly1305(kek, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}
