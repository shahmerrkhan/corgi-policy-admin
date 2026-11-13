import type { Metadata } from "next";
import { CustomerForm } from "@/components/customer-form";
import { brokerPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "New customer · Policy Admin" };

export default async function NewCustomerPage() {
  await brokerPage();
  return (
    <>
      <h1 className="text-xl font-semibold">New customer</h1>
      <CustomerForm />
    </>
  );
}
