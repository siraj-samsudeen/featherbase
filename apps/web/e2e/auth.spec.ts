import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

// E2E rows P1–P4 (docs/e2e-testing.md): the capability-4 tracer's browser
// half — real anonymous users, real JWTs issued by the local deployment.

test("shows the sign-in gate to an unauthenticated visitor", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  await expect(page.getByRole("link", { name: "DocTypes" })).toHaveCount(0);
});

test("signs in anonymously and enters the shell", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByLabel("Task")).toBeVisible();
});

test("keeps the session across a reload", async ({ page }) => {
  await signIn(page);

  await page.reload();

  await expect(page.getByRole("link", { name: "DocTypes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get started" })).toHaveCount(
    0,
  );
});

test("signs out back to the gate", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
});
