# Policy Admin (Track 1: commercial general liability)

## What it is
A small policy administration app for one product, commercial general liability (CGL).
A broker creates customers, issues 12-month policies, adds coverage lines and corrects a
coverage line's effective date, and every money change lands on an append-only ledger. The
policyholder signs in to see their statement and timeline and pays the balance due through
Stripe Checkout in test mode.

## Live app
https://corgi-policy-admin.vercel.app

## Demo logins
These are demo accounts in a Clerk development instance (it shows a "Development mode" badge),
and all payments are Stripe test mode. Nothing here is real money or a real customer.

| Role | Email | Password |
|---|---|---|
| Broker | broker@example.com | CorgiBroker-2026! |
| Policyholder | delivered@resend.dev | CorgiHolder-2026! |

To pay as the policyholder, use Stripe's test card `4242 4242 4242 4242`, any future expiry
and any CVC.

## Roles
**Broker** (`/broker`), sees only their own customers and policies:
- create a customer profile
- issue a policy (term start, limit, rate in basis points, transaction date) with a review step
- add a named coverage line to an active policy, with a review step
- correct a coverage line's effective date (new date, transaction date, required reason)
- view each policy's statement, timeline, coverage lines and charge calculations

**Policyholder** (`/portal`), sees only their own policies:
- view the statement, timeline and coverage lines
- pay the whole balance due with Stripe Checkout (the amount comes from the ledger on the
  server, never from the form)

Roles come from Clerk `publicMetadata.role`, and each login must also be linked to a broker or
customer row in the database. Every page and server action checks both on the server.

## Sandbox integrations
- **Stripe (test mode):** the policyholder pays through hosted Checkout. Only the signed webhook
  at `/api/webhooks/stripe` (event `checkout.session.completed`) records a payment. Each event
  is stored in `stripe_events` with its outcome, so a retried delivery is a no-op. Live keys
  are refused.
- **Resend:** one plain-text email to the customer when a payment is recorded and one when a
  coverage date is corrected. Emails are sent only after the database transaction commits, a
  send failure never undoes the payment or correction, and every attempt (sent, skipped or
  failed) is kept in `email_log`, at most one per kind per event.

## Infrastructure
- **Clerk:** sign-in and roles (development instance).
- **Neon:** Postgres. Reads go over Neon HTTP; each write command runs in one transaction on a
  short-lived WebSocket pool.
- **Vercel:** hosting, Node runtime.

## Stack
Next.js 16 (App Router, server actions), React 19, TypeScript, Drizzle ORM, Neon Postgres,
Clerk, Stripe, Resend (REST API over fetch), Tailwind CSS 4 with shadcn/ui primitives, Vitest.

## How the money works
- **Integer cents everywhere.** Premium = limit x rate_bps / 10000. A charge is prorated as
  round_half_up(premium x days_in_effect / days_in_term), rounded once per entry. A daily rate
  is never computed.
- **Append-only ledger.** Charges, reversals, payments and allocations are only ever inserted.
  Database triggers reject UPDATE, DELETE and TRUNCATE on the audit tables. The sum of the
  entries is the balance.
- **Reverse-and-rebook corrections.** Correcting a date never edits the original charge. A
  reversal negates it exactly and a new charge is computed at the corrected date.
- **FIFO payment allocation.** Cash pays the oldest open charge first. When a reversal frees
  cash that had paid the old charge, the cash is released and applied again, oldest charge
  first.

[DEBRIEF.md](DEBRIEF.md) walks through a correction after payment with real numbers.

## Run locally
Needs Node 24 and npm.

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   `APP_URL` (optional), `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET`,
   `RESEND_API_KEY` (optional), `RESEND_ALLOWED_TO` (optional).
3. `npm run db:migrate`, then `npm run db:seed` (one broker and one customer).
4. In Clerk, create two users with `publicMetadata.role` set to `broker` and `policyholder`,
   and add `metadata` (the user's public metadata) to the session token. Then link them:
   `npm run db:link -- --broker user_... --policyholder user_...`
5. `npm run dev`, and in another terminal forward Stripe test webhooks:
   `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
   (put the `whsec_...` secret it prints in `STRIPE_WEBHOOK_SECRET`).

## Tests
- `npm run test`: unit and component tests (no network, no database).
- `npm run db:check`: integration tests against the real database. Every test runs in a
  transaction that is rolled back.
- `npm run check`: design check, typecheck, lint, unit tests and production build.

## Sandbox evidence
Screenshots of the deployed app, Stripe test payments and Resend emails are in
[docs/evidence/](docs/evidence/).

## Decisions and assumptions
- [DECISIONS.md](DECISIONS.md): the dated decision log, one line of reasoning per decision.
- [ASSUMPTIONS.md](ASSUMPTIONS.md): pricing and business rules, and what was cut for time.
- [DEBRIEF.md](DEBRIEF.md): the Track 1 correction scenario, step by step.
