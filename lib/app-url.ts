// Public origin of the app, for absolute URLs (Stripe Checkout return URLs). Never derived
// from request headers. Order: APP_URL, then the Vercel URL, then localhost outside production.

type Env = Record<string, string | undefined>;

export function appUrl(env: Env = process.env): string {
  const explicit = env.APP_URL?.trim();
  if (explicit) {
    let url: URL;
    try {
      url = new URL(explicit);
    } catch {
      throw new Error("APP_URL is not an absolute URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("APP_URL must be http(s)");
    return url.origin;
  }

  const vercelHost = env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL;
  if (vercelHost?.trim()) return `https://${vercelHost.trim().replace(/\/+$/, "")}`;

  if (env.NODE_ENV !== "production") return "http://localhost:3000";
  throw new Error("APP_URL is not set");
}
