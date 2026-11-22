import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { aFileWithAColumnOf, casesIn, featherbaseInABrowser } from "../../../testing.ts";

const { make, openInNewTab } = featherbaseInABrowser();

test('The list shows every row in the file\'s order and says how many there are: "24 rows".', async () => {
  const page = await make("items.csv", ["Item", ...itemsNumbered(1, 24)]);
  await sees(page, "24 rows");
  expect(await firstCellsOn(page)).toEqual(itemsNumbered(1, 24));
});

test("Each value is shown the way its type reads best. A blank cell is shown as a dash.", async () => {
  for (const [cells, shown] of casesIn("features/managing-data/browsing/browsing.md", "Shown as")) {
    const page = await make("things.csv", aFileWithAColumnOf(cells));
    expect(await secondCellsOn(page), cells).toEqual(shown.split(", "));
  }
});

test("Text is shown exactly as it was written in the file, even when it looks like HTML.", async () => {
  const asWritten = ['<b>Bold</b> & "quoted"', "<script>document.body.remove()</script>"];
  const page = await make("items.csv", ["Item <i>header</i>", ...asWritten]);
  expect(await page.locator("th").innerText()).toBe("Item <i>header</i>");
  expect(await firstCellsOn(page)).toEqual(asWritten);
});

test('Opening a Table Featherbase does not have shows "Page not found".', async () => {
  const visit = await openInNewTab("/tables/no-such-table");
  expect(visit.status).toBe(404);
  expect(await visit.page.innerText("body")).toContain("Page not found");
});

function itemsNumbered(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => `Item ${first + index}`);
}

async function sees(page: Page, words: string) {
  await page.getByText(words).waitFor();
}

function firstCellsOn(page: Page) {
  return page.locator("tbody td:first-child").allInnerTexts();
}

function secondCellsOn(page: Page) {
  return page.locator("tbody td:nth-child(2)").allInnerTexts();
}
