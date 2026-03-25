-- Custom SQL migration file, put your code below! --

-- Add voicemail_file_id to call_records
ALTER TABLE "call_records" ADD COLUMN "voicemail_file_id" text;

-- Add configurable size limits to call_settings
ALTER TABLE "call_settings" ADD COLUMN "voicemail_max_bytes" integer NOT NULL DEFAULT 2097152;
ALTER TABLE "call_settings" ADD COLUMN "call_recording_max_bytes" integer NOT NULL DEFAULT 20971520;

-- Allow voicemail files with no associated conversation
ALTER TABLE "file_records" ALTER COLUMN "conversation_id" DROP NOT NULL;