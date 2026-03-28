import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { HKDF_SALT } from '@shared/crypto-labels'
import {
  eciesUnwrapKey,
  eciesWrapKey,
  hkdfDerive,
  symmetricDecrypt,
  symmetricEncrypt,
} from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'

export class ClientCryptoService {
  constructor(
    private readonly secretKey: Uint8Array,
    private readonly pubkey: string
  ) {}

  envelopeEncrypt(
    plaintext: string,
    recipientPubkeys: string[],
    label: string
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const encrypted = symmetricEncrypt(utf8ToBytes(plaintext), messageKey) as Ciphertext
    const envelopes: RecipientEnvelope[] = recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(messageKey, pk, label),
    }))
    return { encrypted, envelopes }
  }

  envelopeDecrypt(ct: Ciphertext, envelopes: RecipientEnvelope[], label: string): string {
    const envelope = envelopes.find((e) => e.pubkey === this.pubkey)
    if (!envelope) throw new Error(`No envelope for pubkey ${this.pubkey}`)
    const messageKey = eciesUnwrapKey(envelope, this.secretKey, label)
    return new TextDecoder().decode(symmetricDecrypt(ct, messageKey))
  }

  hubEncrypt(plaintext: string, hubKey: Uint8Array): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey) as Ciphertext
  }

  hubDecrypt(ct: Ciphertext, hubKey: Uint8Array): string | null {
    try {
      return new TextDecoder().decode(symmetricDecrypt(ct, hubKey))
    } catch {
      return null
    }
  }

  envelopeEncryptBinary(
    data: Uint8Array,
    recipientPubkeys: string[],
    label: string
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const dataKey = new Uint8Array(32)
    crypto.getRandomValues(dataKey)
    const encrypted = symmetricEncrypt(data, dataKey) as Ciphertext
    const envelopes: RecipientEnvelope[] = recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(dataKey, pk, label),
    }))
    return { encrypted, envelopes }
  }

  envelopeDecryptBinary(ct: Ciphertext, envelopes: RecipientEnvelope[], label: string): Uint8Array {
    const envelope = envelopes.find((e) => e.pubkey === this.pubkey)
    if (!envelope) throw new Error(`No envelope for pubkey ${this.pubkey}`)
    const dataKey = eciesUnwrapKey(envelope, this.secretKey, label)
    return symmetricDecrypt(ct, dataKey)
  }

  encryptDraft(plaintext: string): Ciphertext {
    const key = hkdfDerive(
      this.secretKey,
      utf8ToBytes(HKDF_SALT),
      utf8ToBytes('llamenos:drafts'),
      32
    )
    return symmetricEncrypt(utf8ToBytes(plaintext), key) as Ciphertext
  }

  decryptDraft(ct: Ciphertext): string {
    const key = hkdfDerive(
      this.secretKey,
      utf8ToBytes(HKDF_SALT),
      utf8ToBytes('llamenos:drafts'),
      32
    )
    return new TextDecoder().decode(symmetricDecrypt(ct, key))
  }
}
