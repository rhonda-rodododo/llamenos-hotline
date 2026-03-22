# Report Types System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured report types (admin-configurable) that bind custom fields to specific report categories, replacing the current free-text category field. Backport from v2 (`~/projects/llamenos`).

**Context:** v1 has reports with a simple `category` text field and untyped custom fields. v2 has a `ReportType` entity with: name, description, isDefault, archivedAt, and a set of bound `CustomFieldDefinition` IDs. The report form filters custom fields by the selected report type.

---

## Phase 1: DB Schema

- [ ] Add `report_types` table to `src/worker/db/schema/records.ts` (or equivalent schema file):
  ```typescript
  reportTypes = pgTable('report_types', {
    id: varchar('id', { length: 64 }).primaryKey(),
    hubId: varchar('hub_id', { length: 64 }).notNull().references(() => hubs.id),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  })
  ```

- [ ] Add `reportTypeId` column to the `conversations` table (reports are conversations with `channelType = 'web'` and `metadata.type = 'report'` — there is no standalone `reports` table):
  ```typescript
  reportTypeId: varchar('report_type_id', { length: 64 }).references(() => reportTypes.id),
  ```
  - Nullable: existing report-conversations filed before types were introduced have no type

- [ ] Add partial unique index for `is_default` constraint:
  ```sql
  CREATE UNIQUE INDEX report_types_one_default_per_hub
    ON report_types (hub_id)
    WHERE is_default = TRUE AND archived_at IS NULL;
  ```

- [ ] Add `reportTypeIds` JSONB column to `custom_field_definitions` table (existing):
  ```typescript
  reportTypeIds: jsonb('report_type_ids').notNull().default([]),
  // Which report types show this field. Empty array = shown for all types.
  ```
  - Note: `context` column (from `2026-03-22-drizzle-schema-completeness-addendum.md`) handles global `'reports'` filtering; `reportTypeIds` adds fine-grained per-type filtering

- [ ] Update `CustomFieldDefinition` type in `src/shared/types.ts` to add `reportTypeIds?: string[]`

- [ ] Run `bunx drizzle-kit generate`

---

## Phase 2: Backend Service & API

### 2.1 ReportTypeService
- [ ] Create `src/worker/services/report-type-service.ts`:
  ```typescript
  class ReportTypeService {
    listReportTypes(hubId: string): Promise<ReportType[]>
    createReportType(hubId: string, data: CreateReportTypeInput): Promise<ReportType>
    updateReportType(hubId: string, id: string, data: UpdateReportTypeInput): Promise<ReportType>
    archiveReportType(hubId: string, id: string): Promise<void>
    // Unarchive also needed
    setDefaultReportType(hubId: string, id: string): Promise<void>
  }
  ```
  - `setDefaultReportType`: clears `isDefault` on all others, sets on the target

### 2.2 API routes
- [ ] Add to `src/worker/routes/settings.ts` or new `src/worker/routes/report-types.ts`:
  ```
  GET  /api/report-types               → list (admin + volunteer)
  POST /api/report-types               → create (admin)
  PATCH /api/report-types/:id          → update name/description/fieldIds (admin)
  DELETE /api/report-types/:id         → archive (admin, not hard delete)
  POST /api/report-types/:id/default   → set as default (admin)
  ```
- [ ] Zod schemas for all inputs/outputs

### 2.3 Update ConversationsService (reports are conversations)
- [ ] Reports are conversations with `channelType = 'web'` and `metadata.type = 'report'` — update the conversations service, not a separate reports service
- [ ] `createConversation()` (for report-type conversations): accept `reportTypeId` field, validate it belongs to the hub
- [ ] `listConversations()` / report queries: include `reportType` in response (joined) when filtering for report-conversations
- [ ] `GET /api/conversations/:id` (for report-conversations): include `reportType` in response

---

## Phase 3: Frontend — Admin Settings

### 3.1 ReportTypesSection component
- [ ] Create `src/client/components/admin-settings/report-types-section.tsx`:
  - List of report types (active + archived toggle)
  - Each type shows: name, description, field count, default badge, archive/unarchive button
  - "New report type" button → inline form or dialog with:
    - Name field
    - Description field
    - "Set as default" checkbox
    - Multi-select of custom fields with `context === 'reports'`
  - Inline edit for existing types
  - Archive confirmation dialog

### 3.2 Integrate into Settings page
- [ ] Add `ReportTypesSection` to `src/client/routes/settings.tsx` (admin only)
- [ ] Place after CustomFieldsSection

---

## Phase 4: Frontend — Report Form

### 4.1 Report type selector
- [ ] In `src/client/components/reports/` (or wherever reports are created):
  - Add "Report Type" dropdown at top of form (required if any types exist)
  - Default: pre-select the default type if one exists
  - On type change: filter displayed custom fields to those bound to the selected type

### 4.2 Custom field filtering
- [ ] When rendering custom fields in report form:
  - If no report types exist: show all fields with `context === 'reports'`
  - If report type selected: show fields where `reportTypeIds` is empty OR includes the selected type ID
  - Fields not in the selected type are hidden (not deleted — just filtered from the form)

### 4.3 Display in report detail view
- [ ] Show "Report Type: [name]" badge in report detail/list views

---

## Phase 5: i18n

- [ ] Add to all 13 locale files:
  - `settings.reportTypes.title`
  - `settings.reportTypes.empty`
  - `settings.reportTypes.new`
  - `settings.reportTypes.name`
  - `settings.reportTypes.description`
  - `settings.reportTypes.fields`
  - `settings.reportTypes.default`
  - `settings.reportTypes.setDefault`
  - `settings.reportTypes.archive`
  - `settings.reportTypes.unarchive`
  - `settings.reportTypes.archived`
  - `reports.type.label`
  - `reports.type.placeholder`

---

## Phase 6: Tests

- [ ] Admin can create a report type with 2 custom fields
- [ ] Report form shows only the fields bound to the selected type
- [ ] Changing report type changes displayed fields
- [ ] Default type is pre-selected when creating a report
- [ ] Archived report type not shown in dropdown (but existing reports keep their type)

---

## Completion Checklist

- [ ] `report_types` table created
- [ ] `conversations.reportTypeId` FK column added (no standalone reports table)
- [ ] Partial unique index `report_types_one_default_per_hub` created
- [ ] `custom_field_definitions.reportTypeIds` JSONB column added
- [ ] `CustomFieldDefinition` type in `src/shared/types.ts` updated with `reportTypeIds?: string[]`
- [ ] CRUD API for report types
- [ ] `ReportTypesSection` in admin settings
- [ ] Report form filters fields by type
- [ ] i18n keys in 13 locales
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] E2E tests pass
