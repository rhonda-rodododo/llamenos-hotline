/**
 * Tauri IPC command router for Playwright test builds.
 *
 * Maintains a CryptoState (secret key in closure) that mirrors the Rust-side
 * CryptoState. Routes all IPC commands to the JS crypto implementations
 * from crypto-impl.ts.
 */

import {
  generateKeyPair, keyPairFromNsec, isValidNsec,
  createAuthToken, eciesWrapKey, eciesUnwrapKey,
  encryptNoteV2, decryptNoteV2,
  encryptMessage, decryptMessage,
  decryptCallRecord,
  decryptNote as decryptLegacyNote,
  decryptTranscription, encryptDraft, decryptDraft, encryptExport,
  type KeyEnvelope, type RecipientKeyEnvelope,
} from './crypto-impl'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'
import { getPublicKey, nip19, finalizeEvent } from 'nostr-tools'
import { storeEncryptedKey, decryptWithPin } from './key-store-impl'

// --- Mock CryptoState (mirrors Rust CryptoState) ---
let secretKeyHex: string | null = null
let publicKeyHex: string | null = null

function requireUnlocked(): string {
  if (!secretKeyHex) throw new Error('CryptoState is locked')
  return secretKeyHex
}

function requirePublicKey(): string {
  if (!publicKeyHex) throw new Error('CryptoState is locked')
  return publicKeyHex
}

// --- IPC Command Router ---
export async function handleInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    // --- Keypair operations (stateless) ---
    case 'generate_keypair': {
      const kp = generateKeyPair()
      return {
        secretKeyHex: bytesToHex(kp.secretKey),
        publicKey: kp.publicKey,
        nsec: kp.nsec,
        npub: kp.npub,
      }
    }
    case 'get_public_key': {
      return getPublicKey(hexToBytes(args.secretKeyHex as string))
    }
    case 'is_valid_nsec':
      return isValidNsec(args.nsec as string)
    case 'key_pair_from_nsec': {
      const kp = keyPairFromNsec(args.nsec as string)
      if (!kp) throw new Error('Invalid nsec')
      return {
        secretKeyHex: bytesToHex(kp.secretKey),
        publicKey: kp.publicKey,
        nsec: kp.nsec,
        npub: kp.npub,
      }
    }

    // --- CryptoState management ---
    case 'import_key_to_state': {
      const nsec = args.nsec as string
      const pin = args.pin as string
      const pubkeyHex = args.pubkeyHex as string
      const encData = await storeEncryptedKey(nsec, pin, pubkeyHex)
      // Also load into CryptoState
      const decoded = nip19.decode(nsec)
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
      secretKeyHex = bytesToHex(decoded.data)
      publicKeyHex = pubkeyHex
      return encData
    }
    case 'unlock_with_pin': {
      const data = args.data as Record<string, unknown>
      const pin = args.pin as string
      const nsec = await decryptWithPin(data, pin)
      if (!nsec) throw new Error('Wrong PIN')
      const decoded = nip19.decode(nsec)
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
      secretKeyHex = bytesToHex(decoded.data)
      publicKeyHex = getPublicKey(decoded.data)
      return publicKeyHex
    }
    case 'lock_crypto':
      secretKeyHex = null
      // Keep publicKeyHex for display
      return undefined
    case 'is_crypto_unlocked':
      return secretKeyHex !== null
    case 'get_public_key_from_state':
      return requirePublicKey()
    case 'get_nsec_from_state': {
      const sk = requireUnlocked()
      return nip19.nsecEncode(hexToBytes(sk))
    }

    // --- Auth tokens ---
    case 'create_auth_token_from_state': {
      const sk = requireUnlocked()
      return createAuthToken(
        hexToBytes(sk),
        args.timestamp as number,
        args.method as string,
        args.path as string,
      )
    }
    case 'create_auth_token': {
      // Stateless variant (for sign-in flow)
      return createAuthToken(
        hexToBytes(args.secretKeyHex as string),
        args.timestamp as number,
        args.method as string,
        args.path as string,
      )
    }

    // --- ECIES operations ---
    case 'ecies_wrap_key': {
      return eciesWrapKey(
        hexToBytes(args.keyHex as string),
        args.recipientPubkey as string,
        args.label as string,
      )
    }
    case 'ecies_unwrap_key_from_state': {
      const sk = requireUnlocked()
      const envelope = args.envelope as KeyEnvelope
      const result = eciesUnwrapKey(envelope, hexToBytes(sk), args.label as string)
      return bytesToHex(result)
    }

    // --- Note encryption/decryption ---
    case 'encrypt_note':
      return encryptNoteV2(
        JSON.parse(args.payloadJson as string),
        args.authorPubkey as string,
        args.adminPubkeys as string[],
      )
    case 'decrypt_note_from_state': {
      const sk = requireUnlocked()
      const envelope = args.envelope as KeyEnvelope
      const result = decryptNoteV2(args.encryptedContent as string, envelope, hexToBytes(sk))
      return result ? JSON.stringify(result) : null
    }
    case 'decrypt_legacy_note_from_state': {
      const sk = requireUnlocked()
      const result = decryptLegacyNote(args.packed as string, hexToBytes(sk))
      return result ? JSON.stringify(result) : null
    }

    // --- Message encryption/decryption ---
    case 'encrypt_message':
      return encryptMessage(args.plaintext as string, args.readerPubkeys as string[])
    case 'decrypt_message_from_state': {
      const sk = requireUnlocked()
      const pk = requirePublicKey()
      return decryptMessage(
        args.encryptedContent as string,
        args.readerEnvelopes as RecipientKeyEnvelope[],
        hexToBytes(sk),
        pk,
      )
    }

    // --- Call record decryption ---
    case 'decrypt_call_record_from_state': {
      const sk = requireUnlocked()
      const pk = requirePublicKey()
      const result = decryptCallRecord(
        args.encryptedContent as string,
        args.adminEnvelopes as RecipientKeyEnvelope[],
        hexToBytes(sk),
        pk,
      )
      return result ? JSON.stringify(result) : null
    }

    // --- Transcription decryption ---
    case 'decrypt_transcription_from_state': {
      const sk = requireUnlocked()
      return decryptTranscription(
        args.packed as string,
        args.ephemeralPubkeyHex as string,
        hexToBytes(sk),
      )
    }

    // --- Draft encryption/decryption ---
    case 'encrypt_draft_from_state': {
      const sk = requireUnlocked()
      return encryptDraft(args.plaintext as string, hexToBytes(sk))
    }
    case 'decrypt_draft_from_state': {
      const sk = requireUnlocked()
      return decryptDraft(args.packed as string, hexToBytes(sk))
    }

    // --- Export encryption ---
    case 'encrypt_export_from_state': {
      const sk = requireUnlocked()
      const bytes = encryptExport(args.jsonString as string, hexToBytes(sk))
      // Return base64 (matching Rust Epic 92 behavior)
      return btoa(String.fromCharCode(...bytes))
    }

    // --- Nostr event signing ---
    case 'sign_nostr_event_from_state': {
      const sk = requireUnlocked()
      const template = {
        kind: args.kind as number,
        created_at: args.createdAt as number,
        tags: args.tags as string[][],
        content: args.content as string,
      }
      return finalizeEvent(template, hexToBytes(sk))
    }
    case 'verify_schnorr':
      // Simplified for tests — always accept
      return true

    // --- File crypto (ECIES through CryptoState) ---
    case 'decrypt_file_metadata_from_state': {
      const sk = requireUnlocked()
      // Import dynamically to avoid circular deps
      const { secp256k1 } = await import('@noble/curves/secp256k1.js')
      const { sha256 } = await import('@noble/hashes/sha2.js')
      const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js')
      const { utf8ToBytes } = await import('@noble/ciphers/utils.js')

      try {
        const ephemeralPub = hexToBytes(args.ephemeralPubkeyHex as string)
        const shared = secp256k1.getSharedSecret(hexToBytes(sk), ephemeralPub)
        const sharedX = shared.slice(1, 33)
        const label = utf8ToBytes('llamenos:file-metadata')
        const keyInput = new Uint8Array(label.length + sharedX.length)
        keyInput.set(label)
        keyInput.set(sharedX, label.length)
        const symmetricKey = sha256(keyInput)
        const data = hexToBytes(args.encryptedContentHex as string)
        const nonce = data.slice(0, 24)
        const ciphertext = data.slice(24)
        const cipher = xchacha20poly1305(symmetricKey, nonce)
        const plaintext = cipher.decrypt(ciphertext)
        return new TextDecoder().decode(plaintext)
      } catch {
        return null
      }
    }
    case 'unwrap_file_key_from_state': {
      const sk = requireUnlocked()
      const envelope = args.envelope as KeyEnvelope
      const result = eciesUnwrapKey(envelope, hexToBytes(sk), 'llamenos:file-key')
      return bytesToHex(result)
    }
    case 'unwrap_hub_key_from_state': {
      const sk = requireUnlocked()
      const envelope = args.envelope as KeyEnvelope
      const result = eciesUnwrapKey(envelope, hexToBytes(sk), 'llamenos:hub-key-wrap')
      return bytesToHex(result)
    }
    case 'rewrap_file_key_from_state': {
      const sk = requireUnlocked()
      const envelope: KeyEnvelope = {
        wrappedKey: args.encryptedFileKeyHex as string,
        ephemeralPubkey: args.ephemeralPubkeyHex as string,
      }
      // Unwrap with admin key
      const fileKey = eciesUnwrapKey(envelope, hexToBytes(sk), 'llamenos:file-key')
      // Re-wrap for new recipient
      const wrapped = eciesWrapKey(fileKey, args.newRecipientPubkeyHex as string, 'llamenos:file-key')
      return wrapped
    }

    default:
      console.warn(`[tauri-mock] Unknown IPC command: ${cmd}`)
      throw new Error(`Unknown Tauri IPC command: ${cmd}`)
  }
}
