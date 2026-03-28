# Field-Level Encryption Phase 2C: Drop Plaintext Columns

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Drop plaintext columns and remove any remaining fallback code for all Phase 2A + 2B tables
**Prerequisite:** Phase 2A and 2B fully deployed

## Problem

After Phase 2A and 2B add encrypted columns and implement encryption, the plaintext columns still exist in the schema (nullable, unused). They must be dropped to complete the zero-knowledge database goal and prevent accidental plaintext writes.

## Scope

**No backfill needed** — the database has no production data. All new writes go directly to encrypted columns.

### Columns to drop

#### From Phase 2A (server-key fields)

| Table | Drop |
|---|---|
| `blast_settings` | `welcome_message`, `bye_message`, `double_opt_in_message` |
| `audit_log` | `event`, `details` |
| `ivr_audio` | `audio_data` |
| `hubs` | `slug` |

#### From Phase 2B (hub-key E2EE fields)

| Table | Drop |
|---|---|
| `hubs` | `name`, `description` |
| `roles` | `name`, `slug`, `description` |
| `custom_field_definitions` | `field_name`, `label`, `options` |
| `report_types` | `name`, `description` |
| `report_categories` | `categories` |
| `shift_schedules` | `name` |
| `ring_groups` | `name` |
| `blasts` | `name` |

### NOT NULL constraints to add

All encrypted columns that are required:
- `hubs.encrypted_name`
- `roles.encrypted_name`
- `custom_field_definitions.encrypted_field_name`, `encrypted_label`
- `report_types.encrypted_name`
- `shift_schedules.encrypted_name`
- `ring_groups.encrypted_name`
- `blasts.encrypted_name`
- `audit_log.encrypted_event`, `encrypted_details`
- `ivr_audio.encrypted_audio_data`

Nullable encrypted columns (optional fields):
- `hubs.encrypted_description`
- `roles.encrypted_description`
- `report_types.encrypted_description`
- `custom_field_definitions.encrypted_options`
- `report_categories.encrypted_categories`
- `blast_settings.encrypted_*` (all three — may be empty)

## Design

### Migration SQL

Single Drizzle migration with DROP COLUMN and ALTER COLUMN SET NOT NULL statements.

### Service cleanup

Remove any remaining dual-read fallback patterns or plaintext column references from services. After Phase 2A and 2B, there should be minimal cleanup — but verify with `grep` for old column names.

### TypeScript verification

After schema changes, `npx tsc --noEmit` must pass — any code referencing dropped columns will error.

## Testing

- All unit + API + E2E tests pass
- `npx tsc --noEmit` — zero errors
- Verify no plaintext columns remain: query `information_schema.columns` for old column names
