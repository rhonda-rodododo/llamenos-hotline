-- Phase 2B: Drop plaintext org metadata columns
-- All data is now stored in encrypted columns only.
-- First, backfill any NULL encrypted columns with a placeholder to allow NOT NULL constraint.
UPDATE hubs SET encrypted_name = 'placeholder' WHERE encrypted_name IS NULL;
UPDATE roles SET encrypted_name = 'placeholder' WHERE encrypted_name IS NULL;
UPDATE custom_field_definitions SET encrypted_field_name = 'placeholder' WHERE encrypted_field_name IS NULL;
UPDATE custom_field_definitions SET encrypted_label = 'placeholder' WHERE encrypted_label IS NULL;
UPDATE report_types SET encrypted_name = 'placeholder' WHERE encrypted_name IS NULL;
UPDATE shift_schedules SET encrypted_name = 'placeholder' WHERE encrypted_name IS NULL;
UPDATE ring_groups SET encrypted_name = 'placeholder' WHERE encrypted_name IS NULL;
UPDATE blasts SET encrypted_name = 'placeholder' WHERE encrypted_name IS NULL;

ALTER TABLE hubs DROP COLUMN IF EXISTS name;
ALTER TABLE hubs DROP COLUMN IF EXISTS description;
ALTER TABLE hubs ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE roles DROP COLUMN IF EXISTS name;
ALTER TABLE roles DROP COLUMN IF EXISTS description;
-- slug kept: it is a machine-readable identifier (not PII), used for role uniqueness and auth
ALTER TABLE roles ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE custom_field_definitions DROP COLUMN IF EXISTS field_name;
ALTER TABLE custom_field_definitions DROP COLUMN IF EXISTS label;
ALTER TABLE custom_field_definitions DROP COLUMN IF EXISTS options;
ALTER TABLE custom_field_definitions ALTER COLUMN encrypted_field_name SET NOT NULL;
ALTER TABLE custom_field_definitions ALTER COLUMN encrypted_label SET NOT NULL;

ALTER TABLE report_categories DROP COLUMN IF EXISTS categories;

ALTER TABLE report_types DROP COLUMN IF EXISTS name;
ALTER TABLE report_types DROP COLUMN IF EXISTS description;
ALTER TABLE report_types ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE shift_schedules DROP COLUMN IF EXISTS name;
ALTER TABLE shift_schedules ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE ring_groups DROP COLUMN IF EXISTS name;
ALTER TABLE ring_groups ALTER COLUMN encrypted_name SET NOT NULL;

ALTER TABLE blasts DROP COLUMN IF EXISTS name;
ALTER TABLE blasts ALTER COLUMN encrypted_name SET NOT NULL;
