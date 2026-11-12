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
