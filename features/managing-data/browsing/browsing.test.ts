import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { give, openInNewTab } = featherbaseInABrowser();

test('The list shows the rows in the file\'s order, 10 at a time, and says which rows of how many: "1 to 10 of 24".', async () => {
  const page = await listOfATableMadeFrom("items.csv", ["Item", ...itemsNumbered(1, 24)]);
  await sees(page, "1 to 10 of 24");
  expect(await firstCellsOn(page)).toEqual(itemsNumbered(1, 10));
});

test('"Next" opens the rows that follow. The last rows have no "Next".', async () => {
  const page = await listOfATableMadeFrom("items.csv", ["Item", ...itemsNumbered(1, 24)]);

  await next(page).click();
  await sees(page, "11 to 20 of 24");
  expect(await firstCellsOn(page)).toEqual(itemsNumbered(11, 20));

  await next(page).click();
  await sees(page, "21 to 24 of 24");
  expect(await firstCellsOn(page)).toEqual(itemsNumbered(21, 24));
  expect(await next(page).count()).toBe(0);
});

test("A cell is shown exactly as it was written in the file, even when it looks like HTML.", async () => {
  const asWritten = ['<b>Bold</b> & "quoted"', "<script>document.body.remove()</script>"];
  const page = await listOfATableMadeFrom("items.csv", ["Item <i>header</i>", ...asWritten]);
  expect(await page.locator("th").innerText()).toBe("Item <i>header</i>");
  expect(await firstCellsOn(page)).toEqual(asWritten);
});

test('Opening a Table Featherbase does not have shows "Page not found".', async () => {
  const visit = await openInNewTab("/tables/no-such-table");
  expect(visit.status).toBe(404);
  expect(await visit.page.innerText("body")).toContain("Page not found");
});

function next(page: Page) {
  return page.getByRole("link", { name: "Next" });
}

async function listOfATableMadeFrom(fileName: string, lines: string[]) {
  const page = await give(fileName, lines);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL("**/tables/*");
  return page;
}

function itemsNumbered(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => `Item ${first + index}`);
}

async function sees(page: Page, words: string) {
  await page.getByText(words).waitFor();
}

function firstCellsOn(page: Page) {
  return page.locator("tbody td:first-child").allInnerTexts();
}
