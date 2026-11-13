ALTER TABLE "ledger_entries" ADD COLUMN "days_in_effect" integer;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "days_in_term" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_lines_policy_name_unique" ON "coverage_lines" USING btree ("policy_id",lower(btrim("name")));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_days_shape" CHECK (("ledger_entries"."days_in_effect" IS NULL AND "ledger_entries"."days_in_term" IS NULL)
        OR ("ledger_entries"."type" = 'CHARGE' AND "ledger_entries"."days_in_term" IN (365, 366)
            AND "ledger_entries"."days_in_effect" >= 1 AND "ledger_entries"."days_in_effect" <= "ledger_entries"."days_in_term"));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_charge_prorated_round_half_up" CHECK ("ledger_entries"."days_in_effect" IS NULL
        OR "ledger_entries"."amount_cents" = (2 * "ledger_entries"."premium_cents" * "ledger_entries"."days_in_effect" + "ledger_entries"."days_in_term") / (2 * "ledger_entries"."days_in_term"));