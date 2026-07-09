// The deployment is its own token issuer: Convex Auth signs JWTs with the
// deployment's JWT_PRIVATE_KEY and this config tells Convex to trust them
// (validated against the JWKS served by http.ts).
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
