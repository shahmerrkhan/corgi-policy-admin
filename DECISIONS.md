# Decisions

Append-only. One entry per decision, dated, with a one-line reason.

## 2026-11-11

- **Track 1: Policy administration (commercial general liability).** Chosen trial track; one product keeps scope tight.
- **Stack: Next.js, Drizzle ORM, Neon Postgres, Clerk (2 demo users: broker, policyholder), Vercel, Stripe test mode, Resend.** Required by the trial brief.
- **npm, not pnpm.** Simplest and most reliable package manager for this project.
- **Project stays on the D drive (NTFS), by choice.** Owner's choice of working location.
- **Append-only ledger and event log, enforced by DB triggers.** History must never be edited, and triggers prevent accidental UPDATE/DELETE.
- **Corrections are reverse-and-rebook.** Keeps the original charge visible, avoids rounding drift and handles repeated corrections cleanly.
- **Premium = limit x rate.** Simple, explainable pricing for a demo (real CGL is exposure-rated; documented in ASSUMPTIONS.md).
- **Rate is per term; terms are exactly 12 months.** Avoids ambiguity between per-term and annual rates.
- **Proration = round_half_up(premium x days_in_effect / days_in_term), actual term days, end date excluded, rounded once per entry.** Exact, handles leap years, no cent drift.
- **Pro rata cancellation, no fee (short rate, ISO 0.90 x pro rata, noted as the alternative).** Simplest fair rule; alternative documented.
- **Add coverage = a named coverage line with its own limit and rate_bps (default: policy rate).** Clear per-line pricing and traceability.
- **Policyholder pays the outstanding balance, with FIFO payment allocations (oldest open charge first).** One pay action while still tracing every payment to the entries it covers.
- **Credits stay on account until the broker clicks Refund credit (with preview). Refunds go newest payment first, only from payments with unapplied cash.** Broker controls money leaving; refunds map exactly to unapplied cash.
- **One-screen cancellation: cancel + return premium + refund in one confirm.** One reviewable action instead of three.
- **Corrections blocked on cancelled policies in v1.** Avoids recomputing return premium; documented limitation.
- **Cancellation date anywhere in the term, reason required, warning if more than 30 days before today.** Allows backdating, adds an audit reason and a guard against mistakes.
- **Only the seeded customer has a login (the demo policyholder).** Two demo users only, per the brief.
- **Effective-date corrections only, designed for reuse via a repricer registry.** Covers the key scenario without scope creep.
- **Resend sandbox from onboarding@resend.dev, recipient allowlist (account owner + delivered@resend.dev), email_log with Resend message IDs.** Sandbox only delivers to the owner; IDs serve as evidence.
- **Neon driver split: neon-http for reads, per-request WebSocket Pool only inside withTx for commands, no global Pool.** HTTP is fast for reads; transactions need WebSocket; no leaked connections.
- **Explicit transaction dates on every action, live portal payments dated real today, staged seed.** Lets the demo stage "three weeks later" while keeping real payments honest.
- **Embedded Stripe Payment Element, not Checkout.** Checkout hides declines; the Payment Element shows the failed state.
- **Light-only UI, accent #1F3A5F, IBM Plex Sans + IBM Plex Mono.** Calm financial-tool look; mono for amounts and IDs.
- **Actions are pages, not modals.** Linkable, room for previews, easy to walk through in the debrief.
- **Table dates as ISO (2026-02-22); plain-language history uses the short form (Feb 22, 2026).** Tables sort and scan cleanly; history reads naturally.

## 2026-11-12

- **Cache Components off, standard dynamic rendering.** Every page is per-user and must be fresh.
- **agentRules off; CLAUDE.md is the single rules file.** Stops `next dev` re-creating AGENTS.md.
- **@types/node ^24.** Matches the Node 24 runtime; required by vitest 5.1.0.
- **Kept the template's first commit and added one commit per step on top.** Preserves the create-next-app baseline and gives a reviewable per-step history.
- **Vitest config is `vitest.config.mts`.** Avoids the native config loader warning.
- **README is a title-only stub until step 13.** Real docs are written once the app is complete.
- **shadcn/ui: Radix base, nova preset, pointer cursor on, light only.** Mature accessible primitives; we restyle them to our tokens.
- **Dev-only `/dev/ui` page showing every primitive, 404 in production, never linked.** One place to eyeball the design system without shipping it.
- **ISO dates (2026-02-22) in tables via DateCell.** Sorts and scans cleanly; matches the earlier table-date decision.
- **Playwright for visual checks (screenshots of /dev/ui at 1440px and 390px).** Catches layout and unmapped-token problems that unit tests cannot.
- **`--pending` darkened from #A86A12 to #965F10.** The original was 3.76-4.43:1 on our backgrounds; the new value passes 4.5:1 on bg, surface and sunken.
- **shadcn `--accent` hover usages replaced by `bg-sunken`; `--accent` stays #1F3A5F.** Avoids the name clash with our brand accent.
- **All radius tokens (sm/md/lg/xl) are 2px.** shadcn's `calc(var(--radius) - 2px)` would otherwise be 0px.
- **Type scale overrides Tailwind: xs 12, sm 13, base 14, lg 16, xl 20; body 13px.** Dense financial UI with a small, fixed scale.
- **Button variants primary/secondary/destructive only; sizes sm (28px) and default (32px) only.** Small, consistent button vocabulary.
- **formatCents(-123400) = -$1,234.00; formatBalance(0) = $0.00; both throw on non-integer cents.** Signed amounts for reversals; non-integers are bugs.
- **MonoId takes explicit prefix and value props; Tag is uppercase 12px/500 with letter-spacing.** No string parsing; Plex has no true small caps.
- **Select popover uses `position="popper"` (drops below the trigger).** Radix's item-aligned default overlaid the trigger, 4px off its left edge.
- **LedgerTable (step 6) must handle narrow screens.** At 390px the /dev/ui table scrolls inside its container with Amount/Balance off-screen and no cue.
- **Accept shadcn's `cn` package (lib/utils.ts re-exports it) and `shadcn` as a runtime dep for `shadcn/tailwind.css`.** It is what shadcn 4.23.0 generates; the CSS supplies the data-open/closed variants.
- **Table headers 12px muted; destructive button border in the fail colour; status labels capitalised (Pending/Succeeded/Failed); MoneyCell and DateCell are spans placed inside TableCell.** Quiet headers, clear destructive intent, readable labels, reusable outside tables.
- **npm audit findings (dev tooling: shadcn CLI deps, typescript-eslint) left alone for now.** No runtime exposure; fixes need breaking upgrades.
- **Step 2 plan approved with the staff-engineer review changes below.** Owner took each call after a read-only review.
- **A credit first reduces the charge's unpaid amount and releases only max(0, credit - unpaid).** Releasing cash only to re-allocate it to the same charge is circular noise.
- **Cancellation credit = charged - round_half_up(P x days_used / days_in_term), P = line's full-term premium, days_used from the charge's own effective date.** earned + credit always equals charged; computing the credit directly drifted by 1 cent in 16,653 of 66,795 date pairs at P = 100,001.
- **Cancellation and corrections apply only to live (not reversed) charges; correcting a reversed charge returns CHARGE_ALREADY_REVERSED with the latest charge in the chain.** Prevents double credits and corrections of stale charges.
- **A reversal copies the original amount negated, never recomputes it.** The reversal must cancel the original exactly.
- **Payment invariant is refund-aware: 0 <= net allocations + refunded <= amount; refundable = amount - net allocations - refunded; plus cash conservation (payments = allocations + unapplied + refunds).** Stops refunded cash from being allocated again.
- **One helper, chargeNetOpen (charge amount net of reversal and credits), caps cash on a charge in the release planner, allocateFifo and the invariants.** One definition, no drift between modules.
- **planAllocationRelease releases min(excess, net allocated), throws if the credit exceeds the charge's net amount, and every release row carries sourceEntryId.** Releases are bounded and traceable to the entry that caused them.
- **Dates use integer days-from-civil math only (no Date objects); addTwelveMonths, daysBetween and a validated parseIsoDate are exported.** Time zones and DST can never shift a calendar date.
- **Domain exposes planCancellation (credits, releases, re-allocation, refund preview), isBackdatedOver30Days, payment status (only succeeded payments allocate or refund) and a type on every entry (CHARGE, REVERSAL, CREDIT, PAYMENT, REFUND).** Steps 3+ need these for the one-screen cancel, Stripe statuses and the ledger table.
- **Premium = round_half_up(limit_cents x rate_bps / 10000), rate a whole number of bps, rounded once.** Integer cents with one rounding point.
- **Feb 29 term start is rejected with INVALID_TERM_START.** Same day next year does not exist; terms must be exactly 12 months.
- **Business rejections return Result { ok: false, code }; bad input (non-integer cents, invalid date, bad days, term not 12 months) throws DomainError.** Users see rejections; caller bugs fail loudly.
- **FIFO and newest-first ties break on date, then seq.** Deterministic order for same-day rows.
- **Cancellation and correction dates must fall in [term_start, term_end).** Matches the end-excluded range rule.
- **Released cash is re-allocated FIFO, oldest payment's unapplied cash first; the rest stays on account.** Matches the existing FIFO rule; refunds stay a separate broker action.
- **FIFO "oldest charge" uses the posting date, then seq (implementation choice, owner to confirm).** A rebook is ordered by when it was posted, not by its effective date.
- **Planners take a newId function and give new entries seq = max existing seq + 1 (implementation choice, owner to confirm).** Keeps the domain pure; step 3 must store this seq so FIFO order survives.
- **prorate allows 0 days in effect (earned on the cancel day); negative days and a non-positive term throw (implementation choice, owner to confirm).** Cancelling on a charge's effective date earns nothing.
- **Non-release allocation rows carry sourceEntryId too: the PAYMENT or new CHARGE entry, null for a cancellation's re-allocation (implementation choice, owner to confirm).** Every row traces to its cause where there is a single one.
- **Recording the same payment twice throws; correcting or cancelling a charge that already has credits throws (implementation choice, owner to confirm).** Webhook dedupe belongs in the service; credits exist only after cancellation, which blocks both.
- **tests/domain/purity.test.ts enforces no outside imports, no clock, no Math/float helpers and no "/" outside int.ts in lib/domain.** Keeps the domain rules from regressing silently.
