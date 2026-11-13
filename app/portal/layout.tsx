import { AppHeader } from "@/components/app-header";
import { policyholderPage } from "@/lib/auth/page";

// Shell only. Each page checks the policyholder role again on the server.
export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  await policyholderPage();
  return (
    <>
      <AppHeader area="Policyholder" who="Policyholder" links={[{ href: "/portal", label: "My policies" }]} />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">{children}</main>
    </>
  );
}
