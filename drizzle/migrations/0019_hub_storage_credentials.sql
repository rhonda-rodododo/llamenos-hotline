CREATE TABLE IF NOT EXISTS "hub_storage_credentials" (
	"hub_id" text PRIMARY KEY NOT NULL,
	"access_key_id" text NOT NULL,
	"encrypted_secret_key" text NOT NULL,
	"policy_name" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_storage_credentials" ADD CONSTRAINT "hub_storage_credentials_hub_id_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE cascade ON UPDATE no action;
