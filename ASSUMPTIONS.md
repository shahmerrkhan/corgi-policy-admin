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

## Issuing a policy
- The broker enters customer, term start, transaction date, limit (dollars) and rate (bps).
- Limit is $1,000 to $100,000,000, whole dollars or with cents. Rate is a whole number of bps
  from 1 to 10000, per 12-month term.
- The transaction date defaults to today in Toronto and has no limit relative to the term start
  (the demo stages backdated and future-dated work).
- Issuing posts one CHARGE effective on the term start for the full-term premium, dated the
  transaction date, and one POLICY_ISSUED event. No payment, allocation or coverage line.
- A Feb 29 term start is rejected with a clear message.

## Customers and logins
- A customer profile has six parts: legal name, contact name, email (unique, stored lowercase),
  phone, address (line 1, optional line 2, city, province/state, postal code, two-letter country,
  default CA) and business description.
- Customers belong to the broker who created them; a broker sees only their own customers and
  policies. A policyholder sees only their own policies.
- Only the seeded broker and seeded customer have logins, linked by `npm run db:link`.

## Statement and timeline
- The statement lists every ledger entry oldest first (posting date, then seq) with the balance after it. Reversed entries stay on the statement, struck through.
- The balance at the top is "Balance due" when the sum of entries is zero or more and "Credit" (shown as a positive amount) when it is negative.
- Descriptions: original charge "Premium, policy issued"; rebooked charge "Premium, corrected effective date"; coverage-line charge "Premium, <line name>"; reversal "Reversal of #seq"; credit "Return premium, cancellation"; payment "Payment"; refund "Refund".
- Timeline labels: Policy issued, Coverage added, Effective date corrected, Policy cancelled, Payment recorded, Refund issued. Newest first.
- A charge's calculation shows the limit and rate (from its coverage line, or the policy), the premium step, term days, days in effect and the proration step, each with its exact remainder and rounding direction.

## Online payments (Stripe Checkout, test mode)
- The policyholder pays the whole current balance due in one Stripe Checkout payment. The amount is read from the ledger on the server when they click Pay balance; the button shows only when the balance due is above $0.00. Brokers cannot pay.
- Payments are in USD (one constant, PAYMENT_CURRENCY = "usd"), card only.
- A Checkout page expires after 31 minutes, so an old amount cannot be paid much later.
- Only the Stripe webhook records a payment. The return page says "Payment processing" and shows the statement; the payment appears once Stripe confirms it.
- The recorded amount is what Stripe collected (amount_total), never what was asked for. If it is more than is owed, the extra stays on the account as unapplied cash (credit).
- A payment is dated the Toronto calendar date of the Stripe event.
- A payment that arrives for a cancelled policy is still recorded; it pays any premium still owed and the rest stays as credit.
- Events that cannot be recorded (unknown policy, wrong currency, live mode, no amount or payment intent, a payment intent or session already recorded) are kept as ignored with a reason and change nothing else.
