CREATE TABLE "blast_settings" (
	"hub_id" text PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blasts" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"name" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"target_channels" text[] DEFAULT '{}'::text[],
	"target_tags" text[] DEFAULT '{}'::text[],
	"target_languages" text[] DEFAULT '{}'::text[],
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"identifier_hash" text NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[],
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"double_opt_in_confirmed" boolean DEFAULT false,
	"preference_token" text,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_preference_token_unique" UNIQUE("preference_token"),
	CONSTRAINT "subscribers_hub_identifier_idx" UNIQUE("hub_id","identifier_hash")
);
--> statement-breakpoint
CREATE TABLE "active_calls" (
	"call_id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"caller_number" text NOT NULL,
	"caller_last4" text,
	"answered_by" text,
	"status" text DEFAULT 'ringing' NOT NULL,
	"has_transcription" boolean DEFAULT false,
	"has_voicemail" boolean DEFAULT false,
	"has_recording" boolean DEFAULT false,
	"recording_sid" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration" integer
);
--> statement-breakpoint
CREATE TABLE "call_records" (
	"call_id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"caller_last4" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration" integer,
	"status" text NOT NULL,
	"has_transcription" boolean DEFAULT false,
	"has_voicemail" boolean DEFAULT false,
	"has_recording" boolean DEFAULT false,
	"recording_sid" text,
	"encrypted_content" text NOT NULL,
	"admin_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_contacts" (
	"case_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text NOT NULL,
	CONSTRAINT "case_contacts_case_id_contact_id_pk" PRIMARY KEY("case_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"case_id" text NOT NULL,
	"event_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by" text NOT NULL,
	CONSTRAINT "case_events_case_id_event_id_pk" PRIMARY KEY("case_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "case_interactions" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"interaction_type" text NOT NULL,
	"source_id" text,
	"encrypted_content" text,
	"content_envelopes" jsonb,
	"author_pubkey" text NOT NULL,
	"interaction_type_hash" text NOT NULL,
	"previous_status_hash" text,
	"new_status_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_records" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"entity_type_id" text,
	"case_number" text,
	"status_hash" text NOT NULL,
	"severity_hash" text,
	"category_hash" text,
	"assigned_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"blind_indexes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_summary" text,
	"summary_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_fields" text,
	"field_envelopes" jsonb,
	"encrypted_pii" text,
	"pii_envelopes" jsonb,
	"contact_count" integer DEFAULT 0 NOT NULL,
	"interaction_count" integer DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"event_ids" text[] DEFAULT '{}'::text[],
	"report_ids" text[] DEFAULT '{}'::text[],
	"parent_record_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "custody_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"evidence_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_pubkey" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"integrity_hash" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"entity_type_id" text,
	"case_number" text,
	"start_date" text,
	"end_date" text,
	"parent_event_id" text,
	"location_precision" text DEFAULT 'neighborhood',
	"location_approximate" text,
	"event_type_hash" text NOT NULL,
	"status_hash" text NOT NULL,
	"blind_indexes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_details" text,
	"detail_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"case_count" integer DEFAULT 0 NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"sub_event_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"file_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"classification" text NOT NULL,
	"integrity_hash" text NOT NULL,
	"hash_algorithm" text DEFAULT 'sha256' NOT NULL,
	"source" text,
	"source_description" text,
	"encrypted_description" text,
	"description_envelopes" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text NOT NULL,
	"custody_entry_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_cases" (
	"report_id" text NOT NULL,
	"case_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by" text NOT NULL,
	"encrypted_notes" text,
	"notes_envelopes" jsonb,
	CONSTRAINT "report_cases_report_id_case_id_pk" PRIMARY KEY("report_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "report_events" (
	"report_id" text NOT NULL,
	"event_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by" text NOT NULL,
	CONSTRAINT "report_events_report_id_event_id_pk" PRIMARY KEY("report_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "affinity_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"encrypted_details" text NOT NULL,
	"detail_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"contact_id_a" text NOT NULL,
	"contact_id_b" text NOT NULL,
	"relationship_type" text NOT NULL,
	"direction" text DEFAULT 'bidirectional' NOT NULL,
	"encrypted_notes" text,
	"notes_envelopes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"identifier_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"name_hash" text,
	"trigram_tokens" text[],
	"encrypted_summary" text NOT NULL,
	"summary_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_pii" text,
	"pii_envelopes" jsonb,
	"contact_type_hash" text,
	"tag_hashes" text[] DEFAULT '{}'::text[],
	"status_hash" text,
	"blind_indexes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"case_count" integer DEFAULT 0 NOT NULL,
	"note_count" integer DEFAULT 0 NOT NULL,
	"interaction_count" integer DEFAULT 0 NOT NULL,
	"last_interaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" text,
	"is_primary" boolean DEFAULT false,
	CONSTRAINT "group_members_group_id_contact_id_pk" PRIMARY KEY("group_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_identifiers" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"encrypted_identifier" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"channel_type" text DEFAULT 'web' NOT NULL,
	"contact_identifier_hash" text DEFAULT '' NOT NULL,
	"contact_last4" text,
	"assigned_to" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text,
	"message_id" text,
	"uploaded_by" text NOT NULL,
	"recipient_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_size" integer DEFAULT 0 NOT NULL,
	"total_chunks" integer DEFAULT 1 NOT NULL,
	"completed_chunks" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"author_pubkey" text,
	"external_id" text,
	"encrypted_content" text NOT NULL,
	"reader_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_attachments" boolean DEFAULT false,
	"attachment_ids" text[],
	"status" text DEFAULT 'sent',
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"platform" text NOT NULL,
	"push_token" text,
	"voip_token" text,
	"wake_key_public" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text,
	"hub_id" text,
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
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"device_info" jsonb
);
--> statement-breakpoint
CREATE TABLE "volunteers" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"roles" text[] DEFAULT '{"volunteer"}'::text[] NOT NULL,
	"display_name" text,
	"phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"hub_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability" text DEFAULT 'unavailable' NOT NULL,
	"on_break" boolean DEFAULT false,
	"call_preference" text,
	"spoken_languages" text[] DEFAULT '{}'::text[],
	"ui_language" text,
	"transcription_enabled" boolean DEFAULT true,
	"profile_completed" boolean DEFAULT false,
	"active" boolean DEFAULT true NOT NULL,
	"encrypted_secret_key" text DEFAULT '',
	"supported_messaging_channels" text[],
	"messaging_enabled" boolean,
	"specializations" text[] DEFAULT '{}'::text[],
	"max_case_assignments" integer,
	"team_id" text,
	"supervisor_pubkey" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"challenge_id" text PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"credential_id" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[],
	"backed_up" boolean DEFAULT false,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "captchas" (
	"call_sid" text PRIMARY KEY NOT NULL,
	"expected" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_number_sequences" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "case_number_sequences_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"required" boolean DEFAULT false,
	"options" text[],
	"validation" jsonb,
	"visible_to_volunteers" boolean DEFAULT true,
	"editable_by_volunteers" boolean DEFAULT true,
	"context" text DEFAULT 'all' NOT NULL,
	"max_file_size" integer,
	"allowed_mime_types" text[],
	"max_files" integer DEFAULT 1,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_type_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"label_plural" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"color" text,
	"category" text DEFAULT 'case' NOT NULL,
	"template_id" text,
	"template_version" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"statuses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_status" text DEFAULT '' NOT NULL,
	"closed_statuses" text[] DEFAULT '{}'::text[],
	"severities" jsonb,
	"default_severity" text,
	"categories" jsonb,
	"contact_roles" jsonb,
	"number_prefix" text,
	"numbering_enabled" boolean DEFAULT false,
	"default_access_level" text DEFAULT 'assigned' NOT NULL,
	"pii_fields" text[] DEFAULT '{}'::text[],
	"allow_sub_records" boolean DEFAULT false,
	"allow_file_attachments" boolean DEFAULT true,
	"allow_interaction_links" boolean DEFAULT true,
	"show_in_navigation" boolean DEFAULT true,
	"show_in_dashboard" boolean DEFAULT true,
	"access_roles" text[],
	"edit_roles" text[],
	"is_archived" boolean DEFAULT false,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_keys" (
	"hub_id" text NOT NULL,
	"recipient_pubkey" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"ephemeral_pubkey" text NOT NULL,
	CONSTRAINT "hub_keys_hub_id_recipient_pubkey_pk" PRIMARY KEY("hub_id","recipient_pubkey")
);
--> statement-breakpoint
CREATE TABLE "hub_settings" (
	"hub_id" text PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"telephony_provider" jsonb,
	"phone_number" text
);
--> statement-breakpoint
CREATE TABLE "hubs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"phone_number" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hubs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ivr_audio" (
	"prompt_type" text NOT NULL,
	"language" text NOT NULL,
	"audio" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ivr_audio_prompt_type_language_pk" PRIMARY KEY("prompt_type","language")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"timestamps" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_type_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT '' NOT NULL,
	"source_entity_type_id" text,
	"target_entity_type_id" text,
	"cardinality" text DEFAULT 'M:N' NOT NULL,
	"label" text NOT NULL,
	"reverse_label" text DEFAULT '' NOT NULL,
	"source_label" text DEFAULT '' NOT NULL,
	"target_label" text DEFAULT '' NOT NULL,
	"roles" jsonb,
	"default_role" text,
	"join_fields" jsonb,
	"cascade_delete" boolean DEFAULT false,
	"required" boolean DEFAULT false,
	"template_id" text,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_type_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"label_plural" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"color" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"statuses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_status" text DEFAULT '' NOT NULL,
	"closed_statuses" text[] DEFAULT '{}'::text[],
	"allow_case_conversion" boolean DEFAULT false,
	"mobile_optimized" boolean DEFAULT false,
	"template_id" text,
	"is_archived" boolean DEFAULT false,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_default" boolean DEFAULT false,
	"is_system" boolean DEFAULT false,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"spam_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"call_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transcription_enabled" boolean DEFAULT true,
	"allow_volunteer_transcription_opt_out" boolean DEFAULT false,
	"ivr_languages" text[] DEFAULT '{}'::text[],
	"messaging_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"telephony_provider" jsonb,
	"setup_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webauthn_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"case_management_enabled" boolean DEFAULT false,
	"cross_hub_sharing_enabled" boolean DEFAULT false,
	"auto_assignment_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cross_hub_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ttl_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_templates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fallback_group" text[] DEFAULT '{}'::text[],
	"report_categories" text[] DEFAULT '{"Incident Report","Field Observation","Evidence","Other"}'::text[],
	"report_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cms_report_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ivr_audio_meta" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cleanup_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"action" text NOT NULL,
	"actor_pubkey" text NOT NULL,
	"details" jsonb,
	"previous_entry_hash" text,
	"entry_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"phone" text NOT NULL,
	"reason" text,
	"banned_by" text,
	"banned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_metadata" (
	"contact_hash" text NOT NULL,
	"hub_id" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"note_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "contact_metadata_contact_hash_hub_id_pk" PRIMARY KEY("contact_hash","hub_id")
);
--> statement-breakpoint
CREATE TABLE "note_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"author_pubkey" text NOT NULL,
	"encrypted_content" text NOT NULL,
	"reader_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"author_pubkey" text NOT NULL,
	"call_id" text,
	"conversation_id" text,
	"contact_hash" text,
	"encrypted_content" text NOT NULL,
	"author_envelope" jsonb NOT NULL,
	"admin_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_fields" text,
	"field_envelopes" jsonb,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_reminders_sent" (
	"shift_id" text NOT NULL,
	"reminder_date" text NOT NULL,
	"pubkey" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_reminders_sent_shift_id_reminder_date_pubkey_pk" PRIMARY KEY("shift_id","reminder_date","pubkey")
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"days" integer[] DEFAULT '{}'::int[] NOT NULL,
	"volunteer_pubkeys" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_type" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nostr_event_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"attempts" integer DEFAULT 0,
	"next_retry_at" timestamp with time zone DEFAULT now(),
	"status" text DEFAULT 'pending'
);
--> statement-breakpoint
ALTER TABLE "contact_identifiers" ADD CONSTRAINT "contact_identifiers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_pubkey_volunteers_pubkey_fk" FOREIGN KEY ("pubkey") REFERENCES "public"."volunteers"("pubkey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_pubkey_volunteers_pubkey_fk" FOREIGN KEY ("pubkey") REFERENCES "public"."volunteers"("pubkey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_pubkey_volunteers_pubkey_fk" FOREIGN KEY ("pubkey") REFERENCES "public"."volunteers"("pubkey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_keys" ADD CONSTRAINT "hub_keys_hub_id_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_settings" ADD CONSTRAINT "hub_settings_hub_id_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_replies" ADD CONSTRAINT "note_replies_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "active_calls_hub_id_status_idx" ON "active_calls" USING btree ("hub_id","status");--> statement-breakpoint
CREATE INDEX "active_calls_started_at_idx" ON "active_calls" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "call_records_hub_id_idx" ON "call_records" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "call_records_started_at_idx" ON "call_records" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "case_interactions_case_id_created_at_idx" ON "case_interactions" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "case_interactions_source_id_idx" ON "case_interactions" USING btree ("source_id") WHERE source_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "case_interactions_case_id_interaction_type_idx" ON "case_interactions" USING btree ("case_id","interaction_type");--> statement-breakpoint
CREATE INDEX "case_records_hub_id_idx" ON "case_records" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "case_records_hub_id_status_hash_idx" ON "case_records" USING btree ("hub_id","status_hash");--> statement-breakpoint
CREATE INDEX "case_records_hub_id_severity_hash_idx" ON "case_records" USING btree ("hub_id","severity_hash");--> statement-breakpoint
CREATE INDEX "case_records_entity_type_id_idx" ON "case_records" USING btree ("entity_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_records_case_number_idx" ON "case_records" USING btree ("case_number") WHERE case_number IS NOT NULL;--> statement-breakpoint
CREATE INDEX "case_records_assigned_to_idx" ON "case_records" USING gin ("assigned_to");--> statement-breakpoint
CREATE INDEX "case_records_hub_id_category_hash_idx" ON "case_records" USING btree ("hub_id","category_hash");--> statement-breakpoint
CREATE INDEX "custody_entries_evidence_id_timestamp_idx" ON "custody_entries" USING btree ("evidence_id","timestamp");--> statement-breakpoint
CREATE INDEX "events_hub_id_idx" ON "events" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "events_parent_event_id_idx" ON "events" USING btree ("parent_event_id");--> statement-breakpoint
CREATE INDEX "events_hub_id_status_hash_idx" ON "events" USING btree ("hub_id","status_hash");--> statement-breakpoint
CREATE INDEX "evidence_case_id_idx" ON "evidence" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "contact_relationships_contact_id_a_idx" ON "contact_relationships" USING btree ("contact_id_a");--> statement-breakpoint
CREATE INDEX "contact_relationships_contact_id_b_idx" ON "contact_relationships" USING btree ("contact_id_b");--> statement-breakpoint
CREATE INDEX "contacts_hub_id_idx" ON "contacts" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "contacts_identifier_hashes_idx" ON "contacts" USING gin ("identifier_hashes");--> statement-breakpoint
CREATE INDEX "contacts_name_hash_idx" ON "contacts" USING btree ("name_hash") WHERE name_hash IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contacts_tag_hashes_idx" ON "contacts" USING gin ("tag_hashes");--> statement-breakpoint
CREATE INDEX "conversations_hub_status_idx" ON "conversations" USING btree ("hub_id","status");--> statement-breakpoint
CREATE INDEX "conversations_assigned_to_idx" ON "conversations" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_id_idx" ON "messages" USING btree ("external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "devices_pubkey_idx" ON "devices" USING btree ("pubkey");--> statement-breakpoint
CREATE INDEX "sessions_pubkey_idx" ON "sessions" USING btree ("pubkey");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_pubkey_idx" ON "webauthn_credentials" USING btree ("pubkey");--> statement-breakpoint
CREATE INDEX "audit_log_hub_id_created_at_idx" ON "audit_log" USING btree ("hub_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "bans_hub_id_phone_idx" ON "bans" USING btree ("hub_id","phone");--> statement-breakpoint
CREATE INDEX "note_replies_note_id_idx" ON "note_replies" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "notes_hub_id_idx" ON "notes" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "notes_author_pubkey_idx" ON "notes" USING btree ("author_pubkey");--> statement-breakpoint
CREATE INDEX "notes_contact_hash_idx" ON "notes" USING btree ("contact_hash");--> statement-breakpoint
CREATE INDEX "notes_created_at_idx" ON "notes" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scheduled_tasks_unclaimed_idx" ON "scheduled_tasks" USING btree ("run_at") WHERE claimed_at IS NULL;--> statement-breakpoint
CREATE INDEX "nostr_event_outbox_pending_idx" ON "nostr_event_outbox" USING btree ("status","next_retry_at") WHERE status = 'pending';