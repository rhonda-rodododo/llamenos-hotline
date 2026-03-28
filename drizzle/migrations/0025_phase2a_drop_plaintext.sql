-- Phase 2A: Drop plaintext operational fields — encrypted-only reads from now on.

ALTER TABLE "audit_log" DROP COLUMN "event";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "details";--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "encrypted_event" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "encrypted_details" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "ivr_audio" DROP COLUMN "audio_data";--> statement-breakpoint
ALTER TABLE "ivr_audio" ALTER COLUMN "encrypted_audio_data" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "blast_settings" DROP COLUMN "double_opt_in_message";--> statement-breakpoint
ALTER TABLE "blast_settings" DROP COLUMN "welcome_message";--> statement-breakpoint
ALTER TABLE "blast_settings" DROP COLUMN "bye_message";
