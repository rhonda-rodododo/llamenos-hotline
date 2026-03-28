import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * Compute SHA-256 hash of an audit entry's core content for chain linking.
 * This is NOT encryption -- it's an integrity hash for tamper detection.
 */
export function hashAuditEntry(entry: {
  id: string
  event: string
  actorPubkey: string
  details: Record<string, unknown>
  createdAt: string
  previousEntryHash?: string
}): string {
  const content = `${entry.id}:${entry.event}:${entry.actorPubkey}:${entry.createdAt}:${JSON.stringify(entry.details)}:${entry.previousEntryHash || ''}`
  return bytesToHex(sha256(utf8ToBytes(content)))
}
