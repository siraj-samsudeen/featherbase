import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// OpenID discovery + JWKS routes — the deployment validates its own tokens
// against these (auth.config.ts points the issuer back at CONVEX_SITE_URL).
auth.addHttpRoutes(http);

export default http;
