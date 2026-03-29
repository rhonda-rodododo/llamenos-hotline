CREATE TABLE "contact_call_links" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"contact_id" text NOT NULL,
	"call_id" text NOT NULL,
	"linked_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_conversation_links" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"linked_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"encrypted_payload" text NOT NULL,
	"payload_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text DEFAULT 'global' NOT NULL,
	"contact_type" text DEFAULT 'caller' NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"identifier_hash" text,
	"encrypted_display_name" text NOT NULL,
	"display_name_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_notes" text,
	"notes_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_full_name" text,
	"full_name_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_phone" text,
	"phone_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_pii" text,
	"pii_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_interaction_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "contact_call_links_contact_idx" ON "contact_call_links" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_call_links_call_idx" ON "contact_call_links" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "contact_conversation_links_contact_idx" ON "contact_conversation_links" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_conversation_links_conversation_idx" ON "contact_conversation_links" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "contact_relationships_hub_idx" ON "contact_relationships" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "contacts_hub_idx" ON "contacts" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "contacts_identifier_hash_idx" ON "contacts" USING btree ("hub_id","identifier_hash");