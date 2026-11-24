ALTER TABLE "subscription" ADD COLUMN "plan" text DEFAULT 'monat' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "concluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "reminder_sent_at" timestamp with time zone;