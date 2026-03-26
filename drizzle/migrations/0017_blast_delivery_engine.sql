-- Add scheduledAt and error to blasts
ALTER TABLE "blasts" ADD COLUMN "scheduled_at" timestamptz;
ALTER TABLE "blasts" ADD COLUMN "error" text;
-- Add encryptedIdentifier to subscribers
ALTER TABLE "subscribers" ADD COLUMN "encrypted_identifier" text;
-- Add unique constraint on blast_deliveries (blast_id, subscriber_id)
ALTER TABLE "blast_deliveries" ADD CONSTRAINT "blast_deliveries_blast_subscriber_unique" UNIQUE ("blast_id", "subscriber_id");
