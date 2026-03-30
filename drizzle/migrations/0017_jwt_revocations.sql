-- Replace server_sessions with jwt_revocations for stateless JWT auth
DROP TABLE "server_sessions";--> statement-breakpoint
CREATE TABLE "jwt_revocations" (
	"jti" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
