ALTER TABLE "hubs" DROP COLUMN IF EXISTS "nostr_pubkey";
--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "slug" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "description" text;
--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "status" text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "phone_number" text;
--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "created_by" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "updated_at" timestamp with time zone NOT NULL DEFAULT now();
