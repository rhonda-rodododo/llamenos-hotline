/**
 * Decrypt-on-fetch field utilities.
 *
 * Scans API response objects for encrypted field pairs and decrypts them
 * in place via the crypto worker. The worker has its own internal cache,
 * so no client-side cache is needed here.
 *
 * Field convention: `encryptedFoo` (ciphertext) + `fooEnvelopes` (envelopes array)
 * → decrypted value written to `foo`.
 */

import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import { getCryptoWorker } from './crypto-worker-client'

// ---------------------------------------------------------------------------
// EncryptedFieldRef
// ---------------------------------------------------------------------------

/** Represents a resolved encrypted field pair ready for decryption. */
export interface EncryptedFieldRef {
  /** The destination key on the object, e.g. `"name"` for `encryptedName`. */
  plaintextKey: string
  /** Hex-encoded ciphertext from `encryptedFoo`. */
  ciphertext: string
  /** The matching ECIES envelope for the reader. */
  envelope: RecipientEnvelope
}

// ---------------------------------------------------------------------------
// resolveEncryptedFields
// ---------------------------------------------------------------------------

/**
 * Scan a plain object for encrypted field pairs and return refs.
 *
 * Looks for keys matching `encrypted<Foo>` and a corresponding `<foo>Envelopes`
 * array. Derives `plaintextKey` by stripping the `encrypted` prefix and
 * lower-casing the first character.
 *
 * @param obj         Any plain object (API response body, etc.)
 * @param readerPubkey  If provided, only return refs whose envelope matches
 *                      this pubkey. If omitted, returns the first envelope in
 *                      the array for each field.
 */
export function resolveEncryptedFields(
  obj: Record<string, unknown>,
  readerPubkey?: string
): EncryptedFieldRef[] {
  const refs: EncryptedFieldRef[] = []

  for (const key of Object.keys(obj)) {
    if (!key.startsWith('encrypted')) continue

    // encryptedFoo → foo  (strip 'encrypted', lower-case first char)
    const suffix = key.slice('encrypted'.length)
    if (!suffix) continue
    const plaintextKey = suffix.charAt(0).toLowerCase() + suffix.slice(1)
    const envelopesKey = `${plaintextKey}Envelopes`

    const ciphertext = obj[key]
    const envelopes = obj[envelopesKey]

    if (typeof ciphertext !== 'string' || !Array.isArray(envelopes) || envelopes.length === 0) {
      continue
    }

    const envelope: RecipientEnvelope | undefined = readerPubkey
      ? (envelopes as RecipientEnvelope[]).find((e) => e.pubkey === readerPubkey)
      : (envelopes[0] as RecipientEnvelope)

    if (!envelope) continue

    refs.push({ plaintextKey, ciphertext, envelope })
  }

  return refs
}

// ---------------------------------------------------------------------------
// decryptObjectFields
// ---------------------------------------------------------------------------

/**
 * Decrypt all encrypted field pairs on `obj` in-place, writing plaintext to
 * the corresponding `foo` key. Delegates to the crypto worker; caching is
 * handled internally by the worker.
 *
 * @param obj           Plain object with `encryptedFoo` + `fooEnvelopes` pairs.
 * @param readerPubkey  The current user's x-only public key hex.
 * @param label         Domain separation label (defaults to LABEL_VOLUNTEER_PII).
 * @returns The same object, mutated in place.
 */
export async function decryptObjectFields<T extends Record<string, unknown>>(
  obj: T,
  readerPubkey: string,
  label: string = LABEL_VOLUNTEER_PII
): Promise<T> {
  const refs = resolveEncryptedFields(obj, readerPubkey)
  if (refs.length === 0) return obj

  const worker = getCryptoWorker()

  await Promise.all(
    refs.map(async ({ plaintextKey, ciphertext, envelope }) => {
      try {
        const plaintext = await worker.decryptEnvelopeField(
          ciphertext,
          envelope.ephemeralPubkey,
          envelope.wrappedKey,
          label
        )
        ;(obj as Record<string, unknown>)[plaintextKey] = plaintext
      } catch {
        // Leave field as-is (placeholder value from server)
      }
    })
  )

  return obj
}

// ---------------------------------------------------------------------------
// decryptArrayFields
// ---------------------------------------------------------------------------

/**
 * Decrypt encrypted field pairs on every item in an array in-place.
 *
 * @param items         Array of plain objects.
 * @param readerPubkey  The current user's x-only public key hex.
 * @param label         Domain separation label (defaults to LABEL_VOLUNTEER_PII).
 * @returns The same array, with each item mutated in place.
 */
export async function decryptArrayFields<T extends Record<string, unknown>>(
  items: T[],
  readerPubkey: string,
  label: string = LABEL_VOLUNTEER_PII
): Promise<T[]> {
  await Promise.all(items.map((item) => decryptObjectFields(item, readerPubkey, label)))
  return items
}
