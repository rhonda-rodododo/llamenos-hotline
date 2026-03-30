# Tag Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace freeform string tags with a managed tag system — admin-defined vocabulary with colors, categories, autocomplete, hub-key encrypted metadata, GIN index filtering, and permission-gated freeform creation.

**Architecture:** New `tags` table with hub-key encrypted labels/categories and plaintext slugs/colors. Contacts continue to store tag slugs as `string[]` JSONB (no joins needed for filtering). GIN index enables efficient server-side tag queries. `TagInput` component replaces freeform text input. `strictTags` hub setting controls whether users can create new tags.

**Tech Stack:** Drizzle ORM, Hono, React, React Query, shadcn/ui (Command + Popover), bun:test, Playwright

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

- [ ] **Step 3: Add strictTags to hub settings**

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

- [ ] **Step 2: Implement TagsService**

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

- [ ] **Step 3: Run tests**

```bash
bun test src/server/services/tags.integration.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/server/services/tags.ts src/server/services/tags.integration.test.ts
git commit -m "feat: add TagsService with CRUD, freeform gating, and default seeding"
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

- [ ] **Step 2: Build TagInput component**

Create `src/client/components/tag-input.tsx` using shadcn `Command` + `Popover`:
- Searchable dropdown of defined tags with color dots and decrypted labels
- Multi-select with colored badge chips (removable)
- "Create [typed text]" option when user has `tags:create` and hub allows freeform
- No freeform option when `strictTags` or lacking permission

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

- [ ] **Step 7: Write E2E tests**

Create `tests/ui/tags.spec.ts`:
- Tag autocomplete shows defined tags with colors
- Freeform creation when permitted
- Tag filter on directory
- Tag admin CRUD
- Colored badges

- [ ] **Step 8: Run all tests**

```bash
bun run typecheck && bun run build
bunx playwright test tests/ui/tags.spec.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/client/ tests/ui/tags.spec.ts
git commit -m "feat: add TagInput component, tag filtering, tag admin, colored badges"
```
