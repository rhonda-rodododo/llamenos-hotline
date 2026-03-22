CREATE TABLE IF NOT EXISTS "file_records" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"uploaded_by" text NOT NULL,
	"recipient_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_size" integer NOT NULL,
	"total_chunks" integer NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"completed_chunks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
