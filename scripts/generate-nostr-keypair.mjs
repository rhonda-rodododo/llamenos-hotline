#!/usr/bin/env node
/**
 * Generate Nostr keypairs using only Node.js built-in crypto.
 * No external dependencies — runs with Node.js 18+.
 *
 * Outputs JSON with identity keypair, decryption keypair, and server secret.
 *
 * Usage:
 *   node scripts/generate-nostr-keypair.mjs
 *   docker run --rm -v "$PWD/scripts:/scripts:ro" node:22-slim node /scripts/generate-nostr-keypair.mjs
 */
import { createECDH, randomBytes } from 'node:crypto'

// ── Minimal bech32 encoder (NIP-19 uses standard bech32, not bech32m) ──

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values) {
  let chk = 1
  for (const v of values) {
    const b = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GENERATOR[i]
    }
  }
  return chk
}

function hrpExpand(hrp) {
  const ret = []
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5)
  ret.push(0)
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31)
  return ret
}

function createChecksum(hrp, words) {
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]
  const mod = polymod(values) ^ 1
  return Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31)
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0
  const ret = []
  const maxv = (1 << toBits) - 1
  for (const value of data) {
    acc = (acc << fromBits) | value
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      ret.push((acc >> bits) & maxv)
    }
  }
  if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv)
  return ret
}

function bech32Encode(hrp, data) {
  const words = convertBits(data, 8, 5, true)
  const chk = createChecksum(hrp, words)
  return hrp + '1' + [...words, ...chk].map(d => CHARSET[d]).join('')
}

// ── Key generation ──────────────────────────────────────────────────

function generateKeypair() {
  const ecdh = createECDH('secp256k1')
  const secretKey = randomBytes(32)
  ecdh.setPrivateKey(secretKey)

  // Compressed pubkey: 33 bytes (02|03 prefix + 32 bytes x-coordinate)
  // Nostr uses x-only pubkeys (just the 32-byte x-coordinate)
  const compressed = ecdh.getPublicKey(null, 'compressed')
  const xOnlyPubkey = compressed.subarray(1, 33)

  return {
    secretKeyHex: secretKey.toString('hex'),
    publicKeyHex: xOnlyPubkey.toString('hex'),
    nsec: bech32Encode('nsec', [...secretKey]),
    npub: bech32Encode('npub', [...xOnlyPubkey]),
  }
}

const identity = generateKeypair()
const decryption = generateKeypair()
const serverNostrSecret = randomBytes(32).toString('hex')

console.log(JSON.stringify({ identity, decryption, serverNostrSecret }))
