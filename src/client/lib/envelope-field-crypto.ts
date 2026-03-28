/**
 * Envelope Field Crypto Helpers
 *
 * Client-side decryption of ECIES envelope-encrypted PII fields
 * (volunteer names, ban phone/reason, caller IDs, device labels, etc.).
 *
 * These fields are envelope-encrypted for the relevant actor + admin pubkeys.
 * The client decrypts when the key is unlocked (after PIN entry), or shows
 * a placeholder when locked.
 */

import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { ClientCryptoService } from './crypto-service'
import * as keyManager from './key-manager'

/**
 * Decrypt an ECIES envelope-encrypted field using the user's secret key.
 * Returns null if decryption fails (wrong key, no matching envelope, not unlocked).
 */
export function decryptEnvelopeField(
  encrypted: string | null | undefined,
  envelopes: RecipientEnvelope[] | null | undefined,
  secretKey: Uint8Array,
  pubkey: string,
  label: string = LABEL_VOLUNTEER_PII
): string | null {
  if (!encrypted || !envelopes?.length) return null
  try {
    const crypto = new ClientCryptoService(secretKey, pubkey)
    return crypto.envelopeDecrypt(encrypted as Ciphertext, envelopes, label)
  } catch {
    return null // Not an authorized recipient, or wrong key
  }
}

/**
 * Higher-level helper: attempt to decrypt an envelope field using the
 * current key manager state. Returns the decrypted value, or the provided
 * fallback (typically the `[encrypted]` placeholder from the server).
 *
 * Safe to call at render time — returns fallback if key is locked.
 */
export function tryDecryptField(
  encrypted: string | null | undefined,
  envelopes: RecipientEnvelope[] | null | undefined,
  fallback: string,
  label: string = LABEL_VOLUNTEER_PII
): string {
  if (!encrypted || !envelopes?.length) return fallback
  if (!keyManager.isUnlocked()) return fallback
  try {
    const sk = keyManager.getSecretKey()
    const pk = keyManager.getPublicKeyHex()
    if (!pk) return fallback
    const decrypted = decryptEnvelopeField(encrypted, envelopes, sk, pk, label)
    return decrypted ?? fallback
  } catch {
    return fallback
  }
}
