-- Migrate geocoding_config from JSONB blob to individual columns
-- The Drizzle schema expects individual columns but the table was created with a single config JSONB column

ALTER TABLE "geocoding_config" RENAME COLUMN "hub_id" TO "id";
ALTER TABLE "geocoding_config" ADD COLUMN "provider" text;
ALTER TABLE "geocoding_config" ADD COLUMN "api_key" text NOT NULL DEFAULT '';
ALTER TABLE "geocoding_config" ADD COLUMN "countries" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "geocoding_config" ADD COLUMN "enabled" boolean NOT NULL DEFAULT false;

-- Migrate data from config JSONB to individual columns
UPDATE "geocoding_config" SET
  "provider" = "config"->>'provider',
  "api_key" = COALESCE("config"->>'apiKey', ''),
  "countries" = COALESCE("config"->'countries', '[]'::jsonb),
  "enabled" = COALESCE(("config"->>'enabled')::boolean, false)
WHERE "config" IS NOT NULL AND "config" != '{}'::jsonb;

ALTER TABLE "geocoding_config" DROP COLUMN "config";
