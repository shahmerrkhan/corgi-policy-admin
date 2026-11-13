// Clerk session token claims. The dashboard customizes the session token with
// {"metadata": "{{user.public_metadata}}"}, so the role is readable without an API call.
export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata?: {
      role?: unknown;
    };
  }
}
