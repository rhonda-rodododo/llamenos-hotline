import { customType } from 'drizzle-orm/pg-core'

export const jsonb = <T>() =>
  customType<{ data: T; driverData: T }>({
    dataType() { return 'jsonb' },
    // No toDriver — Bun SQL handles object → JSONB natively
    fromDriver(value: T): T { return value },
  })
