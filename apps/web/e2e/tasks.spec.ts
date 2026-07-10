import { test, expect } from "@playwright/test";
import { signIn, uniqueName } from "./helpers";

// E2E row P5 (docs/e2e-testing.md): the capability-1 tasks demo, per-user
// data scoped to the signed-in anonymous identity.

test("adds a task that persists across a reload", async ({ page }) => {
  await signIn(page);
  const text = `buy milk ${uniqueName("t")}`;

  await page.getByLabel("Task").fill(text);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: text }),
  ).toBeVisible();

  await page.reload();

  await expect(
    page.getByRole("listitem").filter({ hasText: text }),
  ).toBeVisible();
});
