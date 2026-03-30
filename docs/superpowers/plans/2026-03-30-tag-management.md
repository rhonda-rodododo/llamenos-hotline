# Tag Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace freeform string tags with a managed tag system — admin-defined vocabulary with colors, categories, autocomplete, hub-key encrypted metadata, GIN index filtering, and permission-gated freeform creation.

**Architecture:** New `tags` table with hub-key encrypted labels/categories and plaintext slugs/colors. Contacts continue to store tag slugs as `string[]` JSONB (no joins needed for filtering). GIN index enables efficient server-side tag queries. `TagInput` component replaces freeform text input. `strictTags` hub setting controls whether users can create new tags.

**Tech Stack:** Drizzle ORM, Hono, React, React Query, shadcn/ui (Combobox — multi-select with chips), bun:test, Playwright

**Prerequisite:** PBAC Scope Hierarchy plan (for `tags:create` permission).

---

### Task 1: Database Schema & Migration

**Files:**
- Create: `src/server/db/schema/tags.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/db/schema/settings.ts` (add `strictTags` to hub settings)

- [ ] **Step 1: Define tags schema**

Create `src/server/db/schema/tags.ts`:

```typescript
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'

export const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull(),
  name: text('name').notNull(),           // lowercase slug, plaintext for GIN filtering
  encryptedLabel: ciphertext('encrypted_label').notNull(), // hub-key encrypted display label
  color: text('color').notNull().default('#6b7280'),       // hex color, plaintext
  encryptedCategory: ciphertext('encrypted_category'),     // hub-key encrypted grouping
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('tags_hub_name_unique').on(table.hubId, table.name),
])
```

- [ ] **Step 2: Add GIN index for contacts.tags**

In the migration:
```sql
CREATE INDEX contacts_tags_gin_idx ON contacts USING GIN (tags);
```

- [ ] **Step 3: Add `tags:create` to PERMISSION_CATALOG and update default roles**

In `src/shared/permissions.ts`, add to catalog:
```typescript
'tags:create': {
  label: 'Create new tags',
  group: 'tags',
  subgroup: 'actions',
},
```

Add `'tags'` to `PERMISSION_GROUP_LABELS`:
```typescript
tags: 'Tags',
```

Update `DEFAULT_ROLES`:
- **Hub Admin**: already has `*` or can be granted explicitly
- **Case Manager**: add `'tags:create'` to permissions array
- **Volunteer**: no `tags:create`

- [ ] **Step 4: Add strictTags to hub settings**

Add to the appropriate settings table or as a column on `hubs`:
```typescript
strictTags: boolean('strict_tags').notNull().default(true),
```

- [ ] **Step 4: Generate and run migration**

```bash
bun run migrate:generate && bun run migrate
```

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/ drizzle/
git commit -m "feat: add tags table, contacts GIN index, strictTags setting"
```

---

### Task 2: Tags Service

**Files:**
- Create: `src/server/services/tags.ts`
- Create: `src/server/services/tags.integration.test.ts`

- [ ] **Step 1: Write integration tests**

Test cases:
- Create tag with hub-key encrypted label and category
- List tags for hub (returns encrypted fields)
- Update tag (label, color, category)
- Delete tag
- Prevent duplicate name within hub
- Freeform auto-creation when `strictTags = false` and user has `tags:create`
- Reject freeform when `strictTags = true`
- Reject freeform when user lacks `tags:create`
- Default tag seeding on hub creation

- [ ] **Step 2: Implement TagsService and register in DI**

**CRITICAL:** Register in `src/server/services/index.ts`:
```typescript
// Add to Services interface:
tags: TagsService

// Add to createServices():
tags: new TagsService(db, crypto),
```

```typescript
export class TagsService {
  constructor(private db: PostgresJsDatabase) {}

  async createTag(data: { hubId: string; name: string; encryptedLabel: string; color: string; encryptedCategory?: string; createdBy: string }): Promise<Tag>
  async listTags(hubId: string): Promise<Tag[]>
  async updateTag(id: string, data: Partial<{ encryptedLabel: string; color: string; encryptedCategory: string }>): Promise<Tag>
  async deleteTag(id: string): Promise<void>
  async getOrCreateTag(hubId: string, name: string, createdBy: string, encryptedLabel: string): Promise<Tag>  // for freeform auto-creation
  async seedDefaultTags(hubId: string, createdBy: string, hubKey: Uint8Array): Promise<void>
}
```

- [ ] **Step 3: Hook default tag seeding into hub creation**

In the hub creation flow (likely `src/server/routes/hubs.ts` or `src/server/services/settings.ts`), after a hub is created, call:
```typescript
await services.tags.seedDefaultTags(hubId, createdBy, hubKey)
```

This seeds the 9 default tags from the spec (repeat-caller, detained, released, legal-aid, shelter-contact, family-member, urgent, follow-up, resolved) with hub-key encrypted labels and categories.

- [ ] **Step 4: Run tests**

```bash
bun test src/server/services/tags.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/services/tags.ts src/server/services/tags.integration.test.ts src/server/services/index.ts src/shared/permissions.ts src/server/routes/hubs.ts
git commit -m "feat: add TagsService with CRUD, freeform gating, default seeding, and hub creation hook"
```

---

### Task 3: Tags API Routes

**Files:**
- Create: `src/server/routes/tags.ts`
- Create: `tests/api/tags.spec.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/services/contacts.ts` (tag filter with GIN index)

- [ ] **Step 1: Create route file**

```typescript
// GET  /api/tags         → list tags for hub
// POST /api/tags         → create tag (requires tags:create or settings:manage-fields)
// PATCH /api/tags/:id    → update tag (requires settings:manage-fields)
// DELETE /api/tags/:id   → delete tag (requires settings:manage-fields)
```

- [ ] **Step 2: Update contact list filtering**

In `ContactsService.listContacts()`, add proper GIN-indexed tag filtering:

```typescript
if (filters.tag) {
  query = query.where(sql`${contacts.tags} @> ${JSON.stringify([filters.tag])}::jsonb`)
}
if (filters.tags && filters.tags.length > 0) {
  query = query.where(sql`${contacts.tags} ?| ${sql.raw(`ARRAY[${filters.tags.map(t => `'${t}'`).join(',')}]`)}`)
}
```

- [ ] **Step 3: Wire routes and write API tests**

- [ ] **Step 4: Run tests**

```bash
bunx playwright test tests/api/tags.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/tags.ts src/server/app.ts tests/api/tags.spec.ts src/server/services/contacts.ts
git commit -m "feat: add tags API routes and GIN-indexed tag filtering"
```

---

### Task 4: TagInput Component & Frontend

**Files:**
- Create: `src/client/components/tag-input.tsx`
- Create: `src/client/lib/queries/tags.ts`
- Modify: `src/client/lib/queries/keys.ts`
- Modify: `src/client/lib/api.ts`
- Modify: `src/client/components/contacts/create-contact-dialog.tsx`
- Modify: `src/client/routes/contacts.tsx` (tag filter)
- Modify: `src/client/routes/contacts_.$contactId.tsx` (colored badges)
- Modify: `src/client/routes/settings.tsx` (tag admin section)
- Create: `tests/ui/tags.spec.ts`

- [ ] **Step 1: Add API functions and query hooks**

Add to `api.ts`: `listTags`, `createTag`, `updateTag`, `deleteTag`.

Create `src/client/lib/queries/tags.ts` with `useTags`, `useCreateTag`, `useUpdateTag`, `useDeleteTag`.

Add to `keys.ts`:
```typescript
tags: {
  all: ['tags'] as const,
  list: (hubId: string) => ['tags', 'list', hubId] as const,
},
```

- [ ] **Step 2: Install shadcn Combobox and build TagInput component**

First, install the shadcn Combobox component (multi-select with chips):
```bash
bunx shadcn@latest add combobox
```

This also opens an opportunity to migrate existing `Command` + `Popover` combo patterns (like `ContactSelect`, command palette) to the new `Combobox` — but that's optional cleanup, not required for this task.

Create `src/client/components/tag-input.tsx` using shadcn `Combobox`:

```tsx
import {
  Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput,
  ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList,
  ComboboxValue, useComboboxAnchor,
} from '@/components/ui/combobox'
```

Features:
- Multi-select with colored chip badges (removable) via `ComboboxChip` with dynamic `style={{ backgroundColor: tag.color }}`
- Searchable dropdown of defined tags with color dots and decrypted labels
- "Create [typed text]" option at bottom of list when user has `tags:create` and hub allows freeform
- No freeform option when `strictTags` or user lacks permission

- [ ] **Step 3: Replace freeform tag input in create contact dialog**

Replace comma-separated text input with `TagInput` component.

- [ ] **Step 4: Add tag filter to contact directory**

Add `TagInput` in filter mode (no create option) to the directory filter bar.

- [ ] **Step 5: Update tag badges to use colors**

In contact directory table and profile page, render tag badges with the tag's `color` as background tint.

- [ ] **Step 6: Add tag admin section to settings**

In settings page, add a section for tag management:
- Table of tags: decrypted label, color dot, category, usage count
- Create/edit/delete actions
- `strictTags` toggle

- [ ] **Step 7: Write tests across all three suites**

**Unit tests** — add to `src/server/services/tags.integration.test.ts`:
- Tag CRUD operations
- Hub-scoped uniqueness constraint
- strictTags enforcement
- Freeform auto-creation with/without `tags:create`
- Default tag seeding
- GIN index tag filtering queries

**API tests** — create `tests/api/tags.spec.ts`:
- `GET /api/tags` returns encrypted labels for hub
- `POST /api/tags` requires `tags:create` or `settings:manage-fields`
- `PATCH /api/tags/:id` requires `settings:manage-fields`
- `DELETE /api/tags/:id` requires `settings:manage-fields`, warns if in use
- Freeform tag rejection when `strictTags = true`
- Freeform tag rejection when user lacks `tags:create`
- `GET /api/contacts?tag=detained` uses GIN index filtering
- `GET /api/contacts?tags=detained,legal-aid` multi-tag filtering

**UI E2E tests** — create `tests/ui/tags.spec.ts`:
- Tag Combobox shows defined tags with color dots
- Multi-select creates colored chip badges
- Freeform "Create" option visible when permitted, hidden when not
- `strictTags` toggle disables freeform for all users
- Tag filter on contact directory returns correct results
- Tag admin section: create tag (label + color + category), edit, delete
- Delete confirmation warns about N contacts using this tag
- Colored tag badges in directory table and profile page

- [ ] **Step 8: Run all three test suites**

```bash
bun run test:unit
bunx playwright test tests/api/tags.spec.ts
bunx playwright test tests/ui/tags.spec.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/client/ tests/
git commit -m "feat: add TagInput component, tag filtering, tag admin, colored badges"
```
