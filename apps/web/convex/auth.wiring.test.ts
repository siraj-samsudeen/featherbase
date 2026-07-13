import { expect, vi } from "vitest";
import { test } from "./test.setup";
import { api } from "./_generated/api";
import { productDefinition } from "./doctype/test.helpers";

// Matrix rows B1, C1, C2 (docs/capabilities/4-sign-in/research-spec-plan.md)

test("derives the owner from the user half of a subject", async ({
  testClient,
  client,
  userId,
}) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  // Convex Auth JWTs carry `${userId}|${sessionId}` as the subject claim.
  const sessionClient = testClient.withIdentity({
    subject: `${userId}|session123`,
  });

  const id = await sessionClient.mutation(api.records.create, {
    doctype: "product",
    data: { title: "Widget", price: 10, category: "gadget" },
  });

  const doc = await sessionClient.query(api.records.get, {
    doctype: "product",
    id,
  });
  expect(doc?.owner).toBe(userId);
});

test("serves the OpenID discovery document over HTTP", async ({
  testClient,
}) => {
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");

  const response = await testClient.fetch("/.well-known/openid-configuration");

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.issuer).toBe("https://example.convex.site");
  vi.unstubAllEnvs();
});

test("declares the deployment as its own JWT issuer", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");

  const { default: authConfig } = await import("./auth.config");

  expect(authConfig.providers).toEqual([
    { domain: "https://example.convex.site", applicationID: "convex" },
  ]);
  vi.unstubAllEnvs();
});
