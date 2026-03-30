-- Rename content to encrypted_content for blast envelope encryption
ALTER TABLE "blasts" RENAME COLUMN "content" TO "encrypted_content";
-- Add content_envelopes column for per-admin ECIES wrapped keys
ALTER TABLE "blasts" ADD COLUMN "content_envelopes" jsonb NOT NULL DEFAULT '[]';
