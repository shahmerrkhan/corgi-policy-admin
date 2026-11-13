import type { Metadata } from "next";
import { SignOutButton } from "@clerk/nextjs";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access · Policy Admin" };

export default function NoAccessPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <ErrorState
        title="You do not have access to this page"
        description="Your account has no role for this area, or it is not linked to a broker or customer yet."
        action={
          <SignOutButton redirectUrl="/sign-in">
            <Button variant="secondary">Sign out</Button>
          </SignOutButton>
        }
      />
    </main>
  );
}
