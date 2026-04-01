import { index, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'

export const teams = pgTable(
  'teams',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),
    encryptedName: ciphertext('encrypted_name').notNull(),
    encryptedDescription: ciphertext('encrypted_description'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('teams_hub_idx').on(table.hubId)]
)

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: text('team_id').notNull(),
    userPubkey: text('user_pubkey').notNull(),
    addedBy: text('added_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userPubkey] }),
    index('team_members_user_idx').on(table.userPubkey),
  ]
)

export const contactTeamAssignments = pgTable(
  'contact_team_assignments',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    teamId: text('team_id').notNull(),
    hubId: text('hub_id').notNull(),
    assignedBy: text('assigned_by').notNull(), // pubkey or 'auto'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('contact_team_unique').on(table.contactId, table.teamId),
    index('contact_team_assignments_contact_idx').on(table.contactId),
    index('contact_team_assignments_team_idx').on(table.teamId),
    index('contact_team_assignments_hub_idx').on(table.hubId),
  ]
)
