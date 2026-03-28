-- Task 8: Add encrypted columns alongside plaintext for field-encryption migration
-- All new encrypted columns are nullable (backfill in Task 10, drop plaintext in Task 12)

-- volunteers: encrypted name + phone
ALTER TABLE "volunteers" ADD COLUMN "encrypted_name" text;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "name_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "encrypted_phone" text;--> statement-breakpoint

-- invite_codes: encrypted name + phone, recipient_phone_hash stays as-is (type-only change)
ALTER TABLE "invite_codes" ADD COLUMN "encrypted_name" text;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD COLUMN "name_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD COLUMN "encrypted_phone" text;--> statement-breakpoint

-- webauthn_credentials: encrypted label
ALTER TABLE "webauthn_credentials" ADD COLUMN "encrypted_label" text;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD COLUMN "label_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

-- active_calls: encrypted caller number
ALTER TABLE "active_calls" ADD COLUMN "encrypted_caller_number" text;--> statement-breakpoint

-- call_legs: encrypted phone
ALTER TABLE "call_legs" ADD COLUMN "encrypted_phone" text;--> statement-breakpoint

-- bans: phone hash + encrypted phone/reason with envelopes
ALTER TABLE "bans" ADD COLUMN "phone_hash" text;--> statement-breakpoint
ALTER TABLE "bans" ADD COLUMN "encrypted_phone" text;--> statement-breakpoint
ALTER TABLE "bans" ADD COLUMN "phone_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bans" ADD COLUMN "encrypted_reason" text;--> statement-breakpoint
ALTER TABLE "bans" ADD COLUMN "reason_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

-- call_records: encrypted caller_last4 with envelopes
ALTER TABLE "call_records" ADD COLUMN "encrypted_caller_last4" text;--> statement-breakpoint
ALTER TABLE "call_records" ADD COLUMN "caller_last4_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

-- conversations: encrypted contact_last4 with envelopes
ALTER TABLE "conversations" ADD COLUMN "encrypted_contact_last4" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "contact_last4_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

-- geocoding_config: encrypted API key
ALTER TABLE "geocoding_config" ADD COLUMN "encrypted_api_key" text;--> statement-breakpoint

-- signal_registration_pending: encrypted number
ALTER TABLE "signal_registration_pending" ADD COLUMN "encrypted_number" text;--> statement-breakpoint

-- provider_config: encrypted brand_sid, campaign_sid, messaging_service_sid
ALTER TABLE "provider_config" ADD COLUMN "encrypted_brand_sid" text;--> statement-breakpoint
ALTER TABLE "provider_config" ADD COLUMN "encrypted_campaign_sid" text;--> statement-breakpoint
ALTER TABLE "provider_config" ADD COLUMN "encrypted_messaging_service_sid" text;--> statement-breakpoint

-- push_subscriptions: endpoint_hash, encrypted endpoint/auth/p256dh/device_label, envelopes
ALTER TABLE "push_subscriptions" ADD COLUMN "endpoint_hash" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "encrypted_endpoint" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "encrypted_auth_key" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "encrypted_p256dh_key" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "encrypted_device_label" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "device_label_envelopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_endpoint_hash_unique" UNIQUE("endpoint_hash");
