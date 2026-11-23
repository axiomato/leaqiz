CREATE TABLE "contract_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subscription_id" uuid,
	"content" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"gross_cent" integer NOT NULL,
	"vat_cent" integer NOT NULL,
	"currency" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"provider" text NOT NULL,
	"provider_id" text,
	"status" text NOT NULL,
	"immediate_start" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"first_term_end" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_event" ADD CONSTRAINT "contract_event_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_event_subscription" ON "contract_event" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider" ON "payment" USING btree ("kind","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payment_subscription" ON "payment" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_number" ON "subscription" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_provider_id" ON "subscription" USING btree ("provider","provider_id") WHERE "subscription"."provider_id" is not null;--> statement-breakpoint
CREATE INDEX "subscription_user_id" ON "subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_email" ON "subscription" USING btree (lower("email"));