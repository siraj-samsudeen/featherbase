import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import { featherbaseInABrowser, tableWrittenIn } from "../testing.ts";

const journey = "journeys/importing-a-spreadsheet.md";
const employeesFile = "samples/employees/employees.csv";

const { openInNewTab } = featherbaseInABrowser();
let page: Page;

test.failing("Journey: importing a spreadsheet", async () => {
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
  await page.getByRole("link", { name: "Import data" }).click();
}

async function giveItTheEmployeesFile() {
  await page.locator('input[type="file"]').setInputFiles(employeesFile);
}

async function seeTheTableFeatherbaseWouldMake() {
  await sees("Employees");
  await sees("24 rows");
  await sees("7 Columns");
  expect(await tableOnThePage()).toEqual(tableWrittenIn(journey));
}

async function pressCreateWithoutChangingAnything() {
  await page.getByRole("button", { name: "Create" }).click();
}

async function seeTheEmployeesList() {
  await page.getByRole("heading", { name: "Employees" }).waitFor();
  await sees("1 to 10 of 24");
  expect(await tableOnThePage()).toEqual(headerAndFirstRowsOf(employeesFile, 10));
  await page.getByRole("link", { name: "Next" }).waitFor();
}

async function sees(words: string) {
  await page.getByText(words).first().waitFor();
}

function tableOnThePage() {
  return page
    .locator("tr")
    .evaluateAll((rows) => rows.map((row) => [...row.children].map((cell) => cell.textContent?.trim() ?? "")));
}

function headerAndFirstRowsOf(csvFile: string, count: number) {
  return linesOf(csvFile)
    .slice(0, count + 1)
    .map((line) => line.split(","));
}

function linesOf(file: string) {
  return readFileSync(file, "utf8").split("\n");
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
