/// <reference types="bun-types" />
import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

let _db: ReturnType<typeof createDatabase> | null = null

export function createDatabase(url: string) {
  const client = new SQL({
    url,
    max: parseInt(process.env.PG_POOL_SIZE ?? '10'),
    idleTimeout: parseInt(process.env.PG_IDLE_TIMEOUT ?? '30'),
    connectionTimeout: 30,
  })
  return drizzle({ client, schema })
}

export function getDb() {
  if (!_db) throw new Error('Database not initialized — call initDb() first')
  return _db
}

export function initDb(url: string) {
  _db = createDatabase(url)
  return _db
}

export type Database = ReturnType<typeof createDatabase>
