CREATE TABLE "quiz" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"local_id" text,
	"title" text NOT NULL,
	"questions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "quiz_id" uuid;--> statement-breakpoint
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_owner_id" ON "quiz" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_owner_local_id" ON "quiz" USING btree ("owner_id","local_id") WHERE "quiz"."local_id" is not null;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE set null ON UPDATE no action;