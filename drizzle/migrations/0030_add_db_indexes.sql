-- Add 13 missing database indexes for hot query paths
-- records.ts
CREATE INDEX IF NOT EXISTS "bans_hub_phone_hash_idx" ON "bans" ("hub_id","phone_hash");
CREATE INDEX IF NOT EXISTS "audit_log_hub_idx" ON "audit_log" ("hub_id");
CREATE INDEX IF NOT EXISTS "audit_log_hub_created_idx" ON "audit_log" ("hub_id","created_at");
CREATE INDEX IF NOT EXISTS "call_records_hub_idx" ON "call_records" ("hub_id");
CREATE INDEX IF NOT EXISTS "call_records_hub_started_idx" ON "call_records" ("hub_id","started_at");
CREATE INDEX IF NOT EXISTS "note_envelopes_hub_idx" ON "note_envelopes" ("hub_id");
CREATE INDEX IF NOT EXISTS "note_envelopes_call_idx" ON "note_envelopes" ("call_id");
CREATE INDEX IF NOT EXISTS "note_envelopes_contact_hash_idx" ON "note_envelopes" ("contact_hash");
-- calls.ts
CREATE INDEX IF NOT EXISTS "active_calls_hub_idx" ON "active_calls" ("hub_id");
CREATE INDEX IF NOT EXISTS "call_legs_call_sid_idx" ON "call_legs" ("call_sid");
-- conversations.ts
CREATE INDEX IF NOT EXISTS "conversations_hub_idx" ON "conversations" ("hub_id");
CREATE INDEX IF NOT EXISTS "message_envelopes_conversation_idx" ON "message_envelopes" ("conversation_id");
-- shifts.ts
CREATE INDEX IF NOT EXISTS "shift_schedules_hub_idx" ON "shift_schedules" ("hub_id");
