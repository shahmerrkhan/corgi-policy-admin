CREATE TYPE "public"."actor_role" AS ENUM('broker', 'policyholder', 'stripe', 'system');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('CHARGE', 'REVERSAL', 'CREDIT', 'PAYMENT', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('POLICY_ISSUED', 'COVERAGE_ADDED', 'EFFECTIVE_DATE_CORRECTED', 'POLICY_CANCELLED', 'PAYMENT_RECORDED', 'REFUND_ISSUED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE SEQUENCE "public"."policy_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "brokers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"clerk_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brokers_email_unique" UNIQUE("email"),
	CONSTRAINT "brokers_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "coverage_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"limit_cents" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"premium_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_lines_name_present" CHECK (btrim("coverage_lines"."name") <> ''),
	CONSTRAINT "coverage_lines_limit_positive" CHECK ("coverage_lines"."limit_cents" > 0),
	CONSTRAINT "coverage_lines_rate_positive" CHECK ("coverage_lines"."rate_bps" > 0),
	CONSTRAINT "coverage_lines_premium_round_half_up" CHECK ("coverage_lines"."premium_cents" = ("coverage_lines"."limit_cents" * "coverage_lines"."rate_bps" + 5000) / 10000)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"region" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'CA' NOT NULL,
	"business_description" text NOT NULL,
	"clerk_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email"),
	CONSTRAINT "customers_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"type" "entry_type" NOT NULL,
	"date" date NOT NULL,
	"seq" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"effective_date" date,
	"premium_cents" bigint,
	"rebook_of" uuid,
	"coverage_line_id" uuid,
	"reverses_entry_id" uuid,
	"charge_id" uuid,
	"payment_id" uuid,
	"stripe_refund_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_reverses_entry_id_unique" UNIQUE("reverses_entry_id"),
	CONSTRAINT "ledger_entries_policy_seq_unique" UNIQUE("policy_id","seq"),
	CONSTRAINT "ledger_entries_seq_positive" CHECK ("ledger_entries"."seq" > 0),
	CONSTRAINT "ledger_entries_charge_shape" CHECK ("ledger_entries"."type" <> 'CHARGE' OR ("ledger_entries"."amount_cents" >= 0 AND "ledger_entries"."effective_date" IS NOT NULL
        AND "ledger_entries"."premium_cents" IS NOT NULL AND "ledger_entries"."premium_cents" > 0
        AND "ledger_entries"."reverses_entry_id" IS NULL AND "ledger_entries"."charge_id" IS NULL
        AND "ledger_entries"."payment_id" IS NULL AND "ledger_entries"."stripe_refund_id" IS NULL)),
	CONSTRAINT "ledger_entries_reversal_shape" CHECK ("ledger_entries"."type" <> 'REVERSAL' OR ("ledger_entries"."amount_cents" <= 0 AND "ledger_entries"."reverses_entry_id" IS NOT NULL
        AND "ledger_entries"."effective_date" IS NULL AND "ledger_entries"."premium_cents" IS NULL AND "ledger_entries"."rebook_of" IS NULL
        AND "ledger_entries"."coverage_line_id" IS NULL AND "ledger_entries"."charge_id" IS NULL
        AND "ledger_entries"."payment_id" IS NULL AND "ledger_entries"."stripe_refund_id" IS NULL)),
	CONSTRAINT "ledger_entries_credit_shape" CHECK ("ledger_entries"."type" <> 'CREDIT' OR ("ledger_entries"."amount_cents" < 0 AND "ledger_entries"."charge_id" IS NOT NULL
        AND "ledger_entries"."effective_date" IS NOT NULL AND "ledger_entries"."premium_cents" IS NULL AND "ledger_entries"."rebook_of" IS NULL
        AND "ledger_entries"."coverage_line_id" IS NULL AND "ledger_entries"."reverses_entry_id" IS NULL
        AND "ledger_entries"."payment_id" IS NULL AND "ledger_entries"."stripe_refund_id" IS NULL)),
	CONSTRAINT "ledger_entries_payment_shape" CHECK ("ledger_entries"."type" <> 'PAYMENT' OR ("ledger_entries"."amount_cents" < 0 AND "ledger_entries"."payment_id" IS NOT NULL
        AND "ledger_entries"."effective_date" IS NULL AND "ledger_entries"."premium_cents" IS NULL AND "ledger_entries"."rebook_of" IS NULL
        AND "ledger_entries"."coverage_line_id" IS NULL AND "ledger_entries"."reverses_entry_id" IS NULL
        AND "ledger_entries"."charge_id" IS NULL AND "ledger_entries"."stripe_refund_id" IS NULL)),
	CONSTRAINT "ledger_entries_refund_shape" CHECK ("ledger_entries"."type" <> 'REFUND' OR ("ledger_entries"."amount_cents" > 0 AND "ledger_entries"."payment_id" IS NOT NULL
        AND "ledger_entries"."stripe_refund_id" IS NOT NULL
        AND "ledger_entries"."effective_date" IS NULL AND "ledger_entries"."premium_cents" IS NULL AND "ledger_entries"."rebook_of" IS NULL
        AND "ledger_entries"."coverage_line_id" IS NULL AND "ledger_entries"."reverses_entry_id" IS NULL AND "ledger_entries"."charge_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"source_entry_id" uuid,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_nonzero" CHECK ("payment_allocations"."amount_cents" <> 0),
	CONSTRAINT "payment_allocations_release_has_source" CHECK ("payment_allocations"."amount_cents" > 0 OR "payment_allocations"."source_entry_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payment_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"from_status" "payment_status",
	"to_status" "payment_status" NOT NULL,
	"stripe_event_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_status_events_stripe_event_id_unique" UNIQUE("stripe_event_id"),
	CONSTRAINT "payment_status_events_changes" CHECK ("payment_status_events"."from_status" IS NULL OR "payment_status_events"."from_status" <> "payment_status_events"."to_status")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"date" date NOT NULL,
	"seq" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "payments_policy_seq_unique" UNIQUE("policy_id","seq"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_seq_positive" CHECK ("payments"."seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_number" text DEFAULT ('CGL-' || lpad(nextval('policy_number_seq')::text, 6, '0')) NOT NULL,
	"customer_id" uuid NOT NULL,
	"broker_id" uuid NOT NULL,
	"product" text DEFAULT 'CGL' NOT NULL,
	"term_start" date NOT NULL,
	"term_end" date NOT NULL,
	"limit_cents" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"premium_cents" bigint NOT NULL,
	"status" "policy_status" DEFAULT 'active' NOT NULL,
	"cancel_date" date,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_policy_number_unique" UNIQUE("policy_number"),
	CONSTRAINT "policies_product_cgl" CHECK ("policies"."product" = 'CGL'),
	CONSTRAINT "policies_term_12_months" CHECK ("policies"."term_end" = ("policies"."term_start" + interval '12 months')::date),
	CONSTRAINT "policies_term_start_not_feb29" CHECK (NOT (extract(month from "policies"."term_start") = 2 AND extract(day from "policies"."term_start") = 29)),
	CONSTRAINT "policies_limit_positive" CHECK ("policies"."limit_cents" > 0),
	CONSTRAINT "policies_rate_positive" CHECK ("policies"."rate_bps" > 0),
	CONSTRAINT "policies_premium_round_half_up" CHECK ("policies"."premium_cents" = ("policies"."limit_cents" * "policies"."rate_bps" + 5000) / 10000),
	CONSTRAINT "policies_cancel_shape" CHECK (("policies"."status" = 'active' AND "policies"."cancel_date" IS NULL AND "policies"."cancel_reason" IS NULL)
        OR ("policies"."status" = 'cancelled' AND "policies"."cancel_date" IS NOT NULL AND "policies"."cancel_reason" IS NOT NULL
            AND btrim("policies"."cancel_reason") <> ''
            AND "policies"."cancel_date" >= "policies"."term_start" AND "policies"."cancel_date" < "policies"."term_end"))
);
--> statement-breakpoint
CREATE TABLE "policy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" bigint GENERATED ALWAYS AS IDENTITY (sequence name "policy_events_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"policy_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"transaction_date" date NOT NULL,
	"actor_role" "actor_role" NOT NULL,
	"actor_user_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_events_position_unique" UNIQUE("position")
);
--> statement-breakpoint
ALTER TABLE "coverage_lines" ADD CONSTRAINT "coverage_lines_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "coverage_lines" ADD CONSTRAINT "coverage_lines_event_id_policy_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."policy_events"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_event_id_policy_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."policy_events"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rebook_of_ledger_entries_id_fk" FOREIGN KEY ("rebook_of") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_coverage_line_id_coverage_lines_id_fk" FOREIGN KEY ("coverage_line_id") REFERENCES "public"."coverage_lines"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_entry_id_ledger_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_charge_id_ledger_entries_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_charge_id_ledger_entries_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_source_entry_id_ledger_entries_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_event_id_policy_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."policy_events"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payment_status_events" ADD CONSTRAINT "payment_status_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "policy_events" ADD CONSTRAINT "policy_events_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "coverage_lines_policy_idx" ON "coverage_lines" USING btree ("policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_one_payment_entry" ON "ledger_entries" USING btree ("payment_id") WHERE "ledger_entries"."type" = 'PAYMENT';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_stripe_refund_id_unique" ON "ledger_entries" USING btree ("stripe_refund_id") WHERE "ledger_entries"."stripe_refund_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_entries_charge_idx" ON "ledger_entries" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_policy_idx" ON "payment_allocations" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "payment_status_events_payment_idx" ON "payment_status_events" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "policies_customer_idx" ON "policies" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "policy_events_policy_idx" ON "policy_events" USING btree ("policy_id");