import { describe, expect, test } from 'bun:test'
import { hashAuditEntry } from './audit-hash'

describe('hashAuditEntry', () => {
  const baseEntry = {
    id: 'entry-001',
    event: 'call.answered',
    actorPubkey: 'abc123',
    details: { callId: 'call-42' },
    createdAt: '2026-03-26T00:00:00Z',
  }

  test('deterministic', () => {
    const h1 = hashAuditEntry(baseEntry)
    const h2 = hashAuditEntry(baseEntry)
    expect(h1).toBe(h2)
  })

  test('output is 64 hex chars (SHA-256)', () => {
    const h = hashAuditEntry(baseEntry)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  test('changing any field changes hash', () => {
    const original = hashAuditEntry(baseEntry)

    expect(hashAuditEntry({ ...baseEntry, id: 'entry-002' })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, event: 'call.missed' })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, actorPubkey: 'xyz789' })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, details: { callId: 'call-99' } })).not.toBe(original)
    expect(hashAuditEntry({ ...baseEntry, createdAt: '2026-03-27T00:00:00Z' })).not.toBe(original)
  })

  test('chain linkage — with vs without previousEntryHash', () => {
    const withoutPrev = hashAuditEntry(baseEntry)
    const withPrev = hashAuditEntry({ ...baseEntry, previousEntryHash: 'deadbeef'.repeat(8) })
    expect(withoutPrev).not.toBe(withPrev)
  })
})
