import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  LABEL_HUB_KEY_WRAP,
  LABEL_SERVER_NOSTR_KEY,
  LABEL_SERVER_NOSTR_KEY_INFO,
} from '@shared/crypto-labels'
import {
  eciesUnwrapKey,
  eciesWrapKey,
  hkdfDerive,
  hmacSha256,
  symmetricDecrypt,
  symmetricEncrypt,
} from '@shared/crypto-primitives'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'

export class CryptoService {
  constructor(
    private readonly serverSecret: string,
    private readonly hmacSecret: string
  ) {}

  serverEncrypt(plaintext: string, label: string): Ciphertext {
    const key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
    return symmetricEncrypt(utf8ToBytes(plaintext), key) as Ciphertext
  }

  serverDecrypt(ct: Ciphertext, label: string): string {
    const key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
    return new TextDecoder().decode(symmetricDecrypt(ct, key))
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

  hmac(input: string, label: string): HmacHash {
    const key = hexToBytes(this.hmacSecret)
    const data = utf8ToBytes(`${label}${input}`)
    return bytesToHex(hmacSha256(key, data)) as HmacHash
  }

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

  envelopeDecrypt(
    ct: Ciphertext,
    envelope: RecipientEnvelope,
    secretKey: Uint8Array,
    label: string
  ): string {
    const messageKey = eciesUnwrapKey(envelope, secretKey, label)
    return new TextDecoder().decode(symmetricDecrypt(ct, messageKey))
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

  envelopeDecryptBinary(
    ct: Ciphertext,
    envelope: RecipientEnvelope,
    secretKey: Uint8Array,
    label: string
  ): Uint8Array {
    const dataKey = eciesUnwrapKey(envelope, secretKey, label)
    return symmetricDecrypt(ct, dataKey)
  }

  unwrapHubKey(
    envelopes: Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>
  ): Uint8Array {
    const serverPrivateKey = hkdfDerive(
      hexToBytes(this.serverSecret),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
      utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
      32
    )
    const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))
    const envelope = envelopes.find((e) => e.pubkey === serverPubkey)
    if (!envelope) {
      throw new Error(`No hub key envelope for server pubkey ${serverPubkey}`)
    }
    return eciesUnwrapKey(envelope, serverPrivateKey, LABEL_HUB_KEY_WRAP)
  }
}
