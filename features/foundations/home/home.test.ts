import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, type Page, chromium } from "playwright";

const address = "http://localhost:3210";
let featherbase: ReturnType<typeof Bun.spawn>;
let browser: Browser;

beforeAll(async () => {
  startFeatherbase();
  await waitUntilFeatherbaseAnswers();
  await openBrowser();
});

afterAll(async () => {
  await closeBrowser();
  stopFeatherbase();
});

test('Opening Featherbase shows "Welcome to Featherbase".', async () => {
  const page = await openFeatherbaseInNewTab();
  expect(await textOn(page)).toContain("Welcome to Featherbase");
});

function startFeatherbase() {
  featherbase = Bun.spawn(["bun", "start"], { env: { ...process.env, PORT: "3210" } });
}

async function waitUntilFeatherbaseAnswers() {
  const giveUpAt = Date.now() + 3000;
  while (!(await featherbaseAnswers())) {
    if (Date.now() > giveUpAt) throw new Error(`Featherbase did not start at ${address}`);
    await Bun.sleep(100);
  }
}

function featherbaseAnswers() {
  return fetch(address).then(
    () => true,
    () => false,
  );
}

async function openBrowser() {
  browser = await chromium.launch();
}

async function openFeatherbaseInNewTab() {
  const page = await browser.newPage();
  await page.goto(address);
  return page;
}

function textOn(page: Page) {
  return page.innerText("body");
}

async function closeBrowser() {
  await browser?.close();
}

function stopFeatherbase() {
  featherbase.kill();
}
