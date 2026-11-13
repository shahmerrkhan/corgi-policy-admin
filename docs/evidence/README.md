# Sandbox evidence
- `stripe-webhook-delivery.png`: Stripe delivered `checkout.session.completed` to the live webhook and got 200 with outcome `recorded`.
- `stripe-payment.png`: Stripe test-mode payments for policy CGL-000050 succeeded with test card 4242.
- `resend-email-delivered.png`: Resend delivered the "Coverage date corrected" email for policy CGL-000270.

Note: the $612 payment at 22:09 UTC was made before the webhook destination existed, so it was never recorded in the ledger (sandbox only).
