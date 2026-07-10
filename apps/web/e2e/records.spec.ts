import { test, expect } from "@playwright/test";
import { createBook, createBookDoctype, signIn } from "./helpers";

// E2E rows P9–P11, P13–P15 (docs/e2e-testing.md): the generated grid, form,
// and detail views over the repository layer — real browser, real backend.

function dataRows(page: import("@playwright/test").Page) {
  return page.locator("tbody tr");
}

test("creates records through the generated form with typed cells", async ({
  page,
}) => {
  await signIn(page);
  await createBookDoctype(page);

  await createBook(page, { title: "Dune", pages: "412", signed: true });
  await createBook(page, { title: "Micro" });

  await expect(dataRows(page)).toHaveCount(2);
  const duneRow = dataRows(page).filter({ hasText: "Dune" });
  await expect(duneRow.getByRole("cell").nth(1)).toHaveText("412");
  await expect(duneRow.getByRole("cell").nth(2)).toHaveText("Yes");
  const microRow = dataRows(page).filter({ hasText: "Micro" });
  await expect(microRow.getByRole("cell").nth(1)).toHaveText("");
});

test("sorts a numeric column and clears back to all records", async ({
  page,
}) => {
  await signIn(page);
  await createBookDoctype(page);
  await createBook(page, { title: "Dune", pages: "412" });
  await createBook(page, { title: "Flat", pages: "100" });
  await createBook(page, { title: "Micro" });

  const pagesHeader = page.getByRole("button", { name: "Pages" });

  // Ascending — the record with no pages value drops out (no sidecar row).
  await pagesHeader.click();
  await expect(dataRows(page)).toHaveCount(2);
  await expect(dataRows(page).first()).toContainText("Flat");

  // Descending.
  await pagesHeader.click();
  await expect(dataRows(page).first()).toContainText("Dune");

  // Third click clears the sort and restores the unset-field record.
  await pagesHeader.click();
  await expect(dataRows(page)).toHaveCount(3);
});

test("filters by a select option and clears the filter", async ({ page }) => {
  await signIn(page);
  await createBookDoctype(page);
  await createBook(page, { title: "Dune", genre: "fiction" });
  await createBook(page, { title: "Cosmos", genre: "science" });

  await page.getByLabel("Filter by").selectOption("genre");
  await page.getByLabel("Value").selectOption("fiction");
  await expect(dataRows(page)).toHaveCount(1);
  await expect(dataRows(page).first()).toContainText("Dune");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(dataRows(page)).toHaveCount(2);
});

test("edits a record from the detail view and sees the grid update", async ({
  page,
}) => {
  await signIn(page);
  await createBookDoctype(page);
  await createBook(page, { title: "Dune", pages: "412" });

  await page.getByRole("cell", { name: "Dune" }).click();
  await expect(page.getByText("Owner")).toBeVisible();
  await expect(page.getByText("Created")).toBeVisible();
  await expect(page.getByText("Modified")).toBeVisible();
  const pages = page.getByLabel("Pages");
  await expect(pages).toHaveValue("412");
  await pages.fill("500");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("cell", { name: "500" })).toBeVisible();
});

test("deletes a record from the detail view", async ({ page }) => {
  await signIn(page);
  await createBookDoctype(page);
  await createBook(page, { title: "Dune" });

  await page.getByRole("cell", { name: "Dune" }).click();
  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("No records yet")).toBeVisible();
});

test("shows record-not-found for a stale record URL", async ({ page }) => {
  await signIn(page);
  await createBookDoctype(page);
  await createBook(page, { title: "Dune" });

  await page.getByRole("cell", { name: "Dune" }).click();
  await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
  const staleUrl = page.url();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No records yet")).toBeVisible();

  await page.goto(staleUrl);

  await expect(page.getByText("Record not found")).toBeVisible();
});
