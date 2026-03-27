CREATE TABLE IF NOT EXISTS "hub_storage_settings" (
	"hub_id" text NOT NULL,
	"namespace" text NOT NULL,
	"retention_days" integer,
	CONSTRAINT "hub_storage_namespace_uniq" UNIQUE("hub_id","namespace")
);
--> statement-breakpoint
ALTER TABLE "hub_storage_settings" ADD CONSTRAINT "hub_storage_settings_hub_id_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE cascade ON UPDATE no action;
