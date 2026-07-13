import { test, expect } from "@playwright/test";
import { createBookDoctype, signIn, uniqueName } from "./helpers";

// E2E rows P6–P8, P12 (docs/e2e-testing.md): the DocType designer and list.

test("designs a DocType with every field type and lands on its empty grid", async ({
  page,
}) => {
  await signIn(page);

  const name = await createBookDoctype(page);

  // The empty grid has no table yet — the metadata shows in the heading,
  // the filterable-field options, and the New link.
  await expect(page).toHaveURL(new RegExp(`/doctypes/${name}$`));
  await expect(
    page.getByRole("heading", { name: `Book ${name}` }),
  ).toBeVisible();
  await expect(page.getByLabel("Filter by").locator("option")).toHaveText([
    "Title",
    "Pages",
    "Signed",
    "Genre",
  ]);
  await expect(
    page.getByRole("link", { name: `New Book ${name}` }),
  ).toBeVisible();
});

test("rejects a duplicate DocType name inline", async ({ page }) => {
  await signIn(page);
  const name = await createBookDoctype(page);

  await page.goto("/doctypes/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Field name").fill("title");
  await page.getByRole("button", { name: "Create DocType" }).click();

  await expect(page.getByRole("alert")).toContainText("already exists");
  await expect(
    page.getByRole("button", { name: "Create DocType" }),
  ).toBeVisible();
});

test("lists the DocType and opens its grid from the list", async ({ page }) => {
  await signIn(page);
  const name = await createBookDoctype(page);

  await page.getByRole("link", { name: "DocTypes" }).click();
  await page.getByRole("link", { name: `Book ${name}` }).click();

  await expect(
    page.getByRole("heading", { name: `Book ${name}` }),
  ).toBeVisible();
  await expect(page.getByText("No records yet")).toBeVisible();
});

test("shows the unknown-DocType message", async ({ page }) => {
  await signIn(page);
  const ghost = uniqueName("ghost");

  await page.goto(`/doctypes/${ghost}`);

  await expect(page.getByText(`Unknown DocType “${ghost}”`)).toBeVisible();
});
