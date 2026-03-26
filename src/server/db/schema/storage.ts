import { integer, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { hubs } from './settings'

export const hubStorageSettings = pgTable(
  'hub_storage_settings',
  {
    hubId: text('hub_id')
      .notNull()
      .references(() => hubs.id, { onDelete: 'cascade' }),
    namespace: text('namespace').notNull(),
    retentionDays: integer('retention_days'),
  },
  (t) => [unique('hub_storage_namespace_uniq').on(t.hubId, t.namespace)]
)
