# Teams & Team-Based Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hub-scoped flat teams with three assignment mechanisms (direct, auto from call handling, bulk) and extend the PBAC `-assigned` scope resolver to include team membership.

**Architecture:** New `teams`, `team_members`, and `contact_team_assignments` tables. Team names hub-key encrypted. Assignment resolver wraps existing `ContactsAssignmentResolver` to add team membership checks. Auto-assignment hooks into existing call/conversation linking flow.

**Tech Stack:** Drizzle ORM, Hono, React, React Query, shadcn/ui, bun:test, Playwright

**Prerequisite:** Volunteer → User rename + PBAC Scope Hierarchy plans must be completed first.

---

### Task 1: Database Schema — Teams Tables

**Files:**
- Create: `src/server/db/schema/teams.ts`
- Modify: `src/server/db/schema/index.ts` (barrel export)
- Create: `drizzle/migrations/XXXX_teams.sql`

- [ ] **Step 1: Define Drizzle schema**

Create `src/server/db/schema/teams.ts`:

```typescript
import { jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { Ciphertext, RecipientEnvelope } from '@shared/crypto-types'
import { ciphertext } from '../crypto-columns'

export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull(),
  encryptedName: ciphertext('encrypted_name').notNull(),
  encryptedDescription: ciphertext('encrypted_description'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const teamMembers = pgTable('team_members', {
  teamId: text('team_id').notNull(),
  userPubkey: text('user_pubkey').notNull(),
  addedBy: text('added_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.teamId, table.userPubkey] }),
])

export const contactTeamAssignments = pgTable('contact_team_assignments', {
  id: text('id').primaryKey(),
  contactId: text('contact_id').notNull(),
  teamId: text('team_id').notNull(),
  hubId: text('hub_id').notNull(),
  assignedBy: text('assigned_by').notNull(), // pubkey or 'auto'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('contact_team_unique').on(table.contactId, table.teamId),
])
```

- [ ] **Step 2: Generate migration**

Run: `bun run migrate:generate`
Verify migration creates all three tables with correct indexes.

- [ ] **Step 3: Add barrel export**

In `src/server/db/schema/index.ts`, add:
```typescript
export * from './teams'
```

- [ ] **Step 4: Run migration**

Run: `bun run migrate`

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/teams.ts src/server/db/schema/index.ts drizzle/
git commit -m "feat: add teams, team_members, contact_team_assignments schema"
```

---

### Task 2: Teams Service

**Files:**
- Create: `src/server/services/teams.ts`
- Create: `src/server/services/teams.integration.test.ts`

- [ ] **Step 1: Write integration test scaffolding**

Create `src/server/services/teams.integration.test.ts` with tests for:
- Create team with hub-key encrypted name
- List teams for hub
- Update team name
- Delete team (cascades members + assignments)
- Add/remove members
- Assign/unassign contacts to teams
- Bulk assign contacts
- Auto-assign on call linking (when handler is on team)

- [ ] **Step 2: Implement TeamsService**

Create `src/server/services/teams.ts`:
- `createTeam(hubId, encryptedName, encryptedDescription, createdBy)`
- `listTeams(hubId)` — with member/contact counts
- `updateTeam(id, data)`
- `deleteTeam(id)` — cascade delete members + assignments
- `addMembers(teamId, pubkeys, addedBy)`
- `removeMember(teamId, pubkey)`
- `listMembers(teamId)`
- `assignContacts(teamId, contactIds, hubId, assignedBy)`
- `unassignContact(teamId, contactId)`
- `listTeamContacts(teamId)`
- `autoAssignForUser(contactId, userPubkey, hubId)` — look up user's teams, assign contact to each

- [ ] **Step 3: Run tests**

Run: `bun test src/server/services/teams.integration.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/server/services/teams.ts src/server/services/teams.integration.test.ts
git commit -m "feat: add TeamsService with CRUD, membership, and assignment"
```

---

### Task 3: Extend Assignment Resolver for Teams

**Files:**
- Modify: `src/server/lib/assignment-resolver.ts`
- Modify: `src/server/lib/assignment-resolver.test.ts`

- [ ] **Step 1: Write tests for team-based assignment**

Add to `assignment-resolver.test.ts`:
```typescript
test('isAssigned returns true when contact assigned to users team', async () => {
  // Setup: create team, add user, assign contact to team
  // Assert: isAssigned returns true
})

test('listAssignedIds includes team-assigned contacts', async () => {
  // Setup: create team, add user, assign contacts to team
  // Assert: listAssignedIds includes those contacts
})
```

- [ ] **Step 2: Update ContactsAssignmentResolver**

Add team membership check to both `isAssigned` and `listAssignedIds`:

```typescript
// In isAssigned, add after call link check:
const teamLink = await this.db.execute(sql`
  SELECT 1 FROM contact_team_assignments cta
  JOIN team_members tm ON tm.team_id = cta.team_id
  WHERE cta.contact_id = ${contactId} AND tm.user_pubkey = ${userPubkey}
  LIMIT 1
`)
if (teamLink.rows.length > 0) return true

// In listAssignedIds, add to the UNION:
OR c.id IN (
  SELECT cta.contact_id FROM contact_team_assignments cta
  JOIN team_members tm ON tm.team_id = cta.team_id
  WHERE tm.user_pubkey = ${userPubkey}
)
```

- [ ] **Step 3: Run tests**

Run: `bun test src/server/lib/assignment-resolver.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/server/lib/assignment-resolver.ts src/server/lib/assignment-resolver.test.ts
git commit -m "feat: extend assignment resolver with team membership checks"
```

---

### Task 4: Teams API Routes

**Files:**
- Create: `src/server/routes/teams.ts`
- Create: `tests/api/teams.spec.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Create teams route file**

Create `src/server/routes/teams.ts` with endpoints per spec:
- `GET /api/teams` — list teams for hub
- `POST /api/teams` — create team (requires `users:manage-roles`)
- `PATCH /api/teams/:id` — update team
- `DELETE /api/teams/:id` — delete team
- `GET /api/teams/:id/members` — list members
- `POST /api/teams/:id/members` — add members
- `DELETE /api/teams/:id/members/:pubkey` — remove member
- `GET /api/teams/:id/contacts` — list assigned contacts
- `POST /api/teams/:id/contacts` — assign contacts
- `DELETE /api/teams/:id/contacts/:contactId` — unassign

- [ ] **Step 2: Wire into app.ts**

```typescript
import teamsRoutes from './routes/teams'
authenticated.route('/teams', teamsRoutes)
```

- [ ] **Step 3: Write API tests**

Create `tests/api/teams.spec.ts` covering all endpoints, permission gating, cascade behavior.

- [ ] **Step 4: Run tests**

Run: `bunx playwright test tests/api/teams.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/teams.ts src/server/app.ts tests/api/teams.spec.ts
git commit -m "feat: add teams API routes with full CRUD and assignment"
```

---

### Task 5: Auto-Assignment Hook

**Files:**
- Modify: `src/server/services/contacts.ts` (link methods)
- Modify: `src/server/services/contacts.integration.test.ts`

- [ ] **Step 1: Hook auto-assignment into contact linking**

In `ContactsService.linkCall()` and `linkConversation()`, after creating the link row:

```typescript
// After creating contact_call_links row:
await this.services.teams.autoAssignForUser(contactId, linkedBy === 'auto' ? userPubkey : linkedBy, hubId)
```

The `autoAssignForUser` method (from Task 2) looks up the user's teams and creates `contact_team_assignments` rows with `assignedBy = 'auto'`.

- [ ] **Step 2: Write test for auto-assignment**

Add to `contacts.integration.test.ts`:
```typescript
test('linking a call auto-assigns contact to handlers teams', async () => {
  // Setup: create team, add user to team, create contact, link call
  // Assert: contact_team_assignments row exists for that team
})
```

- [ ] **Step 3: Run tests**

Run: `bun test src/server/services/contacts.integration.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/server/services/contacts.ts src/server/services/contacts.integration.test.ts
git commit -m "feat: auto-assign contacts to handler's teams on call/conversation link"
```

---

### Task 6: Teams Frontend — React Query & UI

**Files:**
- Create: `src/client/lib/queries/teams.ts`
- Modify: `src/client/lib/queries/keys.ts`
- Modify: `src/client/lib/api.ts`
- Create: `src/client/routes/teams.tsx` (or integrate into settings)
- Modify: `src/client/routes/contacts.tsx` (team filter)
- Modify: `src/client/routes/contacts_.$contactId.tsx` (team badges)
- Create: `tests/ui/teams.spec.ts`

- [ ] **Step 1: Add API functions and query hooks**

Add to `api.ts`: `listTeams`, `createTeam`, `updateTeam`, `deleteTeam`, `listTeamMembers`, `addTeamMembers`, `removeTeamMember`, `assignTeamContacts`, `unassignTeamContact`.

Create `src/client/lib/queries/teams.ts` with React Query hooks.

Add to `keys.ts`:
```typescript
teams: {
  all: ['teams'] as const,
  list: (hubId: string) => ['teams', 'list', hubId] as const,
  detail: (id: string) => ['teams', 'detail', id] as const,
  members: (id: string) => ['teams', 'members', id] as const,
  contacts: (id: string) => ['teams', 'contacts', id] as const,
},
```

- [ ] **Step 2: Build team management UI**

Create team list page or settings section with:
- Team table (name, member count, contact count)
- Create/edit team dialog
- Team detail: member management, contact assignment

- [ ] **Step 3: Add team filter to contact directory**

In `contacts.tsx`, add a team filter dropdown in the filter bar. Server-side filtering via query parameter.

- [ ] **Step 4: Add team badges to contact profile**

In `contacts_.$contactId.tsx`, show team assignments with assign/unassign actions.

- [ ] **Step 5: Write E2E test**

Create `tests/ui/teams.spec.ts` covering:
- Create team, add member, assign contact
- Team filter in contact directory
- Team badges on contact profile

- [ ] **Step 6: Run all tests**

```bash
bun run typecheck && bun run build
bunx playwright test tests/ui/teams.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/client/ tests/ui/teams.spec.ts
git commit -m "feat: add teams UI — management, contact filter, profile badges"
```
