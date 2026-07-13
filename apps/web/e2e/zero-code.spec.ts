import { test, expect } from "@playwright/test";
import { createDoctype, uniqueName } from "./helpers";

// E2E row P16 (docs/e2e-testing.md) — the capability-4 tracer bullet, whole:
// sign in from a real browser and run the zero-code loop with no identity
// injection and no hacks (the exact flow that needed a stub on 2026-07-09).

test("runs the zero-code loop end to end behind a real sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByRole("link", { name: "DocTypes" })).toBeVisible();

  // Design a DocType through the UI alone.
  const name = uniqueName("note");
  await createDoctype(page, name, `Note ${name}`, [
    { name: "text", label: "Text", required: true, filterable: true },
    { name: "stars", label: "Stars", type: "number", filterable: true },
  ]);

  // Create.
  await page.getByRole("link", { name: `New Note ${name}` }).click();
  await page.getByLabel("Text").fill("hello world");
  await page.getByLabel("Stars").fill("4");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "hello world" })).toBeVisible();

  // Edit.
  await page.getByRole("cell", { name: "hello world" }).click();
  const stars = page.getByLabel("Stars");
  await expect(stars).toHaveValue("4");
  await stars.fill("5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("cell", { name: "5", exact: true }),
  ).toBeVisible();

  // Delete.
  await page.getByRole("cell", { name: "hello world" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No records yet")).toBeVisible();

  // Out.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
});
