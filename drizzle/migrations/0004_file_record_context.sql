-- Add context binding columns to file_records for custom field attachments
ALTER TABLE "file_records"
  ADD COLUMN IF NOT EXISTS "context_type" text,
  ADD COLUMN IF NOT EXISTS "context_id" text;
