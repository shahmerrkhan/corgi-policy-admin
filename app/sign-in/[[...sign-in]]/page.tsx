import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";

export const metadata: Metadata = { title: "Sign in · Policy Admin" };

// Two demo users only: no sign-up link (sign-up is also disabled in the Clerk dashboard).
const appearance = {
  variables: {
    colorPrimary: "#1f3a5f",
    colorText: "#1a1915",
    colorBackground: "#ffffff",
    borderRadius: "2px",
    fontFamily: "var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    cardBox: { boxShadow: "none", border: "1px solid #e2ddd3" },
    card: { boxShadow: "none" },
    footer: { display: "none" },
  },
};

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">Policy Admin</h1>
      <SignIn withSignUp={false} appearance={appearance} />
    </main>
  );
}
