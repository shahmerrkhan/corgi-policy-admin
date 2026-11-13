-- Hand-edited: drizzle-kit generated DROP TYPE / CREATE TYPE for the enum change. No rows
-- use EFFECTIVE_DATE_CORRECTED, but an in-place rename keeps the type and its dependents intact.
ALTER TYPE "public"."event_type" RENAME VALUE 'EFFECTIVE_DATE_CORRECTED' TO 'COVERAGE_DATE_CORRECTED';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_one_rebook_per_charge" ON "ledger_entries" USING btree ("rebook_of") WHERE "ledger_entries"."rebook_of" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_one_original_charge_per_line" ON "ledger_entries" USING btree ("coverage_line_id") WHERE "ledger_entries"."type" = 'CHARGE' AND "ledger_entries"."rebook_of" IS NULL AND "ledger_entries"."coverage_line_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rebook_has_days" CHECK ("ledger_entries"."rebook_of" IS NULL OR "ledger_entries"."days_in_effect" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "policy_events" ADD CONSTRAINT "policy_events_correction_reason" CHECK ("policy_events"."type" <> 'COVERAGE_DATE_CORRECTED'
        OR (btrim("policy_events"."payload"->>'reason') <> '' AND char_length("policy_events"."payload"->>'reason') <= 500));