# Contact Directory Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement five contact enhancement features: Contact Profile Actions (channels, notify, add report), Call-to-Contact Workflow (create/link from calls, transcript extraction), Post-Call Data Entry (intake forms, triage), Bulk Operations (multi-select, bulk tag/delete/message), and Import/Export & Merging.

**Architecture:** These features build on the existing contact directory, PBAC scope model, and teams infrastructure. Each task is an independent feature that can be implemented and tested in isolation.

**Tech Stack:** Drizzle ORM, Hono, React, React Query, shadcn/ui, bun:test, Playwright

**Prerequisites:** Volunteer → User rename, PBAC Scope Hierarchy, Teams & Assignment, Tag Management.

**Note on Combobox:** The Tag Management plan installs the shadcn `Combobox` component (multi-select with chips, searchable). This pattern should be used consistently:
- **TagInput** — multi-select tags with colored chips and freeform "Create" option
- **ContactSelect** — migrate from `Command` + `Popover` to `Combobox`. Add "Create new contact" option at bottom of dropdown so users can inline-create contacts from report forms, support contact fields, intake forms, etc. without leaving context.
- **UserMultiSelect** — migrate to `Combobox` for consistency
- **Command palette** — keep as-is (different interaction pattern, full-page overlay)

---

### Task 1: PBAC Alignment of Existing Contact Routes

**Files:**
- Modify: `src/server/routes/contacts.ts`
- Modify: `src/client/routes/contacts.tsx`
- Modify: `src/client/routes/contacts_.$contactId.tsx`
- Modify: `tests/api/contacts-permissions.spec.ts`

This is the foundation — update existing contact code to use the new PBAC permission names and scope enforcement.

- [ ] **Step 1: Replace old permission names in routes**

In `src/server/routes/contacts.ts`, replace:
- `contacts:read-summary` → `contacts:envelope-summary`
- `contacts:read-pii` → `contacts:envelope-full`

- [ ] **Step 2: Add scope enforcement to GET /api/contacts**

Import `ContactsAssignmentResolver` from Task 4 of PBAC plan. Filter contact list results by the user's scope level (`-own`, `-assigned`, `-all`).

- [ ] **Step 3: Add scope enforcement to PATCH and DELETE**

Verify the user's update/delete scope before allowing the operation.

- [ ] **Step 4: Update client permission checks**

Replace `hasPermission('contacts:read-pii')` → `hasPermission('contacts:envelope-full')` in all client components.

- [ ] **Step 5: Update permission tests**

Update `tests/api/contacts-permissions.spec.ts` for new permission names and scope tests.

- [ ] **Step 6: Run tests**

```bash
bun run typecheck && bunx playwright test tests/api/contacts-permissions.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/contacts.ts src/client/ tests/api/contacts-permissions.spec.ts
git commit -m "feat: align contact routes with PBAC scope and tier permission names"
```

---

### Task 2: Contact Channels & Notify Support Contacts

**Files:**
- Create: `src/server/routes/contacts-actions.ts`
- Modify: `src/client/routes/contacts_.$contactId.tsx`
- Create: `tests/api/contact-notify.spec.ts`

- [ ] **Step 1: Add notify endpoint**

Create `POST /api/contacts/:id/notify` in `contacts-actions.ts`:

```typescript
{
  notifications: Array<{
    contactId: string
    channel: { type: string; identifier: string }
    message: string
  }>
}
```

Routes through `MessagingAdapter` for each notification. Requires `contacts:envelope-full` + `conversations:send`.

- [ ] **Step 2: Add channels section to contact profile**

In the PII card, show `ContactChannel[]` from the encrypted PII blob. Display channel type icon, identifier, preferred badge.

- [ ] **Step 3: Add "Notify" button per support contact**

Gated by `contacts:envelope-full`. Opens message dialog with pre-filled template. Sends via notify endpoint.

- [ ] **Step 4: Add "Alert Emergency Contacts" bulk button**

Filters to `isEmergency: true` relationships only. Sends notification to each.

- [ ] **Step 5: Add "Add Report" button**

Opens existing `ReportForm` with `defaultValues: { contactId }`. Requires `reports:create`.

- [ ] **Step 6: Write API tests**

Create `tests/api/contact-notify.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/contacts-actions.ts src/server/app.ts src/client/ tests/api/contact-notify.spec.ts
git commit -m "feat: add contact channels, notify support contacts, add report from profile"
```

---

### Task 3: Call-to-Contact Workflow

**Files:**
- Modify: `src/server/routes/contacts.ts` (add `POST /api/contacts/from-call/:callId`)
- Modify: `src/client/routes/calls.$callId.tsx`
- Create: `src/client/lib/transcript-extraction.ts`
- Create: `src/client/lib/transcript-extraction.test.ts`
- Create: `tests/api/call-to-contact.spec.ts`

- [ ] **Step 1: Add from-call endpoint**

`POST /api/contacts/from-call/:callId` — creates contact + auto-links to call + auto-assigns to handler's teams in one step.

- [ ] **Step 2: Write transcript entity extraction**

Create `src/client/lib/transcript-extraction.ts`:

```typescript
export interface ExtractedEntity {
  type: 'phone' | 'name' | 'email' | 'address'
  value: string
  context: string
  confidence: 'high' | 'medium' | 'low'
  startOffset: number
  endOffset: number
}

export function extractContactEntities(text: string): ExtractedEntity[]
```

Client-side only — regex patterns for phone (E.164, US), email, names with relationship context.

- [ ] **Step 3: Write unit tests for extraction**

Create `src/client/lib/transcript-extraction.test.ts`:
- Phone number patterns (E.164, US formats, international)
- Email patterns
- Name+relationship ("his sister Maria", "lawyer named John")
- Confidence assignment
- No false positives on common words

- [ ] **Step 4: Update call detail page**

In `src/client/routes/calls.$callId.tsx`:
- Show linked contact name with link to profile (when linked)
- "Add as Contact" button → create contact dialog pre-populated
- "Link to Existing" button → `ContactSelect`
- "Unlink" action
- "Extract Contact Info" button below transcript → side panel with entities

- [ ] **Step 5: Add support contact quick-add**

"Add Support Contact" in notes section → mini-form creating contact + relationship.

- [ ] **Step 6: Write API and E2E tests**

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/contacts.ts src/client/ tests/
git commit -m "feat: add call-to-contact workflow with transcript extraction"
```

---

### Task 4: Post-Call Data Entry (Intake Forms & Triage)

**Files:**
- Create: `src/server/db/schema/intakes.ts`
- Create: `src/server/services/intakes.ts`
- Create: `src/server/routes/intakes.ts`
- Create: `src/client/routes/contacts.intakes.tsx`
- Create: `src/client/components/contacts/intake-form.tsx`
- Create: `src/client/lib/queries/intakes.ts`
- Modify: `src/shared/crypto-labels.ts` (add `LABEL_CONTACT_INTAKE`)
- Modify: `src/shared/permissions.ts` (add `contacts:triage`)
- Create: `tests/api/intakes.spec.ts`

- [ ] **Step 1: Add crypto label and permission**

In `src/shared/crypto-labels.ts`:
```typescript
export const LABEL_CONTACT_INTAKE = 'llamenos:contact-intake:v1'
```

In `src/shared/permissions.ts`, add to catalog:
```typescript
'contacts:triage': {
  label: 'Review and merge intake submissions into contact records',
  group: 'contacts',
  subgroup: 'actions',
},
```

Add to Case Manager and Hub Admin default roles.

- [ ] **Step 2: Create intakes schema**

Create `src/server/db/schema/intakes.ts`:
```typescript
export const contactIntakes = pgTable('contact_intakes', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull(),
  contactId: text('contact_id'),
  callId: text('call_id'),
  encryptedPayload: ciphertext('encrypted_payload').notNull(),
  payloadEnvelopes: jsonb<RecipientEnvelope[]>()('payload_envelopes').notNull().default([]),
  status: text('status').notNull().default('pending'), // pending | reviewed | merged | dismissed
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  submittedBy: text('submitted_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 3: Implement IntakesService and register in DI**

**CRITICAL:** Register in `src/server/services/index.ts`:
```typescript
// Add to Services interface:
intakes: IntakesService

// Add to createServices():
intakes: new IntakesService(db, crypto),
```

CRUD methods: `submitIntake`, `listIntakes` (filtered by status, scoped by permission), `getIntake`, `updateIntakeStatus` (review/merge/dismiss).

- [ ] **Step 4: Create API routes**

```
POST   /api/contacts/intakes              → submit
GET    /api/contacts/intakes              → list (requires contacts:triage for all, else own)
GET    /api/contacts/intakes/:id          → single
PATCH  /api/contacts/intakes/:id          → update status
GET    /api/contacts/:id/intakes          → intakes for contact
```

- [ ] **Step 5: Build intake form component**

Create `src/client/components/contacts/intake-form.tsx`:
- Freeform notes (required), caller name, phone, support contacts, situation, urgency
- Accessible from call detail page and contact profile
- Encrypts with envelopes for submitter + triage users

- [ ] **Step 6: Build triage queue page**

Create `src/client/routes/contacts.intakes.tsx`:
- Table: submitter, linked contact, urgency, timestamp
- Click → detail with side-by-side contact view
- Merge/dismiss actions
- Filter by status

- [ ] **Step 7: Write tests**

API tests for submission, listing, triage permission gating.
E2E tests for intake form and triage queue.

- [ ] **Step 8: Commit**

```bash
git add src/server/db/schema/intakes.ts src/server/services/intakes.ts src/server/routes/intakes.ts src/client/ src/shared/ tests/ drizzle/
git commit -m "feat: add post-call data entry with intake forms and triage queue"
```

---

### Task 5: Bulk Operations

**Files:**
- Modify: `src/server/routes/contacts.ts` (add bulk endpoints)
- Modify: `src/client/routes/contacts.tsx` (multi-select, bulk toolbar)
- Create: `tests/api/bulk-contacts.spec.ts`

- [ ] **Step 1: Add bulk API endpoints**

In `src/server/routes/contacts.ts`:

```
PATCH  /api/contacts/bulk     → { contactIds, addTags?, removeTags?, riskLevel? }
DELETE /api/contacts/bulk     → { contactIds }
POST   /api/contacts/blast    → { recipients: [{ contactId, channel, message }] }
```

Each endpoint enforces scope — filters `contactIds` to those within user's scope, returns `{ updated, skipped }`.

- [ ] **Step 2: Add multi-select to contact directory**

In `contacts.tsx`:
- Checkbox column on each row
- Select all / clear selection
- Bulk action toolbar (sticky, appears when 1+ selected)
- Actions: Tag, Untag, Set Risk Level, Assign to Team, Delete, Send Message

- [ ] **Step 3: Implement bulk action popovers**

- Tag: `TagInput` in popover
- Risk Level: radio buttons in popover
- Team: team picker dropdown
- Delete: confirm dialog
- Message: message textarea + recipient preview

- [ ] **Step 4: Write API and E2E tests**

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/contacts.ts src/client/routes/contacts.tsx tests/api/bulk-contacts.spec.ts
git commit -m "feat: add bulk operations — tag, risk level, team assign, delete, message"
```

---

### Task 6: Contact Import/Export & Merging

**Files:**
- Create: `src/server/routes/contacts-import.ts`
- Create: `src/client/routes/contacts.import.tsx`
- Create: `src/client/components/contacts/merge-dialog.tsx`
- Modify: `src/server/db/schema/contacts.ts` (add `mergedInto` column)
- Create: `tests/api/contact-import.spec.ts`

- [ ] **Step 1: Add mergedInto column**

```typescript
mergedInto: text('merged_into'), // ID of contact this was merged into
```

- [ ] **Step 2: Create import batch endpoint**

`POST /api/contacts/import` — accepts array of encrypted contact payloads. Returns `{ created, errors }`. Rate limited to 500 per batch. Requires `contacts:create` + `contacts:envelope-full` + `contacts:read-all`.

- [ ] **Step 3: Create merge endpoint**

`POST /api/contacts/:primaryId/merge` — merges secondary into primary. Re-links calls/conversations/notes. Soft-deletes secondary with `mergedInto`. Requires `contacts:update-all` + `contacts:envelope-full` + `contacts:delete`.

- [ ] **Step 4: Build import page**

`/contacts/import`:
- CSV upload (client-side parsing)
- Column mapping UI
- Preview rows
- Dedup check per row (phone HMAC)
- Progress bar
- Summary

- [ ] **Step 5: Build CSV export (client-side)**

Button on contacts page: decrypts all contacts, generates CSV in browser, triggers download. Requires `contacts:read-all` + `contacts:envelope-full`.

- [ ] **Step 6: Build merge dialog**

Accessible from contact profile: "Merge with..." → `ContactSelect` → side-by-side comparison → field selection → confirm.

- [ ] **Step 7: Write tests**

API tests for import batch and merge. E2E tests for import flow and merge UI.

- [ ] **Step 8: Commit**

```bash
git add src/server/ src/client/ tests/ drizzle/
git commit -m "feat: add contact import, export, and merge functionality"
```

---

### Task 7: Command Palette Integration

**Files:**
- Modify: `src/client/components/command-palette.tsx` (or find actual file name)

- [ ] **Step 1: Add contacts to command palette**

Add a "Contacts" group to the command palette:
- Search cached contacts by decrypted display name
- Show contact type icon, risk badge
- Select → navigate to `/contacts/:contactId`

Use the existing contacts query cache (from React Query) for instant search.

- [ ] **Step 2: Commit**

```bash
git add src/client/components/
git commit -m "feat: add contact search to command palette"
```

---

### Task 8: Custom Field visibleTo Permission

**Files:**
- Modify: `src/server/db/schema/settings.ts`
- Modify: `src/server/services/settings.ts`
- Modify: `src/server/routes/settings.ts`
- Modify: `src/client/routes/settings.tsx` (custom field editor)
- Modify: Contact profile components (field visibility gating)

- [ ] **Step 1: Migration — replace showInUserView with visibleTo**

```sql
ALTER TABLE custom_field_definitions ADD COLUMN visible_to TEXT NOT NULL DEFAULT 'contacts:envelope-summary';
ALTER TABLE custom_field_definitions DROP COLUMN show_in_user_view;
```

- [ ] **Step 2: Update service and routes**

Replace boolean checks with permission string checks throughout.

- [ ] **Step 3: Update custom field editor UI**

Add dropdown to select visibility permission (labels from `PERMISSION_CATALOG`).

- [ ] **Step 4: Update contact profile field rendering**

Only show custom fields the user has the required `visibleTo` permission for.

- [ ] **Step 5: Write tests and commit**

```bash
git add src/server/ src/client/ drizzle/ tests/
git commit -m "feat: replace showInUserView with visibleTo permission on custom fields"
```

---

### Task 9: Cross-Cutting Test Coverage Audit

Before final verification, ensure every feature has tests across all three suites:

- [ ] **Step 1: Unit test audit (bun:test)**

Verify these unit tests exist and pass:
- `src/client/lib/transcript-extraction.test.ts` — phone/email/name patterns, confidence levels
- `src/server/services/intakes.integration.test.ts` — CRUD, status transitions, envelope recipients
- `src/shared/permissions.test.ts` — `contacts:triage` in catalog, Case Manager includes it
- Channel resolution: preferred channel, fallback order, no-match error

```bash
bun run test:unit
```

- [ ] **Step 2: API test audit (Playwright, no browser)**

Verify these API tests exist and pass:
- `tests/api/contacts-permissions.spec.ts` — updated for `envelope-summary`/`envelope-full` names
- `tests/api/contact-notify.spec.ts` — notify endpoint, permission gating, messaging adapter routing
- `tests/api/call-to-contact.spec.ts` — from-call creation, support contact creation, team auto-assignment
- `tests/api/intakes.spec.ts` — submit, list (scoped), triage, merge, dismiss
- `tests/api/bulk-contacts.spec.ts` — bulk tag/untag/risk/delete/blast, scope enforcement, skipped counts
- `tests/api/contact-import.spec.ts` — batch import, dedup, merge, permission gating

```bash
bun run test:api
```

- [ ] **Step 3: UI E2E test audit (Playwright, Chromium)**

Verify these E2E tests exist and pass:
- `tests/ui/contacts.spec.ts` — updated for scope filtering (volunteer sees own, case manager sees assigned)
- Contact profile: notify button visible/hidden, alert emergency, add report, channels section
- Call detail: add-as-contact, link-to-existing, unlink, transcript extraction panel
- Intake: volunteer submits from call detail, case manager triages in queue, merge workflow
- Bulk: multi-select, toolbar actions, scope enforcement (can't bulk-edit unowned contacts)
- Import: CSV upload → column mapping → dedup preview → import complete
- Merge: side-by-side comparison → field selection → merged result
- Command palette: search contacts by name, navigate to profile

```bash
bun run test:e2e
```

- [ ] **Step 4: Full verification**

```bash
bun run typecheck && bun run build && bun run lint
bun run test:all
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "test: comprehensive contact enhancement test coverage"
```
