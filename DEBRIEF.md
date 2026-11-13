# Debrief: correcting a coverage date after payment

## The scenario
A broker added a coverage line to a policy whose term runs from 2026-01-01 to 2027-01-01
(365 days). The line has a $73,000 limit at 100 basis points, so its full-year premium is
$730.00. It was entered as effective 2026-03-01, which leaves 306 of the 365 days, so the
charge was $730.00 x 306 / 365 = $612.00. The policyholder paid, and the balance was $0.00.

Then it turned out the coverage really started a week earlier, on 2026-02-22. From that date
the line covers 313 of 365 days, so the right charge is $730.00 x 313 / 365 = $626.00. The
customer owes $14.00 more.

## What the system does, step by step
The broker opens the line's Correct date form, enters 2026-02-22, a transaction date and a
reason, and checks a review page that shows old, new and net side by side before confirming.
On confirm, one database transaction does all of this:

1. **The original $612.00 charge stays exactly as it was.** Nothing is edited.
2. **A reversal of -$612.00 is posted.** It copies the original amount negated, so it cancels
   the old charge to the cent. It is never recalculated.
3. **A new charge of $626.00 is posted** at the corrected date, with its day counts (313 of 365)
   stored on it and a link back to the charge it replaces.
4. **The payment is released and applied again.** The $612.00 of cash that had paid the old
   charge is no longer needed there, so a release row frees it. That cash then goes to the
   oldest open charge first, which here is the new $626.00 charge. Both of these are new rows;
   the original allocation stays.
5. **The balance due becomes $14.00:** $612.00 - $612.00 + $626.00 - $612.00 paid.
6. A "Coverage date corrected" event records the line, both dates, both amounts, the net
   change (+$14.00) and the reason. Every row above carries this event's id.

After the commit, the customer gets a plain-text email with the old and new date, the old and
new charge, the net change and the new balance due. If the email fails, the correction still
stands, and the attempt is logged in `email_log`.

## Where you see it
- **Statement (broker and policyholder):** the original "Premium, <line>" row is still there,
  struck through. Below it are "Reversal of #<seq>" for -$612.00 and
  "Premium, <line> (corrected)" for $626.00, each with the running balance. The balance at the
  top reads "Balance due $14.00".
- **Charge calculation:** the new charge shows the premium step and the 313 / 365 proration
  step, with the exact rounding.
- **Timeline:** a "Coverage date corrected" event with "<line>: 2026-03-01 to 2026-02-22.
  Reason: ..." and the broker's name.
- **Coverage lines:** the line now shows 2026-02-22 as its current effective date. That date is
  read from the line's one live charge, so it cannot drift from the ledger.
- **Pay balance:** the policyholder can now pay the $14.00 through Stripe Checkout.

## Why the original is never edited
If I overwrote the $612.00 with $626.00, the statement the customer saw last month would
silently change, the payment would point at an amount that never existed, and nobody could
tell what happened or when. Keeping the original and adding a reversal and a new charge means
every number anyone was ever shown is still there, the change has a date, an author and a
reason, and the sum of the entries is always the balance. It also makes a second correction
easy: it reverses the latest charge in exactly the same way. The database backs this up with
triggers that reject updates and deletes on the ledger tables.

## What I would do with more time
- **Cancellation and refunds.** The pro rata, no-fee calculation and the refund rules are
  written and unit-tested in `lib/domain`, but there is no command or screen for them yet.
- **A production auth domain.** Move Clerk from the development instance to a production
  instance on a custom domain, which also removes the "Development mode" badge.
- **More correction types.** Today only a coverage line's effective date can be corrected; next
  would be limit and rate changes and the policy's own start date.
- **A real concurrency test.** Two connections confirming at the same moment. Today this is
  covered by a row lock on the policy, unique indexes and sequential double-submit tests.
