import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { RecordsService } from '@server/services/records'
import { auditLog } from '@server/db/schema'
import { eq } from 'drizzle-orm'

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://llamenos:llamenos@localhost:5433/llamenos_test'
// Use a unique prefix per test run so parallel file-level execution never shares data
const RUN_PREFIX = `test-hub-audit-${crypto.randomUUID().slice(0, 8)}`

let db: ReturnType<typeof createDatabase>
let service: RecordsService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dir, '../../drizzle/migrations') })
  service = new RecordsService(db)
})

afterAll(async () => {
  // Clean up all entries with our run prefix (handles all hub IDs used in this run)
  const { sql } = await import('drizzle-orm')
  await db.delete(auditLog).where(sql`${auditLog.hubId} LIKE ${RUN_PREFIX + '%'}`)
})

describe('audit-chain', () => {
  test('first entry has no previousEntryHash', async () => {
    const hub = `${RUN_PREFIX}-t1`
    const entry = await service.addAuditEntry(hub, 'test.event.1', 'pubkey-a', { x: 1 })
    expect(entry.previousEntryHash).toBeUndefined()
    expect(entry.entryHash).toBeString()
    expect(entry.entryHash!.length).toBe(64) // 32 bytes hex
  })

  test('second entry previousEntryHash equals first entryHash', async () => {
    const hub = `${RUN_PREFIX}-t2`
    const first = await service.addAuditEntry(hub, 'test.event.chain-1', 'pubkey-a')
    const second = await service.addAuditEntry(hub, 'test.event.chain-2', 'pubkey-a')
    expect(second.previousEntryHash).toBe(first.entryHash)
  })

  test('chain of 3 entries links correctly', async () => {
    const hub = `${RUN_PREFIX}-t3`
    const e1 = await service.addAuditEntry(hub, 'event.1', 'pubkey-x')
    const e2 = await service.addAuditEntry(hub, 'event.2', 'pubkey-x')
    const e3 = await service.addAuditEntry(hub, 'event.3', 'pubkey-x')

    expect(e1.previousEntryHash).toBeUndefined()
    expect(e2.previousEntryHash).toBe(e1.entryHash)
    expect(e3.previousEntryHash).toBe(e2.entryHash)
  })

  test('tampered entry breaks hash chain verification', async () => {
    const hub = `${RUN_PREFIX}-t4`
    const e1 = await service.addAuditEntry(hub, 'event.real', 'pubkey-y', { safe: true })
    const e2 = await service.addAuditEntry(hub, 'event.after', 'pubkey-y')

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
