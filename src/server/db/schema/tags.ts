import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'

export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),
    name: text('name').notNull(),
    encryptedLabel: ciphertext('encrypted_label').notNull(),
    color: text('color').notNull().default('#6b7280'),
    encryptedCategory: ciphertext('encrypted_category'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tags_hub_name_unique').on(table.hubId, table.name)]
)
