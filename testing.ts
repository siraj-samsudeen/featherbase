import { afterAll, beforeAll } from "bun:test";
import { type Browser, chromium } from "playwright";
import { createFeatherbase } from "./featherbase.ts";

export function featherbaseInABrowser() {
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

  function startFeatherbaseOnAFreePort() {
    featherbase = createFeatherbase().listen(0);
    address = `http://localhost:${featherbase.server?.port}`;
  }

  async function openBrowser() {
    browser = await chromium.launch();
  }

  async function openInNewTab(path: string) {
    const page = await browser.newPage({ baseURL: address });
    page.setDefaultTimeout(1000);
    const response = await page.goto(path);
    return { page, status: response?.status() };
  }

  async function closeBrowser() {
    await browser?.close();
  }

  async function stopFeatherbase() {
    await featherbase.stop();
  }

  return { openInNewTab };
}
