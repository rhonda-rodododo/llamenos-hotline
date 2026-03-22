CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" text
);
--> statement-breakpoint
CREATE TABLE "provision_rooms" (
	"room_id" text PRIMARY KEY NOT NULL,
	"ephemeral_pubkey" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"encrypted_nsec" text,
	"primary_pubkey" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteers" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hub_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_secret_key" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"transcription_enabled" boolean DEFAULT true NOT NULL,
	"spoken_languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ui_language" text DEFAULT 'en' NOT NULL,
	"profile_completed" boolean DEFAULT false NOT NULL,
	"on_break" boolean DEFAULT false NOT NULL,
	"call_preference" text DEFAULT 'phone' NOT NULL,
	"supported_messaging_channels" jsonb,
	"messaging_enabled" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"pubkey" text,
	"challenge" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" text DEFAULT '0' NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"require_for_admins" boolean DEFAULT false NOT NULL,
	"require_for_volunteers" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_settings" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"queue_timeout_seconds" integer DEFAULT 90 NOT NULL,
	"voicemail_max_seconds" integer DEFAULT 120 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captcha_state" (
	"call_sid" text PRIMARY KEY NOT NULL,
	"expected_digits" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"field_name" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"show_in_volunteer_view" boolean DEFAULT false NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fallback_group" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"volunteer_pubkeys" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_keys" (
	"hub_id" text NOT NULL,
	"pubkey" text NOT NULL,
	"encrypted_key" text NOT NULL,
	CONSTRAINT "hub_keys_hub_id_pubkey_pk" PRIMARY KEY("hub_id","pubkey")
);
--> statement-breakpoint
CREATE TABLE "hubs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"nostr_pubkey" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_audio" (
	"hub_id" text DEFAULT 'global' NOT NULL,
	"prompt_type" text NOT NULL,
	"language" text NOT NULL,
	"audio_data" text NOT NULL,
	"mime_type" text DEFAULT 'audio/mpeg' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ivr_audio_hub_id_prompt_type_language_pk" PRIMARY KEY("hub_id","prompt_type","language")
);
--> statement-breakpoint
CREATE TABLE "ivr_languages" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"languages" jsonb DEFAULT '["en"]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_config" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_categories" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_state" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spam_settings" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"voice_captcha_enabled" boolean DEFAULT false NOT NULL,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"max_calls_per_minute" integer DEFAULT 5 NOT NULL,
	"block_duration_minutes" integer DEFAULT 60 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telephony_config" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_settings" (
	"hub_id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"global_enabled" boolean DEFAULT false NOT NULL,
	"allow_volunteer_opt_out" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"event" text NOT NULL,
	"actor_pubkey" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previous_entry_hash" text,
	"entry_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"phone" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"banned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_records" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"caller_last4" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration" integer,
	"status" text DEFAULT 'completed' NOT NULL,
	"has_transcription" boolean DEFAULT false NOT NULL,
	"has_voicemail" boolean DEFAULT false NOT NULL,
	"has_recording" boolean DEFAULT false NOT NULL,
	"recording_sid" text,
	"encrypted_content" text,
	"admin_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_envelopes" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"call_id" text,
	"conversation_id" text,
	"contact_hash" text,
	"author_pubkey" text NOT NULL,
	"encrypted_content" text NOT NULL,
	"ephemeral_pubkey" text,
	"author_envelope" jsonb,
	"admin_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "active_shifts" (
	"pubkey" text NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ring_group_id" text,
	CONSTRAINT "active_shifts_pubkey_hub_id_pk" PRIMARY KEY("pubkey","hub_id")
);
--> statement-breakpoint
CREATE TABLE "ring_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"name" text NOT NULL,
	"volunteer_pubkeys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"schedule_id" text,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"volunteer_pubkeys" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"volunteer_pubkeys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ring_group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "active_calls" (
	"call_sid" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"caller_number" text NOT NULL,
	"status" text DEFAULT 'ringing' NOT NULL,
	"assigned_pubkey" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_legs" (
	"leg_sid" text PRIMARY KEY NOT NULL,
	"call_sid" text NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"volunteer_pubkey" text NOT NULL,
	"phone" text,
	"status" text DEFAULT 'ringing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"call_sid" text NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"pubkey" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"channel_type" text NOT NULL,
	"contact_identifier_hash" text NOT NULL,
	"contact_last4" text,
	"external_id" text,
	"assigned_to" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_hub_id_channel_type_contact_identifier_hash_unique" UNIQUE("hub_id","channel_type","contact_identifier_hash")
);
--> statement-breakpoint
CREATE TABLE "message_envelopes" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"author_pubkey" text NOT NULL,
	"encrypted_content" text NOT NULL,
	"reader_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blast_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"blast_id" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blasts" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"phone_number" text NOT NULL,
	"channel" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"token" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_hub_id_channel_phone_number_unique" UNIQUE("hub_id","channel","phone_number")
);
