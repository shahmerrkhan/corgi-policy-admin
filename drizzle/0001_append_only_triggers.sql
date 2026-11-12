-- Append-only enforcement (step 3, hand-written).
-- 1. forbid_mutation(): UPDATE, DELETE and TRUNCATE always fail on the five append-only tables.
-- 2. policies and payments: DELETE and TRUNCATE always fail; UPDATE only through a guard.
-- Known limit: the database owner role can still ALTER TABLE ... DISABLE TRIGGER.

CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint

-- policy_events
CREATE TRIGGER policy_events_no_update_delete BEFORE UPDATE OR DELETE ON policy_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER policy_events_no_truncate BEFORE TRUNCATE ON policy_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- ledger_entries
CREATE TRIGGER ledger_entries_no_update_delete BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- payment_allocations
CREATE TRIGGER payment_allocations_no_update_delete BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_no_truncate BEFORE TRUNCATE ON payment_allocations
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- payment_status_events
CREATE TRIGGER payment_status_events_no_update_delete BEFORE UPDATE OR DELETE ON payment_status_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER payment_status_events_no_truncate BEFORE TRUNCATE ON payment_status_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- coverage_lines
CREATE TRIGGER coverage_lines_no_update_delete BEFORE UPDATE OR DELETE ON coverage_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER coverage_lines_no_truncate BEFORE TRUNCATE ON coverage_lines
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- policies: only active -> cancelled, and only status, cancel_date, cancel_reason, updated_at change.
CREATE FUNCTION guard_policy_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.status = 'active' AND NEW.status = 'cancelled') THEN
    RAISE EXCEPTION 'policies: status change % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'cancel_date' - 'cancel_reason' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'cancel_date' - 'cancel_reason' - 'updated_at') THEN
    RAISE EXCEPTION 'policies: only status, cancel_date, cancel_reason and updated_at may change'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policies_guard_update BEFORE UPDATE ON policies
  FOR EACH ROW EXECUTE FUNCTION guard_policy_update();
--> statement-breakpoint
CREATE TRIGGER policies_no_delete BEFORE DELETE ON policies
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER policies_no_truncate BEFORE TRUNCATE ON policies
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- payments: only pending -> succeeded|failed, and only status and updated_at change.
CREATE FUNCTION guard_payment_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.status = 'pending' AND NEW.status IN ('succeeded', 'failed')) THEN
    RAISE EXCEPTION 'payments: status change % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'payments: only status and updated_at may change'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_guard_update BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_update();
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
