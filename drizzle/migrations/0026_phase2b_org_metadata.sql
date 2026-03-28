-- Phase 2B: Add encrypted columns for organizational metadata

ALTER TABLE hubs ADD COLUMN encrypted_name text;
ALTER TABLE hubs ADD COLUMN encrypted_description text;

ALTER TABLE roles ADD COLUMN encrypted_name text;
ALTER TABLE roles ADD COLUMN encrypted_description text;

ALTER TABLE custom_field_definitions ADD COLUMN encrypted_field_name text;
ALTER TABLE custom_field_definitions ADD COLUMN encrypted_label text;
ALTER TABLE custom_field_definitions ADD COLUMN encrypted_options text;

ALTER TABLE report_categories ADD COLUMN encrypted_categories text;

ALTER TABLE report_types ADD COLUMN encrypted_name text;
ALTER TABLE report_types ADD COLUMN encrypted_description text;

ALTER TABLE shift_schedules ADD COLUMN encrypted_name text;

ALTER TABLE ring_groups ADD COLUMN encrypted_name text;

ALTER TABLE blasts ADD COLUMN encrypted_name text;
