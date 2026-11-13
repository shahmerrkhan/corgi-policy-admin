import { describe, expect, it } from "vitest";
import { homeFor, roleFromClaims, routeDecision } from "@/lib/auth/roles";

describe("roleFromClaims", () => {
  it("reads metadata.role", () => {
    expect(roleFromClaims({ metadata: { role: "broker" } })).toBe("broker");
    expect(roleFromClaims({ metadata: { role: "policyholder" } })).toBe("policyholder");
  });
  it.each([null, undefined, {}, { metadata: null }, { metadata: { role: "admin" } }, { metadata: { role: ["broker"] } }, { role: "broker" }])(
    "returns null for %j",
    (claims) => {
      expect(roleFromClaims(claims)).toBeNull();
    },
  );
});

describe("routeDecision", () => {
  const out = { signedIn: false, role: null } as const;
  const broker = { signedIn: true, role: "broker" } as const;
  const holder = { signedIn: true, role: "policyholder" } as const;
  const none = { signedIn: true, role: null } as const;

  it("leaves public routes open", () => {
    for (const p of ["/sign-in", "/sign-in/factor-one", "/no-access", "/api/stripe/webhook"]) {
      expect(routeDecision(p, out)).toBe("allow");
    }
  });

  it("sends signed-out users to sign in", () => {
    for (const p of ["/", "/broker", "/broker/policies/new", "/portal", "/dev/ui"]) {
      expect(routeDecision(p, out)).toBe("sign-in");
    }
  });

  it("keeps each role in its own area", () => {
    expect(routeDecision("/broker/customers/new", broker)).toBe("allow");
    expect(routeDecision("/portal", broker)).toBe("no-access");
    expect(routeDecision("/portal", holder)).toBe("allow");
    expect(routeDecision("/broker", holder)).toBe("no-access");
    expect(routeDecision("/broker/policies/abc", holder)).toBe("no-access");
    expect(routeDecision("/broker", none)).toBe("no-access");
    expect(routeDecision("/portal", none)).toBe("no-access");
  });

  it("does not treat look-alike prefixes as the area", () => {
    expect(routeDecision("/brokerage", holder)).toBe("allow");
    expect(routeDecision("/sign-in-evil", out)).toBe("sign-in");
  });

  it("routes home by role", () => {
    expect(homeFor("broker")).toBe("/broker");
    expect(homeFor("policyholder")).toBe("/portal");
    expect(homeFor(null)).toBe("/no-access");
  });
});
