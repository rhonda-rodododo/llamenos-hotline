-- Add message delivery status tracking columns to message_envelopes
-- Epic 71: Message Delivery Status

-- Create the enum type for delivery status
DO $$ BEGIN
  CREATE TYPE "message_delivery_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add delivery status columns to message_envelopes
ALTER TABLE "message_envelopes"
  ADD COLUMN IF NOT EXISTS "delivery_status" "message_delivery_status" NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "delivery_status_updated_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "provider_message_id" varchar(128),
  ADD COLUMN IF NOT EXISTS "delivery_error" text;

-- Backfill delivery_status from existing status text field
UPDATE "message_envelopes"
SET "delivery_status" = CASE
  WHEN "status" = 'sent' THEN 'sent'::message_delivery_status
  WHEN "status" = 'delivered' THEN 'delivered'::message_delivery_status
  WHEN "status" = 'read' THEN 'read'::message_delivery_status
  WHEN "status" = 'failed' THEN 'failed'::message_delivery_status
  ELSE 'pending'::message_delivery_status
END
WHERE "delivery_status" = 'pending';

-- Backfill provider_message_id from existing external_id where not already set
UPDATE "message_envelopes"
SET "provider_message_id" = "external_id"
WHERE "provider_message_id" IS NULL AND "external_id" IS NOT NULL;

-- Create index for fast lookups by provider_message_id (used for status callbacks)
CREATE INDEX IF NOT EXISTS "idx_message_envelopes_provider_message_id"
  ON "message_envelopes" ("provider_message_id")
  WHERE "provider_message_id" IS NOT NULL;
