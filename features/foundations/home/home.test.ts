import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { openInNewTab } = featherbaseInABrowser();

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

function textOn(page: Page) {
  return page.innerText("body");
}

function headingOn(page: Page) {
  return page.innerText("h1");
}
