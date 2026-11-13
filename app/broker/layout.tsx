import { AppHeader } from "@/components/app-header";
import { brokerPage } from "@/lib/auth/page";

const LINKS = [
  { href: "/broker", label: "Customers and policies" },
  { href: "/broker/customers/new", label: "New customer" },
  { href: "/broker/policies/new", label: "Issue policy" },
];

// Shell only. Each page and action checks the broker role again on the server.
export default async function BrokerLayout({ children }: LayoutProps<"/broker">) {
  await brokerPage();
  return (
    <>
      <AppHeader area="Broker" who="Broker" links={LINKS} />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">{children}</main>
    </>
  );
}
