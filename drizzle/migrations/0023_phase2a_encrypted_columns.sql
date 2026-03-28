-- Phase 2A: Add encrypted columns for audit_log, ivr_audio, and blast_settings
-- All new columns are nullable — no backfill needed (no production data)

-- audit_log: encrypted event and details
ALTER TABLE "audit_log" ADD COLUMN "encrypted_event" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "encrypted_details" text;--> statement-breakpoint

-- ivr_audio: encrypted audio data
ALTER TABLE "ivr_audio" ADD COLUMN "encrypted_audio_data" text;--> statement-breakpoint

-- blast_settings: encrypted message fields
ALTER TABLE "blast_settings" ADD COLUMN "encrypted_double_opt_in_message" text;--> statement-breakpoint
ALTER TABLE "blast_settings" ADD COLUMN "encrypted_welcome_message" text;--> statement-breakpoint
ALTER TABLE "blast_settings" ADD COLUMN "encrypted_bye_message" text;
