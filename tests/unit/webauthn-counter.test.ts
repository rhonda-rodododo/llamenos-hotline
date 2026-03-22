import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import path from 'node:path'
import { createDatabase } from '../../src/server/db'
import { IdentityService } from '../../src/server/services/identity'
import { webauthnCredentials } from '../../src/server/db/schema'
import { eq } from 'drizzle-orm'

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://llamenos:llamenos@localhost:5433/llamenos_test'
const TEST_PUBKEY = 'test-webauthn-pubkey-counter'
const TEST_CRED_ID = 'test-cred-counter-001'

let db: ReturnType<typeof createDatabase>
let service: IdentityService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dir, '../../drizzle/migrations') })
  service = new IdentityService(db)
  // Clean up prior test credential
  await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, TEST_CRED_ID))
  // Insert test credential with counter=5
  await db.insert(webauthnCredentials).values({
    id: TEST_CRED_ID,
    pubkey: TEST_PUBKEY,
    publicKey: 'fake-public-key-bytes',
    counter: '5',
    transports: [],
    backedUp: false,
    label: 'test device',
    lastUsedAt: new Date(),
  })
})

afterAll(async () => {
  await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, TEST_CRED_ID))
})

describe('webauthn-counter', () => {

  test('counter=6 succeeds (first valid increment)', async () => {
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: TEST_CRED_ID,
        counter: 6,
        lastUsedAt: new Date().toISOString(),
      })
    ).resolves.toBeUndefined()
  })

  test('counter=6 again must throw (same-value replay)', async () => {
    // Counter is now 6 from the previous test
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: TEST_CRED_ID,
        counter: 6,
        lastUsedAt: new Date().toISOString(),
      })
    ).rejects.toThrow()
  })

  test('counter=4 must throw (lower-value replay)', async () => {
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: TEST_CRED_ID,
        counter: 4,
        lastUsedAt: new Date().toISOString(),
      })
    ).rejects.toThrow()
  })

  test('counter=7 succeeds after valid prior state', async () => {
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: TEST_CRED_ID,
        counter: 7,
        lastUsedAt: new Date().toISOString(),
      })
    ).resolves.toBeUndefined()
  })

  test('non-existent credential throws 404', async () => {
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: 'no-such-cred',
        counter: 100,
        lastUsedAt: new Date().toISOString(),
      })
    ).rejects.toThrow()
  })
})
