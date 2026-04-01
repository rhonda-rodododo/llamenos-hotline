import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '../db'
import { contacts } from '../db/schema/contacts'

export interface AssignmentCheck {
  resourceId: string
  userPubkey: string
  hubId: string
}

export interface AssignmentResolver {
  isAssigned(check: AssignmentCheck): Promise<boolean>
  listAssignedIds(userPubkey: string, hubId: string): Promise<string[]>
}

/**
 * Domain-specific "assigned" definitions (implement resolvers as scope enforcement is added):
 * - notes: authorPubkey = user OR note linked to a call the user handled
 * - conversations: assignedTo = user
 * - reports: assignedTo = user OR submittedBy = user
 * - files: file attached to a resource the user is assigned to
 * - shifts: user is listed in the shift's userPubkeys array
 */
export class ContactsAssignmentResolver implements AssignmentResolver {
  constructor(private db: Database) {}

  async isAssigned({
    resourceId: contactId,
    userPubkey,
    hubId,
  }: AssignmentCheck): Promise<boolean> {
    // Direct personal assignment
    const contact = await this.db
      .select({ createdBy: contacts.createdBy, assignedTo: contacts.assignedTo })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.hubId, hubId)))
      .limit(1)
    if (contact[0]?.createdBy === userPubkey) return true
    if (contact[0]?.assignedTo === userPubkey) return true

    // Linked via call handling — contact_call_links.call_id stores the call SID,
    // and call_legs uses call_sid as its column name
    // bun-sql drizzle execute() returns Record<string, unknown>[] directly
    const callLink = await this.db.execute<{ found: number }>(sql`
      SELECT 1 AS found FROM contact_call_links ccl
      JOIN call_legs cl ON cl.call_sid = ccl.call_id
      WHERE ccl.contact_id = ${contactId} AND cl.user_pubkey = ${userPubkey} AND ccl.hub_id = ${hubId}
      LIMIT 1
    `)
    if (callLink.length > 0) return true

    // Team-based assignment
    const teamLink = await this.db.execute<{ found: number }>(sql`
      SELECT 1 AS found FROM contact_team_assignments cta
      JOIN team_members tm ON tm.team_id = cta.team_id
      WHERE cta.contact_id = ${contactId} AND tm.user_pubkey = ${userPubkey} AND cta.hub_id = ${hubId}
      LIMIT 1
    `)
    if (teamLink.length > 0) return true

    return false
  }

  async listAssignedIds(userPubkey: string, hubId: string): Promise<string[]> {
    const results = await this.db.execute<{ id: string }>(sql`
      SELECT DISTINCT c.id FROM contacts c
      WHERE c.hub_id = ${hubId} AND c.deleted_at IS NULL
      AND (
        c.created_by = ${userPubkey}
        OR c.assigned_to = ${userPubkey}
        OR c.id IN (
          SELECT ccl.contact_id FROM contact_call_links ccl
          JOIN call_legs cl ON cl.call_sid = ccl.call_id
          WHERE cl.user_pubkey = ${userPubkey} AND ccl.hub_id = ${hubId}
        )
        OR c.id IN (
          SELECT cta.contact_id FROM contact_team_assignments cta
          JOIN team_members tm ON tm.team_id = cta.team_id
          WHERE tm.user_pubkey = ${userPubkey} AND cta.hub_id = ${hubId}
        )
      )
    `)
    return results.map((r) => r.id)
  }
}
