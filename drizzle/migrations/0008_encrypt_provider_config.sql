-- Migrate telephony_config and messaging_config from JSONB to encrypted text.
-- Existing JSONB data is cast to text (JSON string) — SettingsService handles
-- legacy plaintext with re-encryption on first read.

ALTER TABLE "telephony_config" ALTER COLUMN "config" TYPE text USING "config"::text;
ALTER TABLE "telephony_config" ALTER COLUMN "config" SET DEFAULT '';

ALTER TABLE "messaging_config" ALTER COLUMN "config" TYPE text USING "config"::text;
ALTER TABLE "messaging_config" ALTER COLUMN "config" SET DEFAULT '';
