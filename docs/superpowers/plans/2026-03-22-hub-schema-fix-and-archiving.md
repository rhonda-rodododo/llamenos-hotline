# Hub Schema Fix & Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `hubs` DB table to include all required Hub fields, implement archiving, and add archive UI.

**Architecture:** Add 5 missing columns to the hubs Drizzle schema table, fix the Zod schemas and service methods to match, implement archiveHub() as a status soft-delete, add confirmation dialog to the hubs UI.

**Tech Stack:** Drizzle ORM (drizzle-orm/bun-sql), Zod v4, Hono, Bun, Playwright (E2E tests)

---

## Background

The `hubs` table in `src/server/db/schema/settings.ts` only has 4 columns (`id`, `name`, `nostrPubkey`, `createdAt`) but the `Hub` interface in `src/shared/types.ts` requires `slug`, `description`, `status`, `phoneNumber`, `createdBy`, and `updatedAt`. This mismatch means:

- `tests/multi-hub.spec.ts` fails at lines 89–90 (`hub.slug` and `hub.status` are undefined)
- The hub management UI renders undefined values for slug, status, description, and phone number
- `archiveHub()` throws a 501 stub error
- `createHub()` ignores slug, description, phoneNumber, and createdBy
- `updateHub()` only updates `name`, ignoring all other mutable fields

The `nostrPubkey` column is vestigial (not in the `Hub` interface) and should be dropped at the same time.

**Key reference:** `src/worker/routes/hubs.ts` lines 42–47 shows the slug generation logic:
```typescript
slug: body.slug?.trim() || body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
```

The `CreateHubData` interface in `src/server/types.ts` already has all necessary fields (`id`, `name`, `slug?`, `description?`, `status?`, `phoneNumber?`, `createdBy`) — the service just needs to use them.

---

## Task 1 — Add missing columns to hubs Drizzle schema + generate + apply migration

**Files:**
- `src/server/db/schema/settings.ts` — add 6 columns, remove `nostrPubkey`

**Steps:**

- [ ] Edit `src/server/db/schema/settings.ts` — replace the `hubs` table definition:

  ```typescript
  export const hubs = pgTable('hubs', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    phoneNumber: text('phone_number'),
    createdBy: text('created_by').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  })
  ```

  Notes:
  - `nostrPubkey` is removed (not in the `Hub` interface; was never used in business logic)
  - `status` uses `text()` (not an enum) for forward compatibility, default `'active'`
  - `createdBy` uses `.default('')` so existing rows in dev/test databases don't break migration
  - `slug` is `notNull()` — migration sets a default of `''` for existing rows (dev only; pre-production)
  - All new columns are added to the end of the column list

- [ ] Run migration generation:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && DATABASE_URL=postgresql://llamenos:llamenos@localhost:5433/llamenos bunx drizzle-kit generate
  ```

  Expected output: `1 migration file generated in drizzle/migrations/`

- [ ] Inspect the generated SQL in `drizzle/migrations/` to confirm it adds `slug`, `description`, `status`, `phone_number`, `created_by`, `updated_at` columns and drops `nostr_pubkey`

- [ ] Apply migration (dev DB must be running — `bun run dev:docker` from worktree):

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && DATABASE_URL=postgresql://llamenos:llamenos@localhost:5433/llamenos bunx drizzle-kit migrate
  ```

  Expected output: `Migration applied successfully`

- [ ] Commit:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && git add src/server/db/schema/settings.ts drizzle/migrations/ && git commit -m "$(cat <<'EOF'
  fix(schema): add missing hub columns + drop vestigial nostrPubkey

  Adds slug, description, status, phoneNumber, createdBy, updatedAt to
  the hubs table. Drops nostr_pubkey which was never used. Generates and
  applies Drizzle migration.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2 — Fix Zod schemas (HubSchema, CreateHubSchema, UpdateHubSchema)

**Files:**
- `src/shared/schemas/settings.ts` — replace Hub-related Zod schemas

**Steps:**

- [ ] Edit `src/shared/schemas/settings.ts` — replace the three Hub schemas at the top of the file:

  ```typescript
  export const HubSchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    status: z.enum(['active', 'suspended', 'archived']),
    phoneNumber: z.string().optional(),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  export type Hub = z.infer<typeof HubSchema>

  export const CreateHubSchema = z.object({
    name: z.string().min(1).max(100),
    slug: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    phoneNumber: z.string().optional(),
  })
  export type CreateHubInput = z.infer<typeof CreateHubSchema>

  export const UpdateHubSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    phoneNumber: z.string().optional(),
    status: z.enum(['active', 'suspended', 'archived']).optional(),
  })
  export type UpdateHubInput = z.infer<typeof UpdateHubSchema>
  ```

  Notes:
  - `id` uses `z.string()` not `z.uuid()` — the DB uses `text` PK, not UUID-constrained
  - `nostrPubkey` is removed from all schemas
  - `status` is required (not optional) in `HubSchema` — the DB column has a default of `'active'`
  - `updatedAt` is added as required ISO datetime
  - `UpdateHubSchema` allows updating `status` (for suspend/unsuspend flows) but not `slug` (slugs are immutable after creation)

- [ ] Run typecheck to catch any type errors introduced by the schema change:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bun run typecheck 2>&1 | head -60
  ```

  Expected: errors only in the service and route files that still use `nostrPubkey` — these are fixed in Task 3. No errors in `src/shared/` itself.

- [ ] Commit:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && git add src/shared/schemas/settings.ts && git commit -m "$(cat <<'EOF'
  fix(schemas): align HubSchema/CreateHubSchema/UpdateHubSchema with Hub interface

  Removes nostrPubkey, adds slug/description/status/phoneNumber/createdBy/
  updatedAt to match the Hub interface in shared/types.ts exactly.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3 — Fix SettingsService createHub / updateHub / archiveHub

**Files:**
- `src/server/services/settings.ts` — fix three hub methods

**Steps:**

- [ ] Edit `src/server/services/settings.ts` — replace the `createHub` method (lines ~641–651):

  ```typescript
  async createHub(data: CreateHubData): Promise<Hub> {
    const slug =
      data.slug?.trim() ||
      data.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
    const now = new Date()
    const [row] = await this.db
      .insert(hubs)
      .values({
        id: data.id || crypto.randomUUID(),
        name: data.name,
        slug,
        description: data.description ?? null,
        status: data.status ?? 'active',
        phoneNumber: data.phoneNumber ?? null,
        createdBy: data.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return this.#rowToHub(row)
  }
  ```

- [ ] Edit `src/server/services/settings.ts` — replace the `updateHub` method (lines ~653–662):

  ```typescript
  async updateHub(id: string, data: Partial<Hub>): Promise<Hub> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Hub not found')
    const [row] = await this.db
      .update(hubs)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
        ...(data.status !== undefined && { status: data.status }),
        updatedAt: new Date(),
      })
      .where(eq(hubs.id, id))
      .returning()
    return this.#rowToHub(row)
  }
  ```

- [ ] Edit `src/server/services/settings.ts` — replace the `archiveHub` stub (lines ~664–668):

  ```typescript
  async archiveHub(id: string): Promise<void> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    if (!rows[0]) throw new AppError(404, 'Hub not found')
    await this.db
      .update(hubs)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(hubs.id, id))
  }
  ```

- [ ] Add the `#rowToHub` private helper method after the `#rowToRole` method in the private helpers section (look for `// ------------------------------------------------------------------ Private helpers`):

  ```typescript
  #rowToHub(r: typeof hubs.$inferSelect): Hub {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description ?? undefined,
      status: r.status as Hub['status'],
      phoneNumber: r.phoneNumber ?? undefined,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  }
  ```

  Also update `getHubs` and `getHub` to use `#rowToHub`:

  ```typescript
  async getHubs(): Promise<Hub[]> {
    const rows = await this.db.select().from(hubs)
    return rows.map((r) => this.#rowToHub(r))
  }

  async getHub(id: string): Promise<Hub | null> {
    const rows = await this.db.select().from(hubs).where(eq(hubs.id, id)).limit(1)
    return rows[0] ? this.#rowToHub(rows[0]) : null
  }
  ```

  Notes:
  - Replace the `as unknown as Hub` casts — these were masking the type gap and are now replaced by a proper mapper
  - `Hub` import in the service comes from `src/shared/types.ts` — confirm the import path at top of file is `import type { Hub } from '@shared/types'` (or equivalent)

- [ ] Update the route handler in `src/worker/routes/hubs.ts` to pass the full `hubData` object to `createHub` instead of only `{ id, name, createdBy }`.

  Replace the `createHub` call at lines ~56–60:

  ```typescript
  // Before (drops slug, description, status, phoneNumber):
  const hub = await services.settings.createHub({
    id: hubData.id,
    name: hubData.name,
    createdBy: pubkey,
  })

  // After (passes all fields):
  const hub = await services.settings.createHub({
    id: hubData.id,
    name: hubData.name,
    slug: hubData.slug,
    description: hubData.description,
    status: hubData.status,
    phoneNumber: hubData.phoneNumber,
    createdBy: hubData.createdBy,
  })
  ```

  Note: `hubData.createdBy` is already set to `pubkey` at line 51 of the route, so this is equivalent — it just stops the route from silently discarding the other fields.

- [ ] Run typecheck to confirm all errors in settings.ts are resolved:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bun run typecheck 2>&1 | grep 'settings'
  ```

  Expected: no errors in settings.ts

- [ ] Commit:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && git add src/server/services/settings.ts src/worker/routes/hubs.ts && git commit -m "$(cat <<'EOF'
  fix(service): implement full hub CRUD + archiving in SettingsService

  createHub now generates slug, stores all fields. updateHub now updates
  all mutable fields + updatedAt. archiveHub now sets status=archived
  instead of throwing 501. Adds #rowToHub mapper to eliminate unsafe casts.
  Also fixes the route handler to pass slug/description/status/phoneNumber
  to createHub instead of silently dropping them.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4 — Add archive UI action to hubs.tsx

**Files:**
- `src/client/routes/admin/hubs.tsx` — add Archive button + confirmation dialog, call `archiveHub` API

**Steps:**

- [ ] Check the `@/lib/api` module to see if `archiveHub` is already exported:

  ```bash
  grep -n 'archiveHub\|archive' /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal/src/client/lib/api.ts
  ```

  If `archiveHub` is missing, add it. It should call `PATCH /api/hubs/:id` with `{ status: 'archived' }` (or a dedicated `DELETE /api/hubs/:id` if that route exists — check `src/server/routes/hubs.ts`).

- [ ] Edit `src/client/routes/admin/hubs.tsx`:

  1. Add `archiveHub` to the import from `@/lib/api`:
     ```typescript
     import { type Hub, archiveHub, createHub, listHubs, updateHub } from '@/lib/api'
     ```

  2. Add `Archive` icon to the lucide-react import:
     ```typescript
     import { Archive, Building2, Pencil, Phone, Plus } from 'lucide-react'
     ```

  3. Add `archivingHub` state to `HubsPage`:
     ```typescript
     const [archivingHub, setArchivingHub] = useState<Hub | null>(null)
     ```

  4. Update `HubRow` props to accept `onArchive`:
     ```typescript
     function HubRow({ hub, onEdit, onArchive }: { hub: Hub; onEdit: () => void; onArchive: () => void })
     ```

  5. Add Archive button inside `HubRow` (only shown when `hub.status !== 'archived'`), after the Edit button:
     ```typescript
     {hub.status !== 'archived' && (
       <Button variant="ghost" size="xs" onClick={onArchive} className="text-destructive hover:text-destructive">
         <Archive className="h-3 w-3" />
         {t('hubs.archive')}
       </Button>
     )}
     ```

  6. Pass `onArchive` to `HubRow` in the map:
     ```typescript
     <HubRow key={hub.id} hub={hub} onEdit={() => setEditingHub(hub)} onArchive={() => setArchivingHub(hub)} />
     ```

  7. Add the `ArchiveHubDialog` component at the bottom of the file:
     ```typescript
     function ArchiveHubDialog({
       open,
       onOpenChange,
       hub,
       onArchived,
     }: {
       open: boolean
       onOpenChange: (open: boolean) => void
       hub: Hub | null
       onArchived: (hubId: string) => void
     }) {
       const { t } = useTranslation()
       const { toast } = useToast()
       const [saving, setSaving] = useState(false)

       if (!hub) return null

       async function handleConfirm() {
         setSaving(true)
         try {
           await archiveHub(hub.id)
           onArchived(hub.id)
           onOpenChange(false)
           toast(t('hubs.hubArchived'), 'success')
         } catch {
           toast(t('common.error'), 'error')
         } finally {
           setSaving(false)
         }
       }

       return (
         <Dialog open={open} onOpenChange={onOpenChange}>
           <DialogContent>
             <DialogHeader>
               <DialogTitle>{t('hubs.archiveHub')}</DialogTitle>
               <DialogDescription>
                 {t('hubs.archiveHubConfirm', { name: hub.name })}
               </DialogDescription>
             </DialogHeader>
             <DialogFooter>
               <Button
                 type="button"
                 variant="outline"
                 onClick={() => onOpenChange(false)}
                 disabled={saving}
               >
                 {t('common.cancel')}
               </Button>
               <Button
                 type="button"
                 variant="destructive"
                 onClick={handleConfirm}
                 disabled={saving}
               >
                 {saving ? t('common.loading') : t('hubs.archiveHub')}
               </Button>
             </DialogFooter>
           </DialogContent>
         </Dialog>
       )
     }
     ```

  8. Mount `ArchiveHubDialog` in `HubsPage` JSX (after `EditHubDialog`):
     ```typescript
     <ArchiveHubDialog
       open={!!archivingHub}
       onOpenChange={(open) => { if (!open) setArchivingHub(null) }}
       hub={archivingHub}
       onArchived={(id) => {
         setHubs((prev) => prev.filter((h) => h.id !== id))
         setArchivingHub(null)
       }}
     />
     ```

- [ ] If `archiveHub` is missing from `src/client/lib/api.ts`, add:

  ```typescript
  export async function archiveHub(id: string): Promise<void> {
    await apiFetch(`/api/hubs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    })
  }
  ```

  (Check existing API functions for the correct fetch wrapper pattern in that file.)

- [ ] Run typecheck:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bun run typecheck 2>&1 | grep 'hubs'
  ```

  Expected: no errors in hubs.tsx or api.ts

- [ ] Commit:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && git add src/client/routes/admin/hubs.tsx src/client/lib/api.ts && git commit -m "$(cat <<'EOF'
  feat(ui): add archive hub action with confirmation dialog

  Adds Archive button to HubRow (hidden for already-archived hubs) and
  an ArchiveHubDialog with confirmation. Archived hubs are removed from
  the list immediately on success.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5 — E2E test for archive hub UI action

**Files:**
- `tests/multi-hub.spec.ts` — add archive hub test to the existing hub test file

**Steps:**

- [ ] Read `tests/multi-hub.spec.ts` to understand the existing test structure, auth helpers, and any shared fixtures before writing the new test.

- [ ] Add a new `test` block to `tests/multi-hub.spec.ts` for the archive action. Place it after the existing hub CRUD tests:

  ```typescript
  test('admin can archive a hub via the UI', async ({ page }) => {
    // Log in as admin
    await loginAsAdmin(page) // use the existing login helper from this file

    // Create a hub via the API so the test doesn't depend on prior state
    const hubName = `archive-test-${Date.now()}`
    await page.request.post('/api/hubs', {
      data: { name: hubName },
    })

    // Navigate to the hub management page
    await page.goto('/admin/hubs')
    await page.waitForLoadState('networkidle')

    // Confirm the hub appears in the active list
    await expect(page.getByText(hubName)).toBeVisible()

    // Click the Archive button for this hub's row
    const hubRow = page.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    await hubRow.getByRole('button', { name: /archive/i }).click()

    // Confirmation dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText(hubName)

    // Confirm the archive action
    await page.getByRole('button', { name: /archive hub/i }).last().click()

    // Dialog should close and hub should no longer appear in the active list
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByText(hubName)).not.toBeVisible()
  })
  ```

  Notes:
  - Use whatever admin login helper already exists in `tests/multi-hub.spec.ts` (check for `loginAsAdmin`, `adminLogin`, or a `beforeEach` block — match the existing pattern exactly).
  - If the hub row doesn't already have `data-testid="hub-row"`, check whether the existing tests locate rows differently (e.g., by role or test id) and match that approach. If no test id exists, add `data-testid="hub-row"` to the `HubRow` component in `hubs.tsx` as part of Task 4.
  - The `getByRole('button', { name: /archive hub/i }).last()` targets the confirm button inside the dialog (disambiguating from the trigger button in the row).
  - If the UI filters archived hubs out entirely (the `onArchived` callback removes them from state), `not.toBeVisible()` is the correct assertion. If archived hubs remain visible with a badge, change the assertion to: `await expect(hubRow.getByText(/archived/i)).toBeVisible()`.

- [ ] Commit:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && git add tests/multi-hub.spec.ts && git commit -m "$(cat <<'EOF'
  test(e2e): add archive hub UI test to multi-hub spec

  Verifies admin can click the Archive button, confirm the dialog, and
  that the hub is removed from the active hub list on success.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6 — Verify typecheck + build + tests pass

**Steps:**

- [ ] Run full typecheck:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bun run typecheck
  ```

  Expected output: `Found 0 errors.`

- [ ] Run full build:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bun run build
  ```

  Expected output: Vite build completes with no errors. `dist/client/` is populated.

- [ ] Ensure dev services are running (postgres on port 5433):

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bun run dev:docker
  ```

- [ ] Run the targeted multi-hub test:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bunx playwright test tests/multi-hub.spec.ts
  ```

  Expected: all tests pass, including `hub CRUD operations via API` which asserts `hub.slug === 'test-hub'` and `hub.status === 'active'`.

- [ ] If any tests fail, check server logs:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bunx playwright test tests/multi-hub.spec.ts --reporter=line 2>&1 | tail -40
  ```

  Common failure modes:
  - Migration not applied → restart dev services and rerun `drizzle-kit migrate`
  - `slug` still undefined → confirm `createHub` in the service is reading `data.slug` and the route is passing slug in `CreateHubData`
  - Type cast `as unknown as Hub` still present → ensure all hub methods use `#rowToHub`

- [ ] If all passing, run the full test suite to check for regressions:

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && bunx playwright test
  ```

  Expected: no regressions in other test files.

- [ ] Final commit (if any fixup changes were needed):

  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal && git add -p && git commit -m "$(cat <<'EOF'
  fix(hubs): address typecheck and test failures from schema fix

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Appendix: Type consistency checklist

Before marking complete, verify:

| Location | Expected state after fix |
|---|---|
| `src/server/db/schema/settings.ts` `hubs` table | Has `slug`, `description`, `status`, `phoneNumber`, `createdBy`, `updatedAt`; no `nostrPubkey` |
| `src/shared/schemas/settings.ts` `HubSchema` | Matches `Hub` interface from `src/shared/types.ts` exactly |
| `src/server/services/settings.ts` `createHub` | Accepts `CreateHubData`, generates slug, stores all fields, uses `#rowToHub` |
| `src/server/services/settings.ts` `updateHub` | Updates all mutable fields + `updatedAt`, uses `#rowToHub` |
| `src/server/services/settings.ts` `archiveHub` | Sets `status = 'archived'` + `updatedAt`, no longer throws 501 |
| `src/client/routes/admin/hubs.tsx` | Has Archive button + `ArchiveHubDialog`; `HubRow` has `data-testid="hub-row"` |
| `src/client/lib/api.ts` | Exports `archiveHub(id)` |
| `tests/multi-hub.spec.ts` | Has E2E test for archive hub UI action (Task 5) |
| Drizzle migration | Generated and applied; SQL adds 6 columns, drops `nostr_pubkey` |
