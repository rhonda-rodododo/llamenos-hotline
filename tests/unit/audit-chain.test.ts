import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import path from 'node:path'
import { createDatabase } from '../../src/server/db'
import { RecordsService } from '../../src/server/services/records'
import { auditLog } from '../../src/server/db/schema'
import { eq } from 'drizzle-orm'

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://llamenos:llamenos@localhost:5433/llamenos_test'
const TEST_HUB = 'test-hub-audit'

let db: ReturnType<typeof createDatabase>
let service: RecordsService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dir, '../../drizzle/migrations') })
  service = new RecordsService(db)
  // Clean up any prior test data for this hub
  await db.delete(auditLog).where(eq(auditLog.hubId, TEST_HUB))
})

afterAll(async () => {
  await db.delete(auditLog).where(eq(auditLog.hubId, TEST_HUB))
})

describe('audit-chain', () => {
  test('first entry has no previousEntryHash', async () => {
    const entry = await service.addAuditEntry(TEST_HUB, 'test.event.1', 'pubkey-a', { x: 1 })
    expect(entry.previousEntryHash).toBeUndefined()
    expect(entry.entryHash).toBeString()
    expect(entry.entryHash!.length).toBe(64) // 32 bytes hex
  })

  test('second entry previousEntryHash equals first entryHash', async () => {
    const first = await service.addAuditEntry(TEST_HUB, 'test.event.chain-1', 'pubkey-a')
    const second = await service.addAuditEntry(TEST_HUB, 'test.event.chain-2', 'pubkey-a')
    expect(second.previousEntryHash).toBe(first.entryHash)
  })

  test('chain of 3 entries links correctly', async () => {
    await db.delete(auditLog).where(eq(auditLog.hubId, TEST_HUB))
    const e1 = await service.addAuditEntry(TEST_HUB, 'event.1', 'pubkey-x')
    const e2 = await service.addAuditEntry(TEST_HUB, 'event.2', 'pubkey-x')
    const e3 = await service.addAuditEntry(TEST_HUB, 'event.3', 'pubkey-x')

    expect(e1.previousEntryHash).toBeUndefined()
    expect(e2.previousEntryHash).toBe(e1.entryHash)
    expect(e3.previousEntryHash).toBe(e2.entryHash)
  })

  test('tampered entry breaks hash chain verification', async () => {
    await db.delete(auditLog).where(eq(auditLog.hubId, TEST_HUB))
    const e1 = await service.addAuditEntry(TEST_HUB, 'event.real', 'pubkey-y', { safe: true })
    const e2 = await service.addAuditEntry(TEST_HUB, 'event.after', 'pubkey-y')

    // Tamper with e1's details directly in the DB
    await db
      .update(auditLog)
      .set({ details: { safe: false, TAMPERED: true } })
      .where(eq(auditLog.id, e1.id))

    // e2 still references the old e1 hash — chain is now broken
    // Verify by reading e1 back and re-computing what its hash should be
    const [tamperedRow] = await db.select().from(auditLog).where(eq(auditLog.id, e1.id))
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js')

    const recomputed = bytesToHex(
      sha256(
        utf8ToBytes(
          `${tamperedRow.event}${tamperedRow.actorPubkey}${JSON.stringify(tamperedRow.details)}${tamperedRow.previousEntryHash ?? ''}${tamperedRow.createdAt.toISOString()}`
        )
      )
    )
    // The re-computed hash from tampered data does NOT match the stored hash
    expect(recomputed).not.toBe(e1.entryHash)
    // e2's previousEntryHash still points to the original (now-invalid) hash
    expect(e2.previousEntryHash).toBe(e1.entryHash)
  })
})
