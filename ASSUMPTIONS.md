# Assumptions

Business rules the app implements. Code: `lib/domain/`. Money is integer cents; dates are
`YYYY-MM-DD` and ranges exclude the end date.

## Pricing
- Premium = round_half_up(limit_cents x rate_bps / 10000), rounded once. Rate is a whole number
  of basis points per 12-month term. Example: $73,000 limit at 100 bps = $730.00.
- Real CGL is exposure-rated (payroll, sales, class codes); limit x rate is a deliberate demo
  simplification.
- Each added coverage line has its own limit and rate_bps (default: the policy rate).

## Terms
- A term is exactly 12 months, [start, same day next year). Its length is the actual day count:
  365, or 366 when it spans Feb 29.
- A term cannot start on Feb 29 (rejected with INVALID_TERM_START), because "same day next
  year" does not exist.

## Proration
- Charge = round_half_up(P x days_in_effect / days_in_term), rounded once per entry, where P is
  the line's full-term premium and days_in_effect runs from the effective date to the term end.
  A daily rate is never computed or rounded.
- Example: $730 effective 2026-03-01 in the 2026-01-01 term = 306/365 = $612.00; effective
  2026-02-22 = 313/365 = $626.00.

## Corrections (effective date)
- Reverse-and-rebook: the original charge stays, a REVERSAL copies its amount negated (never
  recomputed), and a new CHARGE is computed at the corrected date and points to the original.
- Only live (not reversed) charges can be corrected; correcting a reversed one returns
  CHARGE_ALREADY_REVERSED and names the latest charge in the chain.
- The corrected date must be in [term start, term end) and differ from the current date.
- Corrections are blocked on cancelled policies (v1).

## Cancellation (pro rata, no fee)
- Cancel date must be in [term start, term end). A reason is required. A warning shows when
  the cancel date is more than 30 days before the transaction date.
- For each live charge: earned = round_half_up(P x days_used / days_in_term), with days_used
  counted from that charge's own effective date to the cancel date; credit = charged - earned.
  So earned + credit always equals the charge exactly.
- A charge effective on or after the cancel date is credited in full.
- Alternative not implemented: short rate (ISO 0.90 x pro rata).

## Credits and releases
- A credit (or reversal) first reduces the charge's unpaid amount. Only max(0, credit - unpaid)
  releases cash. A credit on an unpaid charge releases nothing.
- A release is a new negative allocation row (nothing is edited), taken from the newest
  payment first, and records the reversal or credit entry that caused it.
- A charge never holds more cash than its amount net of reversal and credits.

## Payments and allocation
- Only succeeded payments hold cash. Pending and failed payments are never allocated or
  refunded.
- Unapplied cash is allocated FIFO: oldest payment's cash first, to the oldest open charge
  first. "Oldest" means posting date, then sequence number.
- Cash left after allocation stays on account as refundable credit.

## Refunds
- Refundable cash on a payment = amount - net allocations - refunded.
- Refunds come only from refundable cash, newest payment first. Asking for more than is
  refundable returns NOT_ENOUGH_REFUNDABLE_CASH.
- Credit stays on account until the broker refunds it; cancellation shows a refund preview of
  all refundable cash and refunds it in the same confirm.

## Ledger sign convention
- The sum of entries is the balance: CHARGE +, REVERSAL -, CREDIT -, PAYMENT -, REFUND +.
  A negative balance is credit on account.
