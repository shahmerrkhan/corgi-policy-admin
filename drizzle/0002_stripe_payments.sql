-- Step 7: Stripe Checkout payments. The NOT NULL columns on payments have no default;
-- this is safe only because payments was empty when this migration was written (2026-11-12).
CREATE TYPE "public"."stripe_event_outcome" AS ENUM('recorded', 'ignored');--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"stripe_checkout_session_id" text,
	"outcome" "stripe_event_outcome" NOT NULL,
	"reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_events_stripe_event_id_unique" UNIQUE("stripe_event_id"),
	CONSTRAINT "stripe_events_reason_iff_ignored" CHECK (("stripe_events"."outcome" = 'ignored' AND "stripe_events"."reason" IS NOT NULL AND btrim("stripe_events"."reason") <> '')
        OR ("stripe_events"."outcome" = 'recorded' AND "stripe_events"."reason" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_checkout_session_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_event_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "currency" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_stripe_event_id_unique" UNIQUE("stripe_event_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_usd" CHECK ("payments"."currency" = 'usd');