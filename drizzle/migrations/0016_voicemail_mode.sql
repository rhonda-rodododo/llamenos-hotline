-- Add voicemail_mode and voicemail_retention_days to call_settings
ALTER TABLE "call_settings" ADD COLUMN "voicemail_mode" text NOT NULL DEFAULT 'auto';
ALTER TABLE "call_settings" ADD COLUMN "voicemail_retention_days" integer;
