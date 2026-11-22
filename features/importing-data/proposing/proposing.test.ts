import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { aFileWithAColumnOf, casesIn, featherbaseInABrowser } from "../../../testing.ts";

const proposing = "features/importing-data/proposing/proposing.md";

const { give } = featherbaseInABrowser();

test('The Table\'s name comes from the file name: `employees.csv` gives "Employees".', async () => {
  const page = await give("employees.csv", ["Name", "Asha"]);
  expect(await tableNameOn(page)).toBe("Employees");
});

test('It says how many rows and how many columns the file has: "24 rows and 7 columns".', async () => {
  const page = await give("people.csv", ["Name,City,Age", "Asha,Chennai,31", "Bala,Madurai,45"]);
  expect(await textOn(page)).toContain("2 rows and 3 columns");
});

test("Each header becomes a Column, in the file's order.", async () => {
  const page = await give("people.csv", ["Name,City,Age", "Asha,Chennai,31"]);
  expect(await columnNamesOn(page)).toEqual(["Name", "City", "Age"]);
});

test("A Column's type is worked out from its filled cells and shown as the chosen type. A blank cell does not count.", async () => {
  for (const [cells, type] of casesIn(proposing, "Type")) {
    const page = await give("things.csv", aFileWithAColumnOf(cells));
    expect(await typeOfTheColumnOn(page), cells).toBe(type);
  }
});

test("A Text Column whose values mostly repeat is proposed as a Choice.", async () => {
  const nineInTenRepeat = await give("things.csv", aFileWithAColumnOf(cells({ Sales: 5, Billing: 4, Stores: 1 })));
  expect(await typeOfTheColumnOn(nineInTenRepeat)).toBe("Choice");

  const eightInTenRepeat = await give(
    "things.csv",
    aFileWithAColumnOf(cells({ Sales: 4, Billing: 4, Stores: 1, Tailoring: 1 })),
  );
  expect(await typeOfTheColumnOn(eightInTenRepeat)).toBe("Text");
});

test("The first Column that is never blank and never repeats is chosen as the key.", async () => {
  const page = await give("people.csv", [
    "Department,Badge,Email,Phone",
    "Sales,B1,asha@example.com,111",
    "Sales,,bala@example.com,222",
    "Stores,B3,chitra@example.com,333",
  ]);
  expect(await keyChosenOn(page)).toBe("Email");
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

test("A type can be chosen only if every filled cell fits it. Choice fits when the values mostly repeat.", async () => {
  for (const [cells, types] of casesIn(proposing, "Types that can be chosen")) {
    const page = await give("things.csv", aFileWithAColumnOf(cells));
    expect(await typesThatCanBeChosenOn(page), cells).toEqual(types.split(", "));
  }
});

test("Only a Column that is never blank and never repeats can be chosen as the key.", async () => {
  const page = await give("people.csv", [
    "Department,Badge,Email,Phone",
    "Sales,B1,asha@example.com,111",
    "Sales,,bala@example.com,222",
    "Stores,B3,chitra@example.com,333",
  ]);
  expect(await columnsThatCanBeTheKeyOn(page)).toEqual(["Email", "Phone"]);
});

test("Beside each Column, Featherbase says what it saw in the cells, with a few of them as examples.", async () => {
  for (const [cells, saw] of casesIn(proposing, "What Featherbase saw")) {
    const page = await give("things.csv", aFileWithAColumnOf(cells));
    expect(await whatFeatherbaseSawIn("Thing", page), cells).toBe(saw);
  }
});

test('For the Column chosen as the key it says "Never blank, never repeats."', async () => {
  const page = await give("things.csv", ["Code,Thing", "E1,Pen", "E2,Ink", "E3,Pad", "E4,Cap"]);
  expect(await whatFeatherbaseSawIn("Code", page)).toBe("Never blank, never repeats. E1, E2, E3");
});

test('Under "How The First Rows Will Look", the first five rows are shown as the list will show them.', async () => {
  const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"];
  const page = await give("days.csv", aFileWithAColumnOf(days.join(", ")));
  const firstRows = page.getByRole("region", { name: "How The First Rows Will Look" });
  expect(await firstRows.locator("td:nth-child(2)").allInnerTexts()).toEqual([
    "01-Jan-2026",
    "02-Jan-2026",
    "03-Jan-2026",
    "04-Jan-2026",
    "05-Jan-2026",
  ]);
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

function tableNameOn(page: Page) {
  return page.getByLabel("Table name").inputValue();
}

function textOn(page: Page) {
  return page.innerText("body");
}

function columnNamesOn(page: Page) {
  return page.getByRole("region", { name: "Columns" }).locator("tbody td:first-child").allInnerTexts();
}

function typeOfTheColumnOn(page: Page) {
  return page.getByLabel("Type of Thing").inputValue();
}

function keyChosenOn(page: Page) {
  return page.getByRole("radio", { checked: true }).getAttribute("value");
}

function typesThatCanBeChosenOn(page: Page) {
  return page.getByLabel("Type of Thing").locator("option:not([disabled])").allInnerTexts();
}

async function columnsThatCanBeTheKeyOn(page: Page) {
  const radios = await page.getByRole("radio", { disabled: false }).all();
  return Promise.all(radios.map((radio) => radio.getAttribute("value")));
}

async function whatFeatherbaseSawIn(columnName: string, page: Page) {
  const row = page.getByRole("region", { name: "Columns" }).locator("tbody tr", { hasText: columnName });
  return (await row.locator("td").nth(2).innerText()).replace(/\s+/g, " ").trim();
}
