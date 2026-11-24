import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { make } = featherbaseInABrowser();

const pens = ["Code,Pen", "P1,Fine Liner", "P2,Marker"];

test("A person chooses how a record opens, side panel or full page, and the choice is remembered.", async () => {
  const page = await make("pens.csv", pens);
  await openTheRecordOf("Marker", page);
  expect(await theListIsBesideTheRecordOn(page)).toBe(true);

  await page.getByText("View ▾").click();
  await chooseOn(page, "Full page");
  expect(await theListIsBesideTheRecordOn(page)).toBe(false);

  await leaveAndComeBackTo("Pens", page);
  await openTheRecordOf("Marker", page);
  expect(await theListIsBesideTheRecordOn(page)).toBe(false);
});

test("A person chooses the row height, comfortable or compact, and the choice is remembered.", async () => {
  const page = await make("inks.csv", pens);
  const comfortable = await heightOfARowOn(page);

  await chooseOn(page, "Compact Rows");
  expect(await heightOfARowOn(page)).toBeLessThan(comfortable);

  await leaveAndComeBackTo("Inks", page);
  expect(await heightOfARowOn(page)).toBeLessThan(comfortable);

  await chooseOn(page, "Comfortable");
  expect(await heightOfARowOn(page)).toBe(comfortable);
});

async function chooseOn(page: Page, choice: string) {
  await Promise.all([page.waitForEvent("load"), page.getByText(choice, { exact: true }).click()]);
}

async function openTheRecordOf(name: string, page: Page) {
  await page.getByRole("link", { name }).click();
  await page.getByRole("form", { name }).waitFor();
}

function theListIsBesideTheRecordOn(page: Page) {
  return page.locator(".gridbox").isVisible();
}

async function leaveAndComeBackTo(table: string, page: Page) {
  const sidebar = page.getByRole("navigation", { name: "Featherbase" });
  await sidebar.getByRole("link", { name: "Home", exact: true }).click();
  await sidebar.getByRole("link", { name: new RegExp(`^${table} `) }).click();
  await page.getByRole("heading", { name: table }).waitFor();
}

async function heightOfARowOn(page: Page) {
  const row = await page.locator("tbody tr").first().boundingBox();
  return row?.height;
}
