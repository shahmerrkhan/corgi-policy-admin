import { describe, expect, it } from "vitest";
import { appUrl } from "@/lib/app-url";

describe("appUrl", () => {
  it("prefers APP_URL and keeps only its origin", () => {
    expect(
      appUrl({ APP_URL: "https://corgi.example.com/", VERCEL_URL: "x.vercel.app", NODE_ENV: "production" }),
    ).toBe("https://corgi.example.com");
    expect(appUrl({ APP_URL: " http://localhost:3000/path " })).toBe("http://localhost:3000");
  });

  it("rejects a malformed or non-http APP_URL without echoing it", () => {
    expect(() => appUrl({ APP_URL: "corgi.example.com" })).toThrow("APP_URL is not an absolute URL");
    expect(() => appUrl({ APP_URL: "ftp://corgi.example.com" })).toThrow("APP_URL must be http(s)");
  });

  it("uses the production domain on a Vercel production deploy", () => {
    expect(
      appUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "corgi-policy-admin.vercel.app",
        VERCEL_URL: "corgi-abc123.vercel.app",
        NODE_ENV: "production",
      }),
    ).toBe("https://corgi-policy-admin.vercel.app");
  });

  it("uses the deployment URL on a Vercel preview", () => {
    expect(
      appUrl({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "corgi-policy-admin.vercel.app",
        VERCEL_URL: "corgi-abc123.vercel.app",
        NODE_ENV: "production",
      }),
    ).toBe("https://corgi-abc123.vercel.app");
  });

  it("falls back to localhost only outside production", () => {
    expect(appUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(appUrl({})).toBe("http://localhost:3000");
    expect(() => appUrl({ NODE_ENV: "production" })).toThrow("APP_URL is not set");
  });
});
