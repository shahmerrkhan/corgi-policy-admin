// The one Stripe API client. Server only, created lazily so `next build` never needs the key.
import "server-only";
import Stripe from "stripe";
import { stripeSecretKey } from "./env";

/** Pinned to the version stripe@23.1.0 is generated for. Webhook endpoints should use it too. */
export const STRIPE_API_VERSION = "2026-10-28.endive" as const;

let client: Stripe | undefined;

export function getStripe(): Stripe {
  client ??= new Stripe(stripeSecretKey(), { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2 });
  return client;
}
