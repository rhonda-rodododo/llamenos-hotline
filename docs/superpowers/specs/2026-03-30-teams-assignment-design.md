# Teams & Team-Based Assignment — Design Spec

**Date:** 2026-03-30
**Status:** Draft
**Scope:** Hub-scoped flat teams, team membership, three assignment mechanisms (direct, auto from call handling, bulk), and extension of the PBAC `-assigned` scope resolver to include team membership.
**Depends on:** Volunteer → User rename (2026-03-29), PBAC Scope Hierarchy (2026-03-30)

---

## Rationale

The PBAC spec introduces `-assigned` scope with an extensible assignment resolver. Without teams, "assigned" means direct personal assignment — a Hub Admin assigns a contact to a specific Case Manager. This works for small-scale operations but breaks down at mass defense scale (Standing Rock: 800+ cases, multiple jail support / legal / mass defense teams needing different subsets of contact data).

Teams solve this by making assignment group-based: a contact assigned to the "Legal - Immigration" team is visible to every Case Manager on that team. When a volunteer on the "Jail Support" team handles a call, the resulting contact automatically becomes visible to the whole team.

---

## 1. Data Model

### `teams` table

```typescript
interface TeamsTable {
  id: string
  hubId: string
  encryptedName: Ciphertext              // hub-key encrypted
  encryptedDescription: Ciphertext | null // hub-key encrypted
  createdBy: string                       // pubkey
  createdAt: Date
  updatedAt: Date
}
```

Team names are organizational metadata — hub-key encrypted, same tier as role names, shift names, ring group names. A seized database reveals "hub X has 4 teams" but not what they're called.

### `team_members` table

```typescript
interface TeamMembersTable {
  teamId: string       // FK → teams.id
  userPubkey: string   // FK → users.pubkey
  addedBy: string      // pubkey of admin who added them
  createdAt: Date
}
```

Composite primary key: `(teamId, userPubkey)`. A user can be on multiple teams within the same hub.

### `contact_team_assignments` table

```typescript
interface ContactTeamAssignmentsTable {
  id: string
  contactId: string    // FK → contacts.id
  teamId: string       // FK → teams.id
  hubId: string        // denormalized for efficient queries
  assignedBy: string   // pubkey or 'auto'
  createdAt: Date
}
```

Unique constraint: `(contactId, teamId)` — a contact can only be assigned to the same team once.

The `assignedBy` field distinguishes manual admin assignment from automatic assignment via call/conversation handling. `'auto'` means the system assigned it because a team member handled an interaction with this contact.

### Indexes

```sql
CREATE INDEX team_members_user_idx ON team_members (user_pubkey);
CREATE INDEX contact_team_assignments_contact_idx ON contact_team_assignments (contact_id);
CREATE INDEX contact_team_assignments_team_idx ON contact_team_assignments (team_id);
CREATE INDEX contact_team_assignments_hub_idx ON contact_team_assignments (hub_id);
```

---

## 2. Assignment Mechanisms

### Direct assignment

Hub Admin assigns contacts to teams via the UI. Creates a `contact_team_assignments` row with `assignedBy = adminPubkey`.

Available from:
- Contact profile page: team assignment dropdown
- Team detail page: "Add contacts" action

### Auto-assignment from call/conversation handling

When a user handles a call or conversation that creates or links a contact, and that user is on one or more teams, the contact is automatically assigned to those teams.

Flow:
1. Call/conversation linked to a contact (auto via phone HMAC or manual)
2. Look up the handling user's team memberships: `SELECT team_id FROM team_members WHERE user_pubkey = $handler`
3. For each team, check if assignment already exists: `SELECT 1 FROM contact_team_assignments WHERE contact_id = $contact AND team_id = $team`
4. If not, insert with `assignedBy = 'auto'`

This runs in the existing auto-linking flow, after `contact_call_links` / `contact_conversation_links` row creation.

### Bulk assignment

Admin selects multiple contacts in the contact directory and assigns them to a team in one operation. Uses the bulk operations API pattern.

Flow:
1. Admin selects contacts in directory → clicks "Assign to Team" in bulk toolbar
2. Team picker dropdown
3. `POST /api/teams/:id/contacts` with `{ contactIds: string[] }`
4. Server creates `contact_team_assignments` rows for each, skipping duplicates
5. Returns `{ assigned: number, skipped: number }` (skipped = already assigned)

---

## 3. Assignment Resolver Extension

The PBAC spec defines `AssignmentResolver` with a default contacts resolver. Teams extend this resolver to include team membership in the `-assigned` scope check.

### Updated contacts assignment resolver

```typescript
class ContactsAssignmentResolver implements AssignmentResolver {
  async isAssigned(check: AssignmentCheck): Promise<boolean> {
    const { resourceId: contactId, userPubkey, hubId } = check

    // Direct personal assignment
    const contact = await db.select().from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.hubId, hubId)))
      .limit(1)
    if (contact[0]?.createdBy === userPubkey) return true
    if (contact[0]?.assignedTo === userPubkey) return true

    // Linked via call handling
    const callLink = await db.select().from(contactCallLinks)
      .innerJoin(callLegs, eq(callLegs.callId, contactCallLinks.callId))
      .where(and(
        eq(contactCallLinks.contactId, contactId),
        eq(callLegs.userPubkey, userPubkey),
      ))
      .limit(1)
    if (callLink.length > 0) return true

    // Team-based assignment
    const teamAssignment = await db.select().from(contactTeamAssignments)
      .innerJoin(teamMembers, eq(teamMembers.teamId, contactTeamAssignments.teamId))
      .where(and(
        eq(contactTeamAssignments.contactId, contactId),
        eq(teamMembers.userPubkey, userPubkey),
      ))
      .limit(1)
    if (teamAssignment.length > 0) return true

    return false
  }

  async listAssignedIds(userPubkey: string, hubId: string): Promise<string[]> {
    // Union of: created by user, assigned to user, linked via calls, team-assigned
    const results = await db.execute(sql`
      SELECT DISTINCT c.id FROM contacts c
      WHERE c.hub_id = ${hubId}
      AND (
        c.created_by = ${userPubkey}
        OR c.assigned_to = ${userPubkey}
        OR c.id IN (
          SELECT ccl.contact_id FROM contact_call_links ccl
          JOIN call_legs cl ON cl.call_id = ccl.call_id
          WHERE cl.user_pubkey = ${userPubkey}
        )
        OR c.id IN (
          SELECT cta.contact_id FROM contact_team_assignments cta
          JOIN team_members tm ON tm.team_id = cta.team_id
          WHERE tm.user_pubkey = ${userPubkey}
        )
      )
    `)
    return results.rows.map(r => r.id as string)
  }
}
```

A Case Manager with `contacts:read-assigned` automatically sees all contacts assigned to any team they're on. No permission model changes — the `-assigned` scope just resolves to a larger set of contacts.

---

## 4. API

```
GET    /api/teams                          → list teams for current hub
POST   /api/teams                          → create team
PATCH  /api/teams/:id                      → update team (encrypted name, description)
DELETE /api/teams/:id                      → delete team

GET    /api/teams/:id/members              → list team members
POST   /api/teams/:id/members              → add members { pubkeys: string[] }
DELETE /api/teams/:id/members/:pubkey      → remove member

GET    /api/teams/:id/contacts             → list contacts assigned to team
POST   /api/teams/:id/contacts             → assign contacts { contactIds: string[] }
DELETE /api/teams/:id/contacts/:contactId  → unassign contact
```

All endpoints are hub-scoped (hub ID from auth context).

### Response shapes

**Team list:**
```typescript
{
  id: string
  hubId: string
  encryptedName: Ciphertext
  encryptedDescription: Ciphertext | null
  memberCount: number
  contactCount: number
  createdAt: string
}
```

Client decrypts name/description with hub key after PIN unlock.

**Team members:**
```typescript
{
  userPubkey: string
  encryptedName: Ciphertext  // from users table
  nameEnvelopes: RecipientEnvelope[]
  addedBy: string
  createdAt: string
}
```

---

## 5. Permissions

No new permission domain. Teams are managed under existing domains:

| Action | Permission Required |
|--------|-------------------|
| View teams and members | `users:read` |
| Create / edit / delete teams | `users:manage-roles` |
| Add / remove team members | `users:manage-roles` |
| View contacts assigned to a team | `contacts:read-assigned` (team membership satisfies `-assigned`) |
| Assign contacts to teams | `contacts:update-assigned` or `contacts:update-all` |
| Bulk assign contacts to teams | Same as single assign |

The rationale for `users:manage-roles`: team management is an admin operation that affects how users access data. It's structurally similar to role assignment — both control what a user can see.

---

## 6. Frontend

### Team management

Accessible from the Users/Settings section. A new `/teams` route (or `/settings/teams`).

**Team list page:**
- Table: team name (decrypted), member count, contact count, created date
- "New Team" button → create dialog (name, description)
- Row click → team detail page

**Team detail page:**
- Header: team name, description (editable inline)
- **Members tab**: list of team members with "Add Members" button (user multi-select) and remove action per member
- **Contacts tab**: list of contacts assigned to this team, with assignment type badge (`auto` / admin name). "Assign Contacts" button for manual assignment.

### Contact directory integration

**Team filter** in the contact directory filter bar:
- Dropdown of teams the current user belongs to (or all teams for admins)
- Server-side filtering via `JOIN contact_team_assignments`
- Combines with existing filters (type, risk level, tags)

### Contact profile

**"Teams" section** on the contact card:
- List of teams this contact is assigned to (badges)
- "Assign to Team" dropdown for users with `contacts:update-assigned` or `contacts:update-all`
- "Unassign" action per team badge

### User profile

**"Teams" section:**
- List of teams the user belongs to (read-only for the user, editable by admins)

### Bulk toolbar

When contacts are selected in the directory, the bulk toolbar includes:
- "Assign to Team" action → team picker → bulk assignment

---

## 7. Encryption

| Field | Encryption | Rationale |
|-------|-----------|-----------|
| `teams.encryptedName` | Hub-key E2EE | Org metadata — "Legal Team" reveals org structure |
| `teams.encryptedDescription` | Hub-key E2EE | Same |
| `team_members.*` | Plaintext | Structural — pubkey + team ID. Pubkeys are pseudonymous. |
| `contact_team_assignments.*` | Plaintext | Structural — contact ID + team ID. Neither reveals PII. |

The assignment tables are intentionally plaintext to enable efficient server-side queries (the assignment resolver JOIN). The actual contact data they point to is E2EE — knowing "contact X is assigned to team Y" reveals nothing about who that contact is.

---

## 8. Cascade Behavior

**Team deletion:**
1. All `team_members` rows for the team are deleted
2. All `contact_team_assignments` rows for the team are deleted
3. The team row is deleted
4. Audit log entry

Contacts themselves are NOT affected — they remain in the hub, just no longer assigned to this team.

**User removal from team:**
1. `team_members` row deleted
2. `contact_team_assignments` rows where `assignedBy = 'auto'` AND the auto-assignment was due to this user's handling are NOT retroactively removed (the contact is still relevant to the team)
3. The user simply loses `-assigned` scope access to team contacts via this team (they may still have access via other teams or direct assignment)

**Contact deletion (soft):**
1. `contact_team_assignments` rows remain (for audit trail)
2. Deleted contacts are filtered out of team contact lists

---

## 9. React Query Integration

```typescript
// Query keys
queryKeys.teams = {
  all: ['teams'] as const,
  list: (hubId: string) => ['teams', 'list', hubId] as const,
  detail: (id: string) => ['teams', 'detail', id] as const,
  members: (id: string) => ['teams', 'members', id] as const,
  contacts: (id: string) => ['teams', 'contacts', id] as const,
}
```

Mutations invalidate relevant queries:
- Create/update/delete team → invalidate `teams.list`
- Add/remove member → invalidate `teams.members(id)` + `teams.detail(id)`
- Assign/unassign contact → invalidate `teams.contacts(id)` + `contacts.list` (assignment changes what contacts a user sees)

---

## 10. Testing

- Team CRUD: create, update, delete with hub-key encrypted names
- Membership: add/remove members, verify team list per user
- Direct assignment: assign contact to team, verify visibility for team members
- Auto-assignment: user on team handles a call → contact auto-assigned to team
- Bulk assignment: assign multiple contacts to a team in one operation
- Assignment resolver: user with `contacts:read-assigned` sees team-assigned contacts
- Scope isolation: user NOT on a team does NOT see that team's contacts via `-assigned`
- Hub isolation: teams in hub A are invisible to hub B
- Cascade: team deletion removes assignments, not contacts
- Permission checks: only admins can create/edit teams and manage membership

---

## 11. Scope — What This Spec Does NOT Cover

- **Hierarchical teams** (sub-teams, nesting) — future enhancement. Flat teams with multi-membership cover current use cases.
- **Per-team permission overrides** — teams are assignment groups, not permission groups. User capabilities come from their hub roles.
- **Rule-based auto-assignment** (e.g., "all contacts tagged `detained` → Jail Support team") — future enhancement.
- **Ring group ↔ team mapping** — future. Currently auto-assignment works because users are on teams and handle calls. Explicit ring group → team binding would formalize this.
- **Cross-hub teams** — out of scope. Each hub's teams are isolated.
- **Team-scoped views / dashboards** — future. For now, the contact directory team filter provides team-scoped viewing.
