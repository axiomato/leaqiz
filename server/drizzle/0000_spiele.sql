CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pin" text NOT NULL,
	"host_token_hash" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "game_pin_active" ON "game" USING btree ("pin") WHERE "game"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "game_ended_at" ON "game" USING btree ("ended_at");