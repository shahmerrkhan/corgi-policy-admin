-- Append-only enforcement for email_log (step 11, hand-written). Reuses forbid_mutation()
-- from 0001: UPDATE, DELETE and TRUNCATE always fail.
CREATE TRIGGER email_log_no_update_delete BEFORE UPDATE OR DELETE ON email_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER email_log_no_truncate BEFORE TRUNCATE ON email_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
