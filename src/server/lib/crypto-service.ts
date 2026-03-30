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

/**
 * Server-side cryptographic operations.
 *
 * Encryption tiers (in order of preference):
 * 1. Envelope E2EE (ECIES per-recipient) — contacts, notes, PII, user/invite phone
 * 2. Hub-key E2EE (symmetric, all hub members) — org metadata (role/hub/team/shift/tag names)
 * 3. Server-key (below) — ONLY for fields the server must process at runtime
 *
 * Fields that MUST remain server-key encrypted:
 * - provider_config credentials (server calls telephony/messaging APIs)
 * - ivr_audio data (server serves to telephony bridge)
 * - blast_settings welcome/bye/opt-in messages (server sends SMS)
 * - push_subscriptions endpoint/auth/p256dh (server sends web push)
 * - subscribers identifier (server sends blasts)
 * - geocoding_config api_key (server calls geocoding API)
 * - signal_registration_pending number (server registers with Signal bridge)
 * - audit_log event/details (server writes audit entries)
 * - active_calls caller number (server routes calls)
 * - call_legs phone (server initiates call legs)
 *
 * All other encrypted fields use hub-key E2EE or envelope E2EE.
 */
export class CryptoService {
  constructor(
    private readonly serverSecret: string,
    private readonly hmacSecret: string
  ) {}

  serverEncrypt(plaintext: string, label: string): Ciphertext {
    const key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
    return symmetricEncrypt(utf8ToBytes(plaintext), key)
  }

  serverDecrypt(ct: Ciphertext, label: string): string {
    const key = hkdfDerive(hexToBytes(this.serverSecret), new Uint8Array(0), utf8ToBytes(label), 32)
    return new TextDecoder().decode(symmetricDecrypt(ct, key))
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
