# Report Types System — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

Reports currently have a free-text `category` field and display all custom fields that have `context = 'reports'` regardless of the type of report being filed. This creates two problems:

1. **Noise:** A domestic violence report form shows custom fields meant only for welfare check reports.
2. **No structure:** Admins cannot enforce that certain fields are filled for certain report types.

Different crises require different structured information. A suicide intervention has different fields than a housing referral.

## Goals

1. Admins can define named report types (e.g., "Crisis Intervention", "Housing Referral").
2. Each type binds a subset of custom fields — the form only shows the relevant fields.
3. A default type applies when no selection is made (smooth transition from current state).
4. Report types can be archived (preserved for historical data) but not hard-deleted.
5. Reports retain a pointer to the type that was active when they were filed.

## Non-Goals

- Required field enforcement per type (future — can be added as `required: boolean` on the binding).
- Auto-suggest report type based on call content (future ML feature).
- Report type permissions (all admins can create/manage all types).

## Data Model

```
report_types
  id           TEXT PK
  hub_id       TEXT FK → hubs.id
  name         TEXT NOT NULL
  description  TEXT
  is_default   BOOLEAN NOT NULL DEFAULT FALSE
  archived_at  TIMESTAMPTZ NULL
  created_at   TIMESTAMPTZ NOT NULL
  updated_at   TIMESTAMPTZ NOT NULL

-- At most one row per hub has is_default = TRUE (enforced by partial unique index + service layer)
```

```
custom_field_definitions (existing)
  + report_type_ids  JSONB NOT NULL DEFAULT '[]'
  -- Empty array = shown for all types (or when no types exist)
  -- Non-empty array = shown only for listed type IDs
```

> **TypeScript:** Add `reportTypeIds?: string[]` to `CustomFieldDefinition` in `src/shared/types.ts`.

```
conversations (existing)
  + report_type_id  TEXT NULL FK → report_types.id
  -- NULL for reports filed before types were introduced
  -- Reports are conversations with channelType = 'web' AND metadata->>'type' = 'report'
  -- There is no standalone reports table; filter conversations with:
  --   WHERE channel_type = 'web' AND metadata->>'type' = 'report'
```

> **Partial unique index:** Enforce at most one default per hub at the database level:
> ```sql
> CREATE UNIQUE INDEX report_types_one_default_per_hub
>   ON report_types (hub_id)
>   WHERE is_default = TRUE AND archived_at IS NULL;
> ```
> The service-layer default-clearing logic (transactions) is still required for correctness, but this index provides a safety net.

### Why not a junction table for type↔field?

A JSONB array on `custom_field_definitions` is simpler to query and sufficient at this scale. Junction table overhead is not warranted when the count of field-type bindings per hub will be in the tens.

## Behaviour Matrix

| Types configured? | `report_type_id` on report | Fields shown |
|---|---|---|
| No types | N/A | All fields with `context='reports'` |
| Types exist, no selection | N/A (default type auto-selected) | Fields bound to default type |
| Types exist, type selected | Populated | Fields where `reportTypeIds` is empty OR contains selected type ID |

An empty `reportTypeIds` on a field means "show for all types" — this is the backward-compatible default for existing fields.

## Service Layer Design

`ReportTypeService`:
- `listReportTypes(hubId)` — excludes archived unless `includeArchived: true`
- `createReportType(hubId, input)` — if `isDefault: true`, clears existing default first (transaction)
- `updateReportType(hubId, id, input)` — same default-clearing logic
- `archiveReportType(hubId, id)` — sets `archived_at`; if type was default, clears `is_default` (leaves hub with no default until admin sets one)
- `setDefault(hubId, id)` — clears all others first

The service does **not** hard-delete to preserve historical report integrity.

## Admin UI

New "Report Types" section in admin settings (below Custom Fields):
- List: name, field count, default badge, archived toggle
- Create form: name (required), description (optional), "Set as default" checkbox, field multi-select (context='reports' fields only)
- Edit: same fields inline
- Archive: confirmation dialog noting "Existing reports will keep this type label"

## Report Form Changes

1. "Report Type" dropdown added at top (required if any non-archived types exist for hub).
2. Default type pre-selected on open.
3. On type change: re-filter visible fields without clearing entered values (values for hidden fields are preserved in state but not submitted).
4. Report detail/list views: show "Type: [name]" as a badge.

> **Privacy requirement — field exclusion before encryption:** When the volunteer switches report type on a partially-filled form, fields not belonging to the new type must be EXCLUDED from the client-side plaintext object before encryption. It is not sufficient to hide them from the UI. The encryption function must only include fields whose IDs are in the selected type's field list (i.e. `field.reportTypeIds` is empty OR contains the selected type ID). This prevents data entered under a previously-selected type from leaking into the encrypted payload.

> **Archived-only-type edge case:** If all types for a hub are archived, the form shows all custom fields (no type selector visible) and `report_type_id` is set to `NULL`. This matches the pre-feature behavior for hubs that have never used report types.

## Migration / Backward Compatibility

Existing reports have `report_type_id = NULL`. In the list/detail view, these show "Uncategorised" rather than a type name. The report form still works with no types configured (shows all fields, no type selector).

## Testing

- Create two types, each with distinct field sets → form only shows the correct subset per type
- Default type is pre-selected when opening report form
- Changing type re-filters fields without clearing values
- Archiving a type: it no longer appears in the dropdown; existing reports still show the type name
- `is_default` constraint: only one type per hub can be default
