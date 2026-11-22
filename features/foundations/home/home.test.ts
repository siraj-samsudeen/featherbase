import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { give, openInNewTab } = featherbaseInABrowser();

test('Opening Featherbase shows "Welcome to Featherbase".', async () => {
  const visit = await openInNewTab("/");
  expect(await textOn(visit.page)).toContain("Welcome to Featherbase");
});

test('Opening an address Featherbase does not have shows "Page not found".', async () => {
  const visit = await openInNewTab("/no-such-page");
  expect(visit.status).toBe(404);
  expect(await textOn(visit.page)).toContain("Page not found");
});

test('Home has a link "Import data" that opens the Import data page.', async () => {
  const visit = await openInNewTab("/");
  await visit.page.getByRole("link", { name: "Import data" }).click();
  expect(await headingOn(visit.page)).toBe("Import data");
});

test("Home lists each Table with its number of rows, and its name opens the list.", async () => {
  const proposal = await give("pens.csv", ["Pen", "Blue", "Red"]);
  await proposal.getByRole("button", { name: "Create" }).click();
  await proposal.waitForURL("**/tables/*");

  const { page } = await openInNewTab("/");
  const yourTables = page.getByRole("region", { name: "Your Tables" });
  expect(await yourTables.innerText()).toContain("2 rows");
  await yourTables.getByRole("link", { name: "Pens" }).click();
  await page.waitForURL("**/tables/pens");
  expect(await headingOn(page)).toBe("Pens");
});

function textOn(page: Page) {
  return page.innerText("body");
}

function headingOn(page: Page) {
  return page.innerText("h1");
}
