import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, type Page, chromium } from "playwright";
import { createFeatherbase } from "../../../featherbase.ts";

let featherbase: ReturnType<typeof createFeatherbase>;
let address: string;
let browser: Browser;

beforeAll(async () => {
  startFeatherbaseOnAFreePort();
  await openBrowser();
});

afterAll(async () => {
  await closeBrowser();
  await stopFeatherbase();
});

test('The Table\'s name comes from the file name: `employees.csv` gives "Employees".', async () => {
  const page = await give("employees.csv", ["Name", "Asha"]);
  expect(await tableNameOn(page)).toBe("Employees");
});

async function give(fileName: string, lines: string[]) {
  const page = await openInNewTab("/import");
  await page.locator('input[type="file"]').setInputFiles(fileOf(fileName, lines));
  return page;
}

function fileOf(name: string, lines: string[]) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) };
}

function tableNameOn(page: Page) {
  return page.innerText("h2");
}

function startFeatherbaseOnAFreePort() {
  featherbase = createFeatherbase().listen(0);
  address = `http://localhost:${featherbase.server?.port}`;
}

async function openBrowser() {
  browser = await chromium.launch();
}

async function openInNewTab(path: string) {
  const page = await browser.newPage();
  page.setDefaultTimeout(1000);
  await page.goto(address + path);
  return page;
}

async function closeBrowser() {
  await browser?.close();
}

async function stopFeatherbase() {
  await featherbase.stop();
}
