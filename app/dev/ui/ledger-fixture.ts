// Dev-only sample statement for /dev/ui: a charge, a payment, then an effective-date
// correction (reversal + rebook). Amounts come from lib/domain, never typed in.
import {
  chargeForEffectiveDate,
  explainCharge,
  premiumCents,
  runningBalances,
  type ChargeEntry,
  type LedgerEntry,
  type Term,
} from "@/lib/domain";
import type { StatementRow } from "@/lib/services/statement-view";

const term: Term = { start: "2026-02-22", end: "2027-02-22", days: 365 };
const limitCents = 12_345_600;
const rateBps = 100;
const premium = premiumCents(limitCents, rateBps);

const charge: ChargeEntry = {
  id: "dev-1", type: "CHARGE", date: "2026-02-22", seq: 1, amountCents: premium,
  effectiveDate: "2026-02-22", premiumCents: premium, rebookOf: null, coverageLineId: null,
};
const rebook: ChargeEntry = {
  id: "dev-4", type: "CHARGE", date: "2026-03-15", seq: 4,
  amountCents: chargeForEffectiveDate(term, premium, "2026-08-01"),
  effectiveDate: "2026-08-01", premiumCents: premium, rebookOf: "dev-1", coverageLineId: null,
};
const entries: LedgerEntry[] = [
  charge,
  { id: "dev-2", type: "PAYMENT", date: "2026-03-01", seq: 2, amountCents: -100_000, paymentId: "dev-pay" },
  { id: "dev-3", type: "REVERSAL", date: "2026-03-15", seq: 3, amountCents: -premium, reversesEntryId: "dev-1" },
  rebook,
];

const DESCRIPTION: Record<string, string> = {
  "dev-1": "Premium, policy issued",
  "dev-2": "Payment",
  "dev-3": "Reversal of #1",
  "dev-4": "Premium, corrected effective date",
};

export const DEV_LEDGER_ROWS: StatementRow[] = runningBalances(entries).map(({ entry, balanceCents }) => ({
  id: entry.id,
  seq: entry.seq,
  date: entry.date,
  type: entry.type,
  description: DESCRIPTION[entry.id] ?? entry.type,
  amountCents: entry.amountCents,
  balanceCents,
  reversedBy: entry.id === "dev-1" ? { id: "dev-3", seq: 3 } : null,
  reverses: entry.id === "dev-3" ? { id: "dev-1", seq: 1 } : null,
  calculation:
    entry.type === "CHARGE"
      ? { ...explainCharge({ limitCents, rateBps, term, charge: entry }), source: "Policy" }
      : null,
}));
