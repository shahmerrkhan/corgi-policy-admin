// Next.js 16 Proxy (formerly middleware). Optimistic role routing only: every page and
// server action checks the role and the database link again on the server.
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { roleFromClaims, routeDecision } from "@/lib/auth/roles";

export default clerkMiddleware(
  async (auth, req) => {
    const { userId, sessionClaims, redirectToSignIn } = await auth();
    const decision = routeDecision(req.nextUrl.pathname, {
      signedIn: Boolean(userId),
      role: userId ? roleFromClaims(sessionClaims) : null,
    });
    if (decision === "sign-in") return redirectToSignIn({ returnBackUrl: req.url });
    if (decision === "no-access") return NextResponse.redirect(new URL("/no-access", req.url));
    return NextResponse.next();
  },
  { signInUrl: "/sign-in" },
);

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
