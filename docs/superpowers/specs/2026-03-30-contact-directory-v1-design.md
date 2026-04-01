# Contact Directory v1 — Design Spec (Revised)

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** Draft
**Scope:** Canonical reference for the contact directory feature — documents the existing implementation and defines remaining work for PBAC alignment, team integration, assignment workflows, and UI/test completeness.
**Depends on:** Volunteer → User rename (2026-03-29), PBAC Scope Hierarchy (2026-03-30), Teams & Assignment (2026-03-30)

---

## Implementation Status

| Layer | Status | Notes |
|-------|--------|-------|
| Database schema | **Complete** | `contacts`, `contact_relationships`, `contact_call_links`, `contact_conversation_links` tables with tiered E2EE |
| Server routes | **Complete** | Full CRUD, timeline, dedup, hash-phone, relationships, link/unlink, recipients |
| Server service | **Complete** | ContactsService with all operations |
| Crypto labels | **Complete** | `LABEL_CONTACT_SUMMARY`, `LABEL_CONTACT_PII`, `LABEL_CONTACT_RELATIONSHIP`, `LABEL_CONTACT_ID` |
| Client API functions | **Complete** | All endpoints wrapped in `api.ts` |
| React Query hooks | **Complete** | `useContacts`, `useContact`, `useContactTimeline`, `useContactRelationships`, `useDeleteContact` |
| Contact directory page | **Complete** | Search, type/risk filters, create dialog, navigation to profile |
| Contact profile page | **Complete** | Sidebar (summary, PII, relationships) + timeline, delete action |
| Create contact dialog | **Complete** | Tiered encryption, dedup check, phone HMAC |
| Contact select component | **Complete** | Searchable dropdown for linking contacts |
| Contact timeline component | **Complete** | Calls, conversations, notes timeline |
| Contact relationship section | **Complete** | E2EE relationships with display |
| API tests | **Complete** | `contacts.spec.ts`, `contacts-permissions.spec.ts`, `contacts-directory.spec.ts` |
| UI E2E tests | **Complete** | `contacts.spec.ts` |
| Integration tests | **Complete** | `contacts.integration.test.ts` |

---

## 1. Security Model: E2EE Contact Encryption (Implemented)

All contact data is encrypted with ECIES envelopes. The server never decrypts contact data.

### Tier 1 — Summary

ECIES envelopes for all pubkeys with summary-tier permission.

Contains:
- `displayName` — pseudonym or initials
- `notes` — brief status notes (max 500 chars)

### Tier 2 — PII

ECIES envelopes for all pubkeys with full-tier permission.

Per-field encrypted:
- `fullName`
- `phoneNumbers: { label: string, number: string }[]` (primary drives `identifierHash`)

Blob encrypted (single `encryptedPII` payload):
- `emailAddresses: string[]`
- `address: string`
- `dateOfBirth: string`
- `identifiers: { label: string, value: string }[]`

### Relationships — Fully E2EE

Encrypted payload per relationship containing `fromContactId`, `toContactId`, `relationship`, and `isEmergency`. Client decrypts all relationships and reconstructs the graph in memory.

### Plaintext Fields (Server-Queryable)

- `contactType` — `caller | partner-org | referral-resource | other`
- `riskLevel` — `low | medium | high | critical`
- `tags: string[]` — JSONB array of tag slugs
- `identifierHash` — HMAC of primary phone number

---

## 2. Data Model (Implemented)

### `contacts` table

```typescript
interface ContactsTable {
  id: string
  hubId: string

  // Plaintext (queryable)
  contactType: ContactType
  riskLevel: RiskLevel
  tags: string[]
  identifierHash: HmacHash | null

  // Tier 1 — per-field ECIES
  encryptedDisplayName: Ciphertext
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes: Ciphertext | null
  notesEnvelopes: RecipientEnvelope[]

  // Tier 2 — per-field ECIES
  encryptedFullName: Ciphertext | null
  fullNameEnvelopes: RecipientEnvelope[]
  encryptedPhone: Ciphertext | null
  phoneEnvelopes: RecipientEnvelope[]

  // Tier 2 — blob ECIES
  encryptedPII: Ciphertext | null
  piiEnvelopes: RecipientEnvelope[]

  // Metadata
  createdBy: string
  createdAt: Date
  updatedAt: Date
  lastInteractionAt: Date | null
  deletedAt: Date | null
}
```

### `contact_relationships` table (Implemented)

Fully E2EE payload per relationship. Server sees only `hubId` and structural metadata.

### `contact_call_links` / `contact_conversation_links` tables (Implemented)

Link contacts to calls and conversations. `linkedBy` is pubkey or `'auto'` for auto-linked via phone HMAC.

---

## 3. Auto-Linking (Implemented)

When an inbound call or message arrives:
1. Server HMACs the caller/sender phone number
2. Queries contacts by `identifierHash`
3. If match: creates a link row with `linkedBy = 'auto'`
4. Real-time Nostr event notifies clients
5. Volunteer's UI shows linked contact display name

---

## 4. API (Implemented)

```
GET    /api/contacts                         → list (paginated, filtered by type/risk)
GET    /api/contacts/:id                     → single contact (all encrypted fields)
POST   /api/contacts                         → create (encrypted payload from client)
PATCH  /api/contacts/:id                     → update (re-encrypted fields)
DELETE /api/contacts/:id                     → soft delete

GET    /api/contacts/:id/timeline            → calls, conversations, notes linked to contact
POST   /api/contacts/:id/link               → manually link call/conversation/report
GET    /api/contacts/check-duplicate         → dedup check by phone HMAC
POST   /api/contacts/hash-phone             → server-side phone HMAC for dedup
GET    /api/contacts/recipients              → envelope recipients for current hub

GET    /api/contacts/relationships           → all relationships for hub (E2EE)
POST   /api/contacts/relationships           → create relationship
DELETE /api/contacts/relationships/:id       → delete relationship
```

---

## 5. Frontend (Implemented)

### Contact Directory Page (`/contacts`)

Table view with:
- Search bar (client-side on decrypted display names)
- Type filter dropdown (server-side)
- Risk level filter dropdown (server-side)
- "New Contact" button → create dialog
- Row click → navigate to profile
- Risk level badges, tag badges, last interaction timestamp

### Contact Profile Page (`/contacts/:contactId`)

Sidebar + timeline layout (responsive):
- **Header**: display name, risk badge, delete button
- **Summary card** (Tier 1): type, risk level, tags, notes
- **PII card** (Tier 2): full name, phone — gated by `contacts:read-pii` permission, shows lock icon when no access
- **Relationships section**: support contacts with relationship type, linked contact names
- **Timeline**: calls, conversations, notes in chronological order

### Create Contact Dialog

- Tier 1 fields: display name, contact type, risk level, tags, notes
- Tier 2 fields: full name, phone number (with dedup check)
- Phone HMAC for `identifierHash`
- Dedup warning on match

### Components

- `ContactSelect` — searchable dropdown for linking contacts to calls/conversations
- `ContactRelationshipSection` — displays and manages E2EE relationships
- `ContactTimeline` — unified chronological timeline

---

## 6. Remaining Work: PBAC Alignment

### Permission renames

All existing permission checks in contact routes and client code must update:

| Old Permission | New Permission |
|---------------|---------------|
| `contacts:read-summary` | `contacts:envelope-summary` |
| `contacts:read-pii` | `contacts:envelope-full` |

### Add scope enforcement

Contact routes currently check tier permissions but not scope. Add scope-based filtering:

**`GET /api/contacts`** — filter results by scope:
- `contacts:read-own`: only contacts where `createdBy = currentUser` or linked to user's calls/conversations or assigned to user's teams
- `contacts:read-assigned`: contacts matching the assignment resolver (direct + team-based)
- `contacts:read-all`: all contacts in the hub

**`PATCH /api/contacts/:id`** — check update scope:
- `contacts:update-own`: only if `createdBy = currentUser`
- `contacts:update-assigned`: only if assignment resolver returns true
- `contacts:update-all`: any contact

**`DELETE /api/contacts/:id`** — check `contacts:delete` + scope (same as update scope)

### Envelope recipient updates

When encrypting contact data, the recipient list is determined by tier permissions:
- Tier 1 envelopes → all pubkeys in the hub with `contacts:envelope-summary`
- Tier 2 envelopes → all pubkeys with `contacts:envelope-full`

The existing `GET /api/contacts/recipients` endpoint returns these lists. It must be updated to use the new permission names.

### Client permission checks

Update all `hasPermission('contacts:read-pii')` calls to `hasPermission('contacts:envelope-full')` etc.

### Tests

- Update permission test assertions for renamed permissions
- Add scope enforcement tests (user with `read-own` can't see others' contacts)
- Add scope + tier combination tests (user with `read-assigned` + `envelope-summary` sees display names for assigned contacts but not PII)

---

## 7. Remaining Work: `assignedTo` Field

Add an `assignedTo` column to the contacts table:

```typescript
assignedTo: text('assigned_to')  // pubkey of assigned case manager (nullable)
```

### Schema migration

```sql
ALTER TABLE contacts ADD COLUMN assigned_to TEXT;
CREATE INDEX contacts_assigned_to_idx ON contacts (assigned_to) WHERE assigned_to IS NOT NULL;
```

### API changes

- `POST /api/contacts` and `PATCH /api/contacts/:id` accept `assignedTo` field
- `GET /api/contacts` supports `assignedTo` filter parameter
- Assignment requires `contacts:update-assigned` or `contacts:update-all`

### UI changes

- Contact profile: "Assigned to" field showing the assigned user (decrypted name)
- Assignment dropdown for admins/case managers with appropriate permissions
- Contact directory: "Assigned to me" quick filter

---

## 8. Remaining Work: Team Integration

### Contact profile

- **"Teams" section**: list of teams this contact is assigned to (badges)
- "Assign to Team" dropdown for users with `contacts:update-assigned` or higher
- "Unassign" action per team badge

### Contact directory

- **Team filter** dropdown in the filter bar
- Server-side filtering via `JOIN contact_team_assignments`
- "My Teams" quick filter showing contacts assigned to any of the current user's teams

### Auto-assignment

When a user handles a call/conversation linked to a contact, and the user is on teams:
1. Look up user's team memberships
2. Auto-assign the contact to those teams (if not already assigned)
3. `contact_team_assignments` row with `assignedBy = 'auto'`

This integrates with the existing auto-linking flow.

---

## 9. Remaining Work: Custom Field `visibleTo`

Replace the `showInVolunteerView` boolean on `customFieldDefinitions` (renamed to `showInUserView` by the Volunteer → User rename spec) with a permission-based visibility control:

```typescript
// Old (after rename spec)
showInUserView: boolean

// New
visibleTo: text('visible_to').notNull().default('contacts:envelope-summary')
```

Each custom field gets a permission string that gates its visibility. Default: `contacts:envelope-summary` (visible to anyone who can see the contact at all).

### Schema migration

```sql
-- Run after Volunteer → User rename spec has applied
ALTER TABLE custom_field_definitions ADD COLUMN visible_to TEXT NOT NULL DEFAULT 'contacts:envelope-summary';
ALTER TABLE custom_field_definitions DROP COLUMN show_in_user_view;
```

### UI

- Custom field editor: dropdown to select visibility level (human-readable labels from `PERMISSION_CATALOG`)
- Contact profile: only show custom fields the user has the required permission for

---

## 10. Remaining Work: Command Palette Integration

Add contact search results to the existing command palette (`Cmd+K`):

- Search contacts by decrypted display name (client-side, same as directory search)
- Show contact type icon, risk badge
- Select → navigate to contact profile

### Implementation

The command palette (`src/client/components/command-palette.tsx`) already supports multiple result types. Add a "Contacts" group that searches the cached contacts list (from React Query).

---

## 11. Remaining Work: UI Completeness

### Contact directory page

- **Tag filter** — currently no tag filtering in the UI. Add a tag multi-select filter that works with the Tag Management spec's `TagInput` component (server-side GIN index filtering).
- **Sort options** — sort by last interaction, created date, risk level, display name.
- **Pagination** — verify pagination is working and add page controls if missing.

### Contact profile page

- **Inline editing** — summary fields (display name, type, risk level, tags, notes) should be editable inline for users with `contacts:update-summary` + appropriate scope.
- **PII editing** — full name, phone, email, address fields editable for users with `contacts:update-pii` + appropriate scope.
- **Relationship creation** — "Add Support Contact" action that opens a mini-form to create a new contact and relationship.
- **"Add Report" button** — opens `ReportForm` pre-populated with this contact (from Contact Profile Actions spec).
- **Languages** — display and edit contact's known languages (for routing hints).

### Create contact dialog

- **Languages field** — add language multi-select using existing language config from `@shared/languages.ts`.
- **Custom fields** — render hub-configured custom fields gated by `visibleTo` permission.

---

## 12. Remaining Work: Tests

### API tests to add

- Scope enforcement: `contacts:read-own` user cannot fetch contacts created by others
- Scope enforcement: `contacts:read-assigned` user can fetch contacts assigned to them or their team
- `assignedTo` CRUD: assign, filter by assignee, unassign
- Team assignment: auto-assign on call handling, manual team assignment
- Permission rename: all existing tests use new permission names
- `visibleTo` custom field gating

### UI E2E tests to add

- Scope filtering: volunteer sees only own contacts, case manager sees assigned
- `assignedTo` UI: assign contact to case manager, verify visibility
- Team filter: filter contacts by team
- Command palette: search for a contact by name
- Inline editing: edit contact summary fields
- Tag filtering (after Tag Management spec lands)
- Relationship creation from profile page

### Unit tests to add

- Assignment resolver: direct assignment, team-based assignment, call-linked assignment
- Scope hierarchy interaction with contact filtering
- `visibleTo` permission check for custom fields

---

## 13. Scope — What This Spec Does NOT Cover

- **Tag management** (admin-defined vocabulary, colors, categories) — separate spec
- **Contact profile actions** (messaging, notify support contacts) — separate spec
- **Call-to-contact workflow** (create/link contacts from call detail) — separate spec
- **Post-call data entry** (intake forms, triage queue) — separate spec
- **Bulk operations** (multi-select, bulk tag/delete/message) — separate spec
- **Import/export & merging** — separate spec
- **Cross-hub contact sharing** — not planned
- **Fuzzy duplicate detection** (name similarity) — future
