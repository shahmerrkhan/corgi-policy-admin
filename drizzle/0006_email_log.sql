CREATE TYPE "public"."email_kind" AS ENUM('PAYMENT_RECEIVED', 'COVERAGE_DATE_CORRECTED');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "email_kind" NOT NULL,
	"policy_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"status" "email_status" NOT NULL,
	"provider_id" text,
	"error" text,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_log_kind_event_unique" UNIQUE("kind","event_id"),
	CONSTRAINT "email_log_provider_id_iff_sent" CHECK (("email_log"."status" = 'sent') = ("email_log"."provider_id" IS NOT NULL)),
	CONSTRAINT "email_log_error_length" CHECK ("email_log"."error" IS NULL OR char_length("email_log"."error") <= 300)
);
--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_event_id_policy_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."policy_events"("id") ON DELETE restrict ON UPDATE restrict;