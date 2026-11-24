import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { columnsProposedOn, featherbaseInABrowser, pressCreateTableOn, tableOn, tableWrittenIn } from "../testing.ts";

const journey = "journeys/importing-a-spreadsheet.md";
const employeesFile = "samples/employees/employees.csv";

const { openInNewTab } = featherbaseInABrowser();
let page: Page;

test("Journey: importing a spreadsheet", async () => {
  await inOrder(
    openFeatherbaseAndChooseImportData,
    giveItTheEmployeesFile,
    seeTheTableFeatherbaseWouldMake,
    pressCreateWithoutChangingAnything,
    seeTheEmployeesList,
  );
});

async function openFeatherbaseAndChooseImportData() {
  page = (await openInNewTab("/")).page;
  await page.getByRole("link", { name: "Import Data" }).click();
}

async function giveItTheEmployeesFile() {
  await page.locator('input[type="file"]').setInputFiles(employeesFile);
}

async function seeTheTableFeatherbaseWouldMake() {
  expect(await page.getByLabel("Table name").inputValue()).toBe("Employees");
  await sees("24 rows");
  await sees("7 columns");
  expect(await columnsProposedOn(page)).toEqual(columnsWrittenIn(journey));
}

async function pressCreateWithoutChangingAnything() {
  await pressCreateTableOn(page);
}

async function seeTheEmployeesList() {
  await page.getByRole("heading", { name: "Employees" }).waitFor();
  await sees("24 rows");
  const [headings, firstRow, ...otherRows] = await tableOn(page);
  expect(headings).toEqual(journeyColumn("Column"));
  expect(firstRow).toEqual(journeyColumn("In the first row"));
  expect(otherRows.length).toBe(23);
}

async function sees(words: string) {
  await page.getByText(words).first().waitFor();
}

function columnsWrittenIn(markdownFile: string) {
  return tableWrittenIn(markdownFile)
    .slice(1)
    .map(([column, type, key]) => [column, type, key]);
}

function journeyColumn(heading: string) {
  const [headings, ...rows] = tableWrittenIn(journey);
  return rows.map((row) => row[headings.indexOf(heading)]);
}

async function inOrder(...steps: (() => Promise<void>)[]) {
  for (const [index, step] of steps.entries()) {
    try {
      await step();
    } catch (error) {
      console.log(`journey stopped at step ${index + 1} of ${steps.length}: ${step.name}`);
      throw error;
    }
  }
}
