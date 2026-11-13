import { redirect } from "next/navigation";
import { sessionRole } from "@/lib/auth/actor";
import { homeFor } from "@/lib/auth/roles";

export default async function Home() {
  const { signedIn, role } = await sessionRole();
  redirect(signedIn ? homeFor(role) : "/sign-in");
}
