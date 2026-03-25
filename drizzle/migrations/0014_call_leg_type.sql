CREATE TYPE "public"."call_leg_type" AS ENUM('phone', 'browser');
--> statement-breakpoint
ALTER TABLE "call_legs" ADD COLUMN "type" "call_leg_type" NOT NULL DEFAULT 'phone';
