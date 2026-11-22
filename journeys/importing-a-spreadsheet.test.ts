import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, type Page, chromium } from "playwright";
import { createFeatherbase } from "../featherbase.ts";

let featherbase: ReturnType<typeof createFeatherbase>;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  featherbase = createFeatherbase().listen(0);
  browser = await chromium.launch();
  page = await browser.newPage({ baseURL: `http://localhost:${featherbase.server?.port}` });
  page.setDefaultTimeout(1000);
});

afterAll(async () => {
  await browser?.close();
  await featherbase.stop();
});

test.failing("Journey: importing a spreadsheet", async () => {
  await inOrder(
    priyaOpensFeatherbaseAndChoosesImportData,
    sheGivesItTheEmployeesFile,
    sheSeesWhatFeatherbaseUnderstood,
    sheChangesNothingAndPressesCreate,
    theEmployeesListOpens,
  );
});

async function priyaOpensFeatherbaseAndChoosesImportData() {
  await page.goto("/");
  await page.getByRole("link", { name: "Import data" }).click();
}

async function sheGivesItTheEmployeesFile() {
  await page.locator('input[type="file"]').setInputFiles("samples/employees/employees.csv");
}

async function sheSeesWhatFeatherbaseUnderstood() {
  await sees("Employees");
  await sees("24 rows");
  await sees("7 Columns");
  await seesColumn("Employee Code", "Text");
  await seesColumn("Employee Code", "Key");
  await seesColumn("Name", "Text");
  await seesColumn("Department", "Choice");
  await seesColumn("Department", "5 values");
  await seesColumn("Date of Joining", "Date");
  await seesColumn("Date of Leaving", "Date");
  await seesColumn("Active", "Yes/No");
  await seesColumn("Weekly Hours", "Number");
}

async function sheChangesNothingAndPressesCreate() {
  await page.getByRole("button", { name: "Create" }).click();
}

async function theEmployeesListOpens() {
  await page.getByRole("heading", { name: "Employees" }).waitFor();
  await sees("1 to 10 of 24");
  await sees("Asha Raman");
  await sees("Jacob Thomas");
  await doesNotSee("Kavya Iyer");
  await page.getByRole("link", { name: "Next" }).waitFor();
}

async function sees(words: string) {
  await page.getByText(words, { exact: false }).first().waitFor();
}

async function doesNotSee(words: string) {
  expect(await page.getByText(words).count()).toBe(0);
}

async function seesColumn(name: string, words: string) {
  await page.locator("tr, li").filter({ hasText: name }).filter({ hasText: words }).first().waitFor();
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
