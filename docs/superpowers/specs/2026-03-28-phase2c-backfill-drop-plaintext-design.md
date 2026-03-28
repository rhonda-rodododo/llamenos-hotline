# Field-Level Encryption Phase 2C: Backfill & Drop Plaintext

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Backfill encryption for all Phase 2A + 2B tables, drop plaintext columns, remove dual-read fallbacks
**Prerequisite:** Phase 2A and 2B schema + service changes complete

## Problem

After Phase 2A and 2B add encrypted columns and implement encrypt-on-write with dual-read fallbacks, any existing plaintext data still sits in the database unencrypted. The plaintext columns must be backfilled and dropped to complete the zero-knowledge database goal.

## Scope

### Tables from Phase 2A (server-key)

| Table | Plaintext → Encrypted |
|---|---|
| `blast_settings` | `welcome_message`, `bye_message`, `double_opt_in_message` |
| `audit_log` | `event`, `details` |
| `ivr_audio` | `audio_data` |
| `hubs` | `slug` (dropped entirely) |

### Tables from Phase 2B (server-key, future hub-key)

| Table | Plaintext → Encrypted |
|---|---|
| `hubs` | `name`, `description` |
| `roles` | `name`, `description` |
| `custom_field_definitions` | `field_name`, `label`, `options` |
| `report_types` | `name`, `description` |
| `report_categories` | `categories` |
| `shift_schedules` | `name` |
| `ring_groups` | `name` |
| `blasts` | `name` |

## Design

### Backfill Script

Extend `scripts/migrate-encrypt-pii.ts` (or create `scripts/migrate-encrypt-phase2.ts`) to handle all Phase 2 tables. Same idempotent pattern: select rows where encrypted column is NULL, encrypt, update.

All fields use `CryptoService.serverEncrypt()` with appropriate labels:
- Phase 2A fields: `LABEL_AUDIT_EVENT`, `LABEL_IVR_AUDIO`, `LABEL_VOLUNTEER_PII` (blast settings)
- Phase 2B fields: `LABEL_ORG_METADATA`

### Drop Plaintext Migration

After backfill verification:

```sql
-- Phase 2A drops
ALTER TABLE blast_settings DROP COLUMN welcome_message, DROP COLUMN bye_message, DROP COLUMN double_opt_in_message;
ALTER TABLE audit_log DROP COLUMN event, DROP COLUMN details;
ALTER TABLE ivr_audio DROP COLUMN audio_data;
ALTER TABLE hubs DROP COLUMN slug;

-- Phase 2B drops
ALTER TABLE hubs DROP COLUMN name, DROP COLUMN description;
ALTER TABLE roles DROP COLUMN name, DROP COLUMN description;
ALTER TABLE custom_field_definitions DROP COLUMN field_name, DROP COLUMN label, DROP COLUMN options;
ALTER TABLE report_types DROP COLUMN name, DROP COLUMN description;
ALTER TABLE report_categories DROP COLUMN categories;
ALTER TABLE shift_schedules DROP COLUMN name;
ALTER TABLE ring_groups DROP COLUMN name;
ALTER TABLE blasts DROP COLUMN name;

-- NOT NULL constraints
ALTER TABLE blast_settings ALTER COLUMN encrypted_welcome_message SET NOT NULL; -- if applicable
ALTER TABLE audit_log ALTER COLUMN encrypted_event SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN encrypted_details SET NOT NULL;
ALTER TABLE ivr_audio ALTER COLUMN encrypted_audio_data SET NOT NULL;
ALTER TABLE hubs ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE roles ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE custom_field_definitions ALTER COLUMN encrypted_field_name SET NOT NULL;
ALTER TABLE custom_field_definitions ALTER COLUMN encrypted_label SET NOT NULL;
ALTER TABLE report_types ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE shift_schedules ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE ring_groups ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE blasts ALTER COLUMN encrypted_name SET NOT NULL;
```

### Service Cleanup

Remove all dual-read fallback patterns (`row.encryptedX ? decrypt(row.encryptedX) : row.x`) from:
- `SettingsService` (hubs, roles, custom fields, report categories, blast settings)
- `ShiftService` (shift schedules, ring groups)
- `BlastService` (blast name)
- `RecordsService` (audit log)
- `ReportTypeService` (report types)

### Verification

- Query every affected table to verify zero NULL encrypted columns
- Verify no plaintext columns remain in schema
- All unit + API + E2E tests pass
- Audit log hash chain integrity verification after encryption

## Testing

- Backfill idempotency: run twice, verify same result
- Hash chain integrity: audit log entries verify after encrypt/decrypt
- All API tests pass with encrypted-only reads
- TypeScript strict mode: zero errors after plaintext column removal
