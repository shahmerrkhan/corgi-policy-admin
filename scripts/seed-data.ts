// Fixed seed rows. Fixed ids make the seed idempotent (ON CONFLICT (id) DO NOTHING).
import type { brokers, customers } from "@/lib/db/schema";

export const SEED_BROKER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Harbourline Insurance Brokers",
  email: "broker@example.com",
} satisfies typeof brokers.$inferInsert;

export const SEED_CUSTOMER = {
  id: "00000000-0000-4000-8000-000000000002",
  brokerId: SEED_BROKER.id,
  legalName: "Maple Lane Landscaping Ltd.",
  contactName: "Jordan Reyes",
  email: "delivered@resend.dev",
  phone: "+1 416 555 0142",
  addressLine1: "120 King Street West",
  addressLine2: "Suite 400",
  city: "Toronto",
  region: "ON",
  postalCode: "M5H 1A1",
  country: "CA",
  businessDescription: "Commercial landscaping, grounds maintenance and snow removal.",
} satisfies typeof customers.$inferInsert;
