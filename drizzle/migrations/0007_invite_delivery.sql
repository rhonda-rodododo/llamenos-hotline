-- Add invite delivery tracking columns to invite_codes table
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "recipient_phone_hash" text;
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "delivery_channel" varchar(16);
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "delivery_sent_at" timestamp with time zone;
