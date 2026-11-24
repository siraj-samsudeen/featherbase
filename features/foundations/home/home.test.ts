import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { make, openInNewTab } = featherbaseInABrowser();

test('Opening Featherbase shows "Welcome To Featherbase".', async () => {
  const visit = await openInNewTab("/");
  expect(await textOn(visit.page)).toContain("Welcome To Featherbase");
});

test('Opening an address Featherbase does not have shows "Page not found".', async () => {
  const visit = await openInNewTab("/no-such-page");
  expect(visit.status).toBe(404);
  expect(await textOn(visit.page)).toContain("Page not found");
});

test('Home has a link "Import Data" that opens the Import Data page.', async () => {
  const visit = await openInNewTab("/");
  await visit.page.getByRole("link", { name: "Import Data" }).click();
  expect(await headingOn(visit.page)).toBe("Import Data");
});

test('Home lists each Table with its Columns, its key and its number of rows: "2 Columns, keyed by Code", "3 rows".', async () => {
  await make("pens.csv", ["Code,Colour", "P1,Blue", "P2,Red", "P3,Black"]);

  const { page } = await openInNewTab("/");
  const yourTables = page.getByRole("region", { name: "Your Tables" });
  expect(await yourTables.innerText()).toContain("2 Columns, keyed by Code");
  expect(await yourTables.innerText()).toContain("3 rows");
  await yourTables.getByRole("link", { name: "Pens" }).click();
  await page.waitForURL("**/tables/pens");
  expect(await headingOn(page)).toBe("Pens");
});

test('Home says when each Table last changed: "changed today".', async () => {
  await make("inks.csv", ["Ink", "Black", "Blue"]);
  const { page } = await openInNewTab("/");
  const inks = page.getByRole("region", { name: "Your Tables" }).getByRole("link", { name: "Inks" });
  expect(await inks.innerText()).toContain("changed today");
});

test("Once there is a Table, the welcome gives way to the lists.", async () => {
  await make("nibs.csv", ["Nib", "Fine", "Broad"]);
  const { page } = await openInNewTab("/");
  expect(await textOn(page)).not.toContain("Welcome To Featherbase");
});

function textOn(page: Page) {
  return page.innerText("body");
}

function headingOn(page: Page) {
  return page.innerText("h1");
}
