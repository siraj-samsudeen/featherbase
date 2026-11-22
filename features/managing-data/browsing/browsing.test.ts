import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { give } = featherbaseInABrowser();

test('The list shows the rows in the file\'s order, 10 at a time, and says which rows of how many: "1 to 10 of 24".', async () => {
  const page = await listOfATableMadeFrom("items.csv", ["Item", ...itemsNumbered(1, 24)]);
  await sees(page, "1 to 10 of 24");
  expect(await firstCellsOn(page)).toEqual(itemsNumbered(1, 10));
});

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
