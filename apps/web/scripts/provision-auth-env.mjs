// Provision Convex Auth key material on the current deployment — the
// non-interactive equivalent of `npx @convex-dev/auth` (which needs a login
// prompt this environment can't answer). Idempotent: skips if JWKS is set.
// Used by the e2e server bootstrap against the anonymous local deployment;
// works against any deployment `npx convex env` can reach.
import { execFileSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const run = (...args) =>
  execFileSync("npx", ["convex", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

const existing = run("env", "list");
if (existing.includes("JWKS")) {
  console.log("Convex Auth env vars already provisioned — skipping.");
  process.exit(0);
}

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey))
  .trimEnd()
  .replace(/\n/g, " ");
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });
const siteUrl = process.env.E2E_SITE_URL ?? "http://127.0.0.1:5173";

run("env", "set", "--", "JWT_PRIVATE_KEY", privateKey);
run("env", "set", "--", "JWKS", jwks);
run("env", "set", "--", "SITE_URL", siteUrl);
console.log("Provisioned JWT_PRIVATE_KEY, JWKS, SITE_URL.");
