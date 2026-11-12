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
