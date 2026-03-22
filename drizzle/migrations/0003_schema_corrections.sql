-- Schema corrections: blast privacy refactor, GDPR tables, new schema fields
-- Pre-production: drop & recreate heavily modified tables; add columns to lightly modified ones

--> statement-breakpoint
-- 1. Drop and recreate subscribers (phone_number → identifier_hash, channel → channels JSONB array, etc.)
DROP TABLE IF EXISTS "blast_deliveries";
--> statement-breakpoint
DROP TABLE IF EXISTS "subscribers";
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"identifier_hash" text NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" text,
	"status" text DEFAULT 'active' NOT NULL,
	"double_opt_in_confirmed" boolean DEFAULT false NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"preference_token" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_hub_id_identifier_hash_unique" UNIQUE("hub_id","identifier_hash")
);
--> statement-breakpoint
-- 2. Drop and recreate blasts (channel → targetChannels JSONB, flat counts → stats JSONB)
DROP TABLE IF EXISTS "blasts";
--> statement-breakpoint
CREATE TABLE "blasts" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"target_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"stats" jsonb DEFAULT '{"totalRecipients":0,"sent":0,"delivered":0,"failed":0,"optedOut":0}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
-- 3. Recreate blast_deliveries with channelType and deliveredAt
CREATE TABLE "blast_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"blast_id" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"channel_type" text DEFAULT 'sms' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
-- 4. New blast_settings table
CREATE TABLE IF NOT EXISTS "blast_settings" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"opt_in_keywords" jsonb DEFAULT '["START","JOIN","YES"]'::jsonb NOT NULL,
	"opt_out_keywords" jsonb DEFAULT '["STOP","UNSUBSCRIBE","CANCEL"]'::jsonb NOT NULL,
	"double_opt_in_enabled" boolean DEFAULT false NOT NULL,
	"double_opt_in_message" text,
	"welcome_message" text,
	"bye_message" text
);
--> statement-breakpoint
-- 5. New note_replies table
CREATE TABLE IF NOT EXISTS "note_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"parent_note_id" text NOT NULL,
	"encrypted_content" text NOT NULL,
	"author_envelope" text NOT NULL,
	"admin_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_pubkey" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 6. GDPR tables
CREATE TABLE IF NOT EXISTS "gdpr_consents" (
	"pubkey" text NOT NULL,
	"consent_version" text DEFAULT '1.0' NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gdpr_erasure_requests" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"execute_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retention_settings" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 7. Geocoding config table
CREATE TABLE IF NOT EXISTS "geocoding_config" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 8. Alter hubs: add allow_super_admin_access
ALTER TABLE "hubs" ADD COLUMN IF NOT EXISTS "allow_super_admin_access" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- 9. Alter hub_keys: add ephemeral_pubkey and created_at
ALTER TABLE "hub_keys" ADD COLUMN IF NOT EXISTS "ephemeral_pubkey" text;
--> statement-breakpoint
ALTER TABLE "hub_keys" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- 10. Alter custom_field_definitions: add context
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "context" text DEFAULT 'notes' NOT NULL;
--> statement-breakpoint
-- 11. Alter file_records: add hub_id (created in 0002 without it)
ALTER TABLE "file_records" ADD COLUMN IF NOT EXISTS "hub_id" text DEFAULT 'global' NOT NULL;
