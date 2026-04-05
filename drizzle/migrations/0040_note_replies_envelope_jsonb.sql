-- Migrate note_replies.author_envelope from text to jsonb for consistency with
-- every other envelope field in the schema (noteEnvelopes.authorEnvelope etc.).
-- Existing values are JSON strings, so USING jsonb_parse is safe.
ALTER TABLE note_replies ALTER COLUMN author_envelope TYPE jsonb USING author_envelope::jsonb;
