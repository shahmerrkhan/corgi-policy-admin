# Corgi Policy Admin (Track 1, CGL)

Next.js 16 has breaking changes vs. training data. Before writing Next.js code, read the
relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.
(`agentRules: false` in next.config.ts; this file is the single rules file, no AGENTS.md.)

## Commands
- `npm run dev` / `npm run build` / `npm start`
- `npm run typecheck` (tsc --noEmit), `npm run lint` (eslint .), `npm run test` (vitest run)
- `npm run check` runs typecheck, lint, test, build. A step is done only when it passes.
- npm only (not pnpm). Run installs and deletes as separate commands, never chained.

## Folder map
- `app/` routes: `broker/`, `portal/` (policyholder), `api/stripe/webhook/`
- `actions/` server actions
- `lib/domain/` pure pricing, proration, allocation, correction, cancellation (no DB, unit-tested)
- `lib/services/` transactional commands and read models
- `lib/db/` schema, `read.ts` (neon-http), `with-tx.ts` (the only Pool)
- `components/`, `emails/`, `drizzle/` (migrations + append-only triggers), `scripts/seed.ts`
- `tests/` vitest, `tests/**/*.test.ts`

## Ledger rules (non-negotiable)
- Append-only, never UPDATE or DELETE: `policy_events`, `ledger_entries`,
  `payment_allocations`, `payment_status_events`, `coverage_lines`, `email_log`.
  Enforced by DB triggers.
- Corrections are reverse-and-rebook: the original entry stays, a REVERSAL entry negates it
  exactly, and a new entry is computed at the corrected value.
- Every ledger entry has a non-null `event_id`. Payment and refund entries also link `payment_id`.

## Money
- Integer cents everywhere, never floats.
- Proration: `round_half_up(premium * days_in_effect / days_in_term)`, rounded once per entry.
  `days_in_term` = actual term days. Never round a daily rate.
- Premium = limit x rate_bps / 10000. Rate is per term. Terms are exactly 12 months.

## Dates
- Plain `YYYY-MM-DD` strings / Postgres `date`. Never `Date` objects with times.
- Ranges exclude the end date: `[start, end)`.
- Every action takes an explicit transaction date. Live portal payments use real today.

## Database access
- Reads: Drizzle over `neon-http`.
- Writes/commands: `withTx()` in `lib/db/with-tx.ts` creates a Pool per call and ends it.
- ESLint blocks `Pool`/`Client` from `@neondatabase/serverless` and all of
  `drizzle-orm/neon-serverless` outside `lib/db/with-tx.ts`. No global Pool.

## Process
- Record every decision in `DECISIONS.md` (dated, one-line reason).
- Pricing and business rules go in `ASSUMPTIONS.md`.
- Never make product, logic or design decisions alone. Ask.
