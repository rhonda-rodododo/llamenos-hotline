-- Task 12: Drop plaintext PII columns — encrypted-only reads from now on.
-- PREREQUISITE: Run scripts/migrate-encrypt-pii.ts (Task 10) first to backfill encrypted values.

-- Drop the old unique constraint on plaintext endpoint (replaced by endpoint_hash unique)
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_endpoint_unique";--> statement-breakpoint

-- Drop plaintext columns
ALTER TABLE "volunteers" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "volunteers" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "active_calls" DROP COLUMN "caller_number";--> statement-breakpoint
ALTER TABLE "call_legs" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "call_records" DROP COLUMN "caller_last4";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "contact_last4";--> statement-breakpoint
ALTER TABLE "bans" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "bans" DROP COLUMN "reason";--> statement-breakpoint
ALTER TABLE "invite_codes" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "invite_codes" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "geocoding_config" DROP COLUMN "api_key";--> statement-breakpoint
ALTER TABLE "signal_registration_pending" DROP COLUMN "number";--> statement-breakpoint
ALTER TABLE "provider_config" DROP COLUMN "brand_sid";--> statement-breakpoint
ALTER TABLE "provider_config" DROP COLUMN "campaign_sid";--> statement-breakpoint
ALTER TABLE "provider_config" DROP COLUMN "messaging_service_sid";--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP COLUMN "endpoint";--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP COLUMN "auth_key";--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP COLUMN "p256dh_key";--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP COLUMN "device_label";--> statement-breakpoint
ALTER TABLE "webauthn_credentials" DROP COLUMN "label";--> statement-breakpoint

-- Make encrypted columns NOT NULL where appropriate
ALTER TABLE "volunteers" ALTER COLUMN "encrypted_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "volunteers" ALTER COLUMN "encrypted_phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "active_calls" ALTER COLUMN "encrypted_caller_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bans" ALTER COLUMN "phone_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bans" ALTER COLUMN "encrypted_phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bans" ALTER COLUMN "encrypted_reason" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_codes" ALTER COLUMN "encrypted_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_codes" ALTER COLUMN "encrypted_phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "geocoding_config" ALTER COLUMN "encrypted_api_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_registration_pending" ALTER COLUMN "encrypted_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "endpoint_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "encrypted_endpoint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "encrypted_auth_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "encrypted_p256dh_key" SET NOT NULL;
