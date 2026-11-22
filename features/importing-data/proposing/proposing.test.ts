import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { openInNewTab } = featherbaseInABrowser();

test('The Table\'s name comes from the file name: `employees.csv` gives "Employees".', async () => {
  const page = await give("employees.csv", ["Name", "Asha"]);
  expect(await tableNameOn(page)).toBe("Employees");
});

test("It says how many rows and how many Columns the file has.", async () => {
  const page = await give("people.csv", ["Name,City,Age", "Asha,Chennai,31", "Bala,Madurai,45"]);
  expect(await textOn(page)).toContain("2 rows, 3 Columns");
});

async function give(fileName: string, lines: string[]) {
  const { page } = await openInNewTab("/import");
  await page.locator('input[type="file"]').setInputFiles(fileOf(fileName, lines));
  return page;
}

function fileOf(name: string, lines: string[]) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) };
}

function tableNameOn(page: Page) {
  return page.innerText("h2");
}

function textOn(page: Page) {
  return page.innerText("body");
}
