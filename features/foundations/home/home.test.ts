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

test('Opening Featherbase shows "Welcome to Featherbase".', async () => {
  const visit = await openInNewTab("/");
  expect(await textOn(visit.page)).toContain("Welcome to Featherbase");
});

test('Opening an address Featherbase does not have shows "Page not found".', async () => {
  const visit = await openInNewTab("/no-such-page");
  expect(visit.status).toBe(404);
  expect(await textOn(visit.page)).toContain("Page not found");
});

test('Home has a link "Import data" that opens the Import data page.', async () => {
  const visit = await openInNewTab("/");
  await visit.page.getByRole("link", { name: "Import data" }).click();
  expect(await headingOn(visit.page)).toBe("Import data");
});

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
  const response = await page.goto(address + path);
  return { page, status: response?.status() };
}

function textOn(page: Page) {
  return page.innerText("body");
}

function headingOn(page: Page) {
  return page.innerText("h1");
}

async function closeBrowser() {
  await browser?.close();
}

async function stopFeatherbase() {
  await featherbase.stop();
}
