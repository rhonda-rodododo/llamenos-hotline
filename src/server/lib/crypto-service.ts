import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  HMAC_IP_PREFIX,
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
  private derivedKeys = new Map<string, Uint8Array>()
  private cachedServerPrivateKey: Uint8Array | null = null
  private cachedServerPubkey: string | null = null
  private cachedHmacKey: Uint8Array | null = null

  constructor(
    private readonly serverSecret: string,
    private readonly hmacSecret: string
  ) {}

  private deriveKey(label: string): Uint8Array {
    let key = this.derivedKeys.get(label)
    if (!key) {
      key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
      this.derivedKeys.set(label, key)
    }
    return key
  }

  private getHmacKey(): Uint8Array {
    if (!this.cachedHmacKey) {
      this.cachedHmacKey = hexToBytes(this.hmacSecret)
    }
    return this.cachedHmacKey
  }

  private getServerPrivateKey(): { privateKey: Uint8Array; pubkey: string } {
    if (!this.cachedServerPrivateKey) {
      this.cachedServerPrivateKey = hkdfDerive(
        hexToBytes(this.serverSecret),
        utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
        utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
        32
      )
      this.cachedServerPubkey = bytesToHex(
        secp256k1.getPublicKey(this.cachedServerPrivateKey, true).slice(1)
      )
    }
    return { privateKey: this.cachedServerPrivateKey, pubkey: this.cachedServerPubkey! }
  }

  serverEncrypt(plaintext: string, label: string): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), this.deriveKey(label))
  }

  serverDecrypt(ct: Ciphertext, label: string): string {
    return new TextDecoder().decode(symmetricDecrypt(ct, this.deriveKey(label)))
  }

  hubEncrypt(plaintext: string, hubKey: Uint8Array): Ciphertext {
    return symmetricEncrypt(utf8ToBytes(plaintext), hubKey)
  }

  hubDecrypt(ct: Ciphertext, hubKey: Uint8Array): string | null {
    try {
      return new TextDecoder().decode(symmetricDecrypt(ct, hubKey))
    } catch {
      return null
    }
  }

  /**
   * Decrypt a field: try hub key first, then server key fallback.
   * This handles the transition where data may be encrypted with either key.
   */
  decryptField(ct: Ciphertext, hubKey: Uint8Array | null, serverLabel: string): string {
    if (hubKey) {
      const result = this.hubDecrypt(ct, hubKey)
      if (result) return result
    }
    try {
      return this.serverDecrypt(ct, serverLabel)
    } catch {
      return ''
    }
  }

  hmac(input: string, label: string): HmacHash {
    const data = utf8ToBytes(`${label}${input}`)
    return bytesToHex(hmacSha256(this.getHmacKey(), data)) as HmacHash
  }

  envelopeEncrypt(
    plaintext: string,
    recipientPubkeys: string[],
    label: string
  ): { encrypted: Ciphertext; envelopes: RecipientEnvelope[] } {
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const encrypted = symmetricEncrypt(utf8ToBytes(plaintext), messageKey)
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
    const encrypted = symmetricEncrypt(data, dataKey)
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
    const { privateKey, pubkey } = this.getServerPrivateKey()
    const envelope = envelopes.find((e) => e.pubkey === pubkey)
    if (!envelope) {
      throw new Error(`No hub key envelope for server pubkey ${pubkey}`)
    }
    return eciesUnwrapKey(envelope, privateKey, LABEL_HUB_KEY_WRAP)
  }
}

/**
 * Standalone helper: hash an IP address for rate limiting.
 * Uses HMAC-SHA256 with the server HMAC secret to prevent precomputation attacks.
 * Truncated to 24 hex chars for storage efficiency.
 */
export function hashIP(ip: string, secret: string): string {
  const key = hexToBytes(secret)
  const input = utf8ToBytes(`${HMAC_IP_PREFIX}${ip}`)
  return bytesToHex(hmacSha256(key, input)).slice(0, 24)
}
