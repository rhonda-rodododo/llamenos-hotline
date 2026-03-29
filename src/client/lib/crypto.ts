import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  HKDF_CONTEXT_DRAFTS,
  HKDF_CONTEXT_EXPORT,
  HKDF_CONTEXT_NOTES,
  HKDF_SALT,
  LABEL_BLAST_CONTENT,
  LABEL_CALL_META,
  LABEL_MESSAGE,
  LABEL_NOTE_KEY,
  LABEL_TRANSCRIPTION,
} from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import type { BlastContent, NotePayload } from '@shared/types'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { getCryptoWorker } from './crypto-worker-client'

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

// --- Key Management ---

export interface KeyPair {
  secretKey: Uint8Array // 32-byte private key
  publicKey: string // hex-encoded public key
  nsec: string // bech32-encoded private key (for user display)
  npub: string // bech32-encoded public key (for user display)
}

export function generateKeyPair(): KeyPair {
  const secretKey = generateSecretKey()
  const publicKey = getPublicKey(secretKey)
  return {
    secretKey,
    publicKey,
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(publicKey),
  }
}

export function keyPairFromNsec(nsec: string): KeyPair | null {
  try {
    const decoded = nip19.decode(nsec)
    if (decoded.type !== 'nsec') return null
    const secretKey = decoded.data
    const publicKey = getPublicKey(secretKey)
    return {
      secretKey,
      publicKey,
      nsec,
      npub: nip19.npubEncode(publicKey),
    }
  } catch {
    return null
  }
}

export function isValidNsec(nsec: string): boolean {
  try {
    const decoded = nip19.decode(nsec)
    return decoded.type === 'nsec'
  } catch {
    return false
  }
}

// --- Encryption ---

function deriveEncryptionKey(secretKey: Uint8Array, label: string): Uint8Array {
  const salt = utf8ToBytes(HKDF_SALT)
  return hkdf(sha256, secretKey, salt, utf8ToBytes(label), 32)
}

// --- Generic ECIES Key Wrapping ---
// Shared primitive: ECDH + SHA-256(label || sharedX) + XChaCha20-Poly1305
// Used by notes (LABEL_NOTE_KEY), files (LABEL_FILE_KEY), hub keys (LABEL_HUB_KEY_WRAP)

/** A symmetric key wrapped via ECIES for a single recipient. */
export interface KeyEnvelope {
  wrappedKey: Ciphertext // hex: nonce(24) + ciphertext(48 = 32 key + 16 tag)
  ephemeralPubkey: string // hex: compressed 33-byte pubkey
}

/** A KeyEnvelope tagged with the recipient's pubkey (for multi-recipient scenarios). */
export interface RecipientKeyEnvelope extends KeyEnvelope {
  pubkey: string // recipient's x-only pubkey (hex)
}

/**
 * Wrap a 32-byte symmetric key for a recipient using ECIES.
 * Domain separation via `label` prevents cross-context key reuse.
 */
export function eciesWrapKey(
  key: Uint8Array,
  recipientPubkeyHex: string,
  label: string
): KeyEnvelope {
  const ephemeralSecret = randomBytes(32)
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)

  const recipientCompressed = hexToBytes(`02${recipientPubkeyHex}`)
  const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const ciphertext = cipher.encrypt(key)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    wrappedKey: bytesToHex(packed) as Ciphertext,
    ephemeralPubkey: bytesToHex(ephemeralPublicKey),
  }
}

/**
 * Unwrap a 32-byte symmetric key from an ECIES envelope.
 * Must use the same `label` that was used during wrapping.
 *
 * Delegates to the crypto worker — the secret key never touches the main thread.
 */
export async function eciesUnwrapKey(envelope: KeyEnvelope, label: string): Promise<Uint8Array> {
  const worker = getCryptoWorker()
  const resultHex = await worker.decrypt(envelope.ephemeralPubkey, envelope.wrappedKey, label)
  return hexToBytes(resultHex)
}

/**
 * ECIES unwrap with explicit secret key — for server-side and test usage
 * where no crypto worker is available.
 */
export function eciesUnwrapKeyWithSecret(
  envelope: KeyEnvelope,
  secretKey: Uint8Array,
  label: string
): Uint8Array {
  const ephemeralPub = hexToBytes(envelope.ephemeralPubkey)
  const shared = secp256k1.getSharedSecret(secretKey, ephemeralPub)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const data = hexToBytes(envelope.wrappedKey)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  return cipher.decrypt(ciphertext)
}

// --- Per-Note Ephemeral Key Encryption (V2 — forward secrecy) ---

export interface EncryptedNoteV2 {
  encryptedContent: Ciphertext // hex: nonce(24) + ciphertext
  authorEnvelope: KeyEnvelope // note key wrapped for the author
  adminEnvelopes: RecipientKeyEnvelope[] // note key wrapped for each admin (multi-admin)
}

/**
 * Encrypt a note with a random per-note key, wrapped for the author and all admins.
 * Provides forward secrecy: compromising the identity key doesn't reveal past notes.
 *
 * @param adminPubkeys - Array of admin decryption pubkeys (supports multi-admin)
 */
export function encryptNoteV2(
  payload: NotePayload,
  authorPubkey: string,
  adminPubkeys: string[]
): EncryptedNoteV2 {
  // Generate random per-note symmetric key
  const noteKey = randomBytes(32)
  const nonce = randomBytes(24)
  const jsonString = JSON.stringify(payload)
  const cipher = xchacha20poly1305(noteKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(jsonString))

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encryptedContent: bytesToHex(packed) as Ciphertext,
    authorEnvelope: eciesWrapKey(noteKey, authorPubkey, LABEL_NOTE_KEY),
    adminEnvelopes: adminPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(noteKey, pk, LABEL_NOTE_KEY),
    })),
  }
}

/**
 * Decrypt a V2 note using the appropriate envelope for the current user.
 * Secret key operations are delegated to the crypto worker.
 */
export async function decryptNoteV2(
  encryptedContent: string,
  envelope: KeyEnvelope
): Promise<NotePayload | null> {
  try {
    const noteKey = await eciesUnwrapKey(envelope, LABEL_NOTE_KEY)
    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(noteKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    const decoded = new TextDecoder().decode(plaintext)
    try {
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return parsed as NotePayload
      }
    } catch {
      // Not JSON
    }
    return { text: decoded }
  } catch {
    return null
  }
}

/**
 * Decrypt a V2 note with explicit secret key — for server-side and test usage
 * where no crypto worker is available.
 */
export function decryptNoteV2WithKey(
  encryptedContent: string,
  envelope: KeyEnvelope,
  secretKey: Uint8Array
): NotePayload | null {
  try {
    const noteKey = eciesUnwrapKeyWithSecret(envelope, secretKey, LABEL_NOTE_KEY)
    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(noteKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    const decoded = new TextDecoder().decode(plaintext)
    try {
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return parsed as NotePayload
      }
    } catch {
      // Not JSON
    }
    return { text: decoded }
  } catch {
    return null
  }
}

// --- E2EE Message Encryption (Epic 74) ---
// Same envelope pattern as notes, using LABEL_MESSAGE for domain separation.
// Used for SMS, WhatsApp, Signal, and web report messages.

export interface EncryptedMessagePayload {
  encryptedContent: Ciphertext // hex: nonce(24) + ciphertext
  readerEnvelopes: RecipientKeyEnvelope[] // message key wrapped for each reader
}

/**
 * Encrypt a message for multiple readers using the envelope pattern.
 * Generates a random per-message symmetric key, wraps it for each reader via ECIES.
 *
 * @param plaintext - Message text to encrypt
 * @param readerPubkeys - Array of reader x-only pubkeys (volunteer + admins)
 */
export function encryptMessage(
  plaintext: string,
  readerPubkeys: string[]
): EncryptedMessagePayload {
  // Generate random per-message symmetric key
  const messageKey = randomBytes(32)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(messageKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encryptedContent: bytesToHex(packed) as Ciphertext,
    readerEnvelopes: readerPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(messageKey, pk, LABEL_MESSAGE),
    })),
  }
}

/**
 * Decrypt a message using the reader's envelope.
 * Finds the envelope matching the reader's pubkey and unwraps the message key.
 * Secret key operations are delegated to the crypto worker.
 *
 * @param encryptedContent - hex: nonce(24) + ciphertext
 * @param readerEnvelopes - array of per-reader ECIES envelopes
 * @param readerPubkey - reader's x-only pubkey (hex) to find the matching envelope
 */
export async function decryptMessage(
  encryptedContent: string,
  readerEnvelopes: RecipientKeyEnvelope[],
  readerPubkey: string
): Promise<string | null> {
  try {
    // Find the envelope for this reader
    const envelope = readerEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    // Unwrap the message key
    const messageKey = await eciesUnwrapKey(envelope, LABEL_MESSAGE)

    // Decrypt the message content
    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(messageKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

// --- Blast Content Encryption ---

export interface EncryptedBlastContentPayload {
  encryptedContent: Ciphertext
  contentEnvelopes: RecipientKeyEnvelope[]
}

export function encryptBlastContent(
  content: BlastContent,
  recipientPubkeys: string[]
): EncryptedBlastContentPayload {
  const blastKey = randomBytes(32)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(blastKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify(content)))

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encryptedContent: bytesToHex(packed) as Ciphertext,
    contentEnvelopes: recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(blastKey, pk, LABEL_BLAST_CONTENT),
    })),
  }
}

/**
 * Decrypt blast content using the crypto worker (main thread, no secret key access).
 * Used by the client UI when the worker is unlocked.
 */
export async function decryptBlastContent(
  encryptedContent: string,
  contentEnvelopes: RecipientKeyEnvelope[],
  readerPubkey: string
): Promise<BlastContent | null> {
  try {
    const envelope = contentEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    const blastKey = await eciesUnwrapKey(envelope, LABEL_BLAST_CONTENT)

    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(blastKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return JSON.parse(new TextDecoder().decode(plaintext)) as BlastContent
  } catch {
    return null
  }
}

/**
 * Decrypt blast content with an explicit secret key (no worker needed).
 * Used by server-side code and unit tests where the secret key is directly available.
 */
export function decryptBlastContentWithKey(
  encryptedContent: string,
  contentEnvelopes: RecipientKeyEnvelope[],
  secretKey: Uint8Array,
  readerPubkey: string
): BlastContent | null {
  try {
    const envelope = contentEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    // Inline ECIES unwrap — mirrors eciesUnwrapKey but with explicit secret key
    const ephemeralPub = hexToBytes(envelope.ephemeralPubkey)
    const shared = secp256k1.getSharedSecret(secretKey, ephemeralPub)
    const sharedX = shared.slice(1, 33)
    const labelBytes = utf8ToBytes(LABEL_BLAST_CONTENT)
    const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
    keyInput.set(labelBytes)
    keyInput.set(sharedX, labelBytes.length)
    const symmetricKey = sha256(keyInput)
    const wrappedData = hexToBytes(envelope.wrappedKey)
    const wrappedNonce = wrappedData.slice(0, 24)
    const wrappedCiphertext = wrappedData.slice(24)
    const unwrapCipher = xchacha20poly1305(symmetricKey, wrappedNonce)
    const blastKey = unwrapCipher.decrypt(wrappedCiphertext)

    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(blastKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return JSON.parse(new TextDecoder().decode(plaintext)) as BlastContent
  } catch {
    return null
  }
}

// --- Call Record Decryption (Epic 77) ---
// Call history records have encrypted metadata (answeredBy, callerNumber).
// Uses the same ECIES envelope pattern as messages but with LABEL_CALL_META.

/**
 * Decrypt a call record's encrypted metadata.
 * Returns the decrypted fields or null if decryption fails.
 * Secret key operations are delegated to the crypto worker.
 */
export async function decryptCallRecord(
  encryptedContent: string,
  adminEnvelopes: RecipientKeyEnvelope[],
  readerPubkey: string
): Promise<{ answeredBy: string | null; callerNumber: string } | null> {
  try {
    const envelope = adminEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    const recordKey = await eciesUnwrapKey(envelope, LABEL_CALL_META)
    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(recordKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    return null
  }
}

// --- Legacy V1 Decryption (kept for backward compatibility with pre-V2 notes) ---
// V1 encrypt path removed (no forward secrecy). All new notes MUST use encryptNoteV2.

/** Decrypt a legacy V1 note — kept for backward compatibility only. */
export function decryptNote(packed: string, secretKey: Uint8Array): NotePayload | null {
  try {
    const key = deriveEncryptionKey(secretKey, HKDF_CONTEXT_NOTES)
    const data = hexToBytes(packed)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(key, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    const decoded = new TextDecoder().decode(plaintext)
    try {
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return parsed as NotePayload
      }
    } catch {
      // Not JSON — legacy plain text note
    }
    return { text: decoded }
  } catch {
    return null
  }
}

// --- ECIES Transcription Decryption ---
// Decrypts server-encrypted transcriptions using ECDH with the volunteer's secret key
// and the ephemeral public key stored alongside the ciphertext.

/**
 * Decrypt a transcription using the crypto worker.
 * The worker performs ECDH + domain-separated key derivation + XChaCha20-Poly1305 decrypt.
 */
export async function decryptTranscription(
  packed: string,
  ephemeralPubkeyHex: string
): Promise<string | null> {
  try {
    // The worker's decrypt performs the same ECIES unwrap:
    // ECDH(secretKey, ephemeralPub) → SHA-256(label || sharedX) → XChaCha20-Poly1305
    const resultHex = await getCryptoWorker().decrypt(
      ephemeralPubkeyHex,
      packed,
      LABEL_TRANSCRIPTION
    )
    return new TextDecoder().decode(hexToBytes(resultHex))
  } catch {
    return null
  }
}

// --- Draft Encryption ---
// Same as notes but with "drafts" domain separation for local draft auto-save

export function encryptDraft(plaintext: string, secretKey: Uint8Array): string {
  const key = deriveEncryptionKey(secretKey, HKDF_CONTEXT_DRAFTS)
  const nonce = randomBytes(24)
  const data = utf8ToBytes(plaintext)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(data)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}

export function decryptDraft(packed: string, secretKey: Uint8Array): string | null {
  try {
    const key = deriveEncryptionKey(secretKey, HKDF_CONTEXT_DRAFTS)
    const data = hexToBytes(packed)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(key, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

// --- Export Encryption ---
// Encrypts a JSON export blob so it can only be read with the user's key

export function encryptExport(jsonString: string, secretKey: Uint8Array): Uint8Array {
  const key = deriveEncryptionKey(secretKey, HKDF_CONTEXT_EXPORT)
  const nonce = randomBytes(24)
  const data = utf8ToBytes(jsonString)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(data)

  // Pack as: nonce (24) + ciphertext
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return packed
}
