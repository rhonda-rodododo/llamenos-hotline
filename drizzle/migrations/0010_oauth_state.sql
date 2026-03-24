-- Create missing tables for provider setup and signal registration

CREATE TABLE IF NOT EXISTS "oauth_state" (
  "provider" text PRIMARY KEY NOT NULL,
  "state" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "provider_config" (
  "id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
  "provider" text NOT NULL,
  "connected" boolean DEFAULT false NOT NULL,
  "phone_number" text,
  "webhooks_configured" boolean DEFAULT false NOT NULL,
  "sip_configured" boolean DEFAULT false NOT NULL,
  "a2p_status" text DEFAULT 'not_started',
  "brand_sid" text,
  "campaign_sid" text,
  "messaging_service_sid" text,
  "encrypted_credentials" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "signal_registration_pending" (
  "id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
  "number" text NOT NULL,
  "bridge_url" text NOT NULL,
  "method" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "error" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
