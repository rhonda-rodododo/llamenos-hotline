-- Add report_types table and bind report type IDs to conversations and custom fields
-- Epic: Report Types System

-- Create report_types table
CREATE TABLE IF NOT EXISTS "report_types" (
  "id" text PRIMARY KEY NOT NULL,
  "hub_id" text NOT NULL DEFAULT 'global',
  "name" text NOT NULL,
  "description" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- FK from report_types to hubs
ALTER TABLE "report_types"
  ADD CONSTRAINT "report_types_hub_id_hubs_id_fk"
  FOREIGN KEY ("hub_id") REFERENCES "hubs"("id")
  ON DELETE CASCADE;

-- Index on hub_id for listing by hub
CREATE INDEX IF NOT EXISTS "report_types_hub_idx"
  ON "report_types" ("hub_id");

-- Partial unique index: enforce only one default per hub among non-archived types
CREATE UNIQUE INDEX IF NOT EXISTS "report_types_one_default_per_hub"
  ON "report_types" ("hub_id")
  WHERE "is_default" = TRUE AND "archived_at" IS NULL;

-- Add reportTypeId FK to conversations
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "report_type_id" text;

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_report_type_id_report_types_id_fk"
  FOREIGN KEY ("report_type_id") REFERENCES "report_types"("id")
  ON DELETE SET NULL;

-- Add reportTypeIds JSONB column to custom_field_definitions
-- Stores which report type IDs show this field; empty array = shown for all types
ALTER TABLE "custom_field_definitions"
  ADD COLUMN IF NOT EXISTS "report_type_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
