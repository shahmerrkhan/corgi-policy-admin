-- Append-only enforcement for stripe_events (step 7, hand-written). Reuses forbid_mutation()
-- from 0001: UPDATE, DELETE and TRUNCATE always fail.
CREATE TRIGGER stripe_events_no_update_delete BEFORE UPDATE OR DELETE ON stripe_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER stripe_events_no_truncate BEFORE TRUNCATE ON stripe_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
