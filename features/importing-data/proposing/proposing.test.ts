import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser, tableWrittenIn } from "../../../testing.ts";

const { give } = featherbaseInABrowser();

test('The Table\'s name comes from the file name: `employees.csv` gives "Employees".', async () => {
  const page = await give("employees.csv", ["Name", "Asha"]);
  expect(await tableNameOn(page)).toBe("Employees");
});

test("It says how many rows and how many Columns the file has.", async () => {
  const page = await give("people.csv", ["Name,City,Age", "Asha,Chennai,31", "Bala,Madurai,45"]);
  expect(await textOn(page)).toContain("2 rows, 3 Columns");
});

test("Each header becomes a Column, in the file's order.", async () => {
  const page = await give("people.csv", ["Name,City,Age", "Asha,Chennai,31"]);
  expect(await columnNamesOn(page)).toEqual(["Name", "City", "Age"]);
});

test("A Column's type is worked out from its filled cells. A blank cell does not count.", async () => {
  for (const [cells, type] of casesWrittenIn("features/importing-data/proposing/proposing.md")) {
    const page = await give("things.csv", aFileWithAColumnOf(cells));
    expect(await typeOfTheColumnOn(page), cells).toBe(type);
  }
});

test("A Text Column whose values mostly repeat is a Choice, and says how many different values it has.", async () => {
  const nineInTenRepeat = await give(
    "things.csv",
    aFileWithAColumnOf(cells({ Sales: 5, Billing: 4, Stores: 1 })),
  );
  expect(await typeOfTheColumnOn(nineInTenRepeat)).toBe("Choice (3 values)");

  const eightInTenRepeat = await give(
    "things.csv",
    aFileWithAColumnOf(cells({ Sales: 4, Billing: 4, Stores: 1, Tailoring: 1 })),
  );
  expect(await typeOfTheColumnOn(eightInTenRepeat)).toBe("Text");
});

test("The first Column that is never blank and never repeats is suggested as the key.", async () => {
  const page = await give("people.csv", [
    "Department,Badge,Email,Phone",
    "Sales,B1,asha@example.com,111",
    "Sales,,bala@example.com,222",
    "Stores,B3,chitra@example.com,333",
  ]);
  expect(await columnsSuggestedAsKeyOn(page)).toEqual(["Email"]);
});

test("A file saved on Windows reads the same as one saved anywhere else.", async () => {
  const page = await give("things.csv", savedOnWindows(["Row,Thing", "1,48", "2,36"]));
  expect(await typeOfTheColumnOn(page)).toBe("Number");
});

test("The file's name and its headers are shown exactly as written, even when they look like HTML.", async () => {
  const page = await give("<b>People</b> & teams.csv", ["<i>Name</i>", "Asha"]);
  expect(await tableNameOn(page)).toBe("<b>People</b> & teams");
  expect(await columnNamesOn(page)).toEqual(["<i>Name</i>"]);
});

function savedOnWindows(lines: string[]) {
  const lastLineIsEndedToo = "";
  return [...lines.map((line) => `${line}\r`), lastLineIsEndedToo];
}

function cells(timesEachValueAppears: Record<string, number>) {
  return Object.entries(timesEachValueAppears)
    .flatMap(([value, times]) => Array(times).fill(value))
    .join(", ");
}

function casesWrittenIn(markdownFile: string) {
  return tableWrittenIn(markdownFile).slice(1);
}

function aFileWithAColumnOf(cellsAsWritten: string) {
  const cells = cellsAsWritten.split(", ").map(withoutBackticks).map(blankAsNothing);
  return ["Row,Thing", ...cells.map((cell, index) => `${index + 1},${cell}`)];
}

function withoutBackticks(cell: string) {
  return cell.replaceAll("`", "");
}

function blankAsNothing(cell: string) {
  return cell === "blank" ? "" : cell;
}

function tableNameOn(page: Page) {
  return page.getByLabel("Table name").inputValue();
}

function textOn(page: Page) {
  return page.innerText("body");
}

function columnNamesOn(page: Page) {
  return page.locator("tbody tr td:first-child").allInnerTexts();
}

function typeOfTheColumnOn(page: Page) {
  return page.locator("tbody tr", { hasText: "Thing" }).locator("td").nth(1).innerText();
}

function columnsSuggestedAsKeyOn(page: Page) {
  return page.locator("tbody tr", { hasText: "suggested" }).locator("td:first-child").allInnerTexts();
}
