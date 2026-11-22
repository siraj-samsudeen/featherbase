import { afterAll, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { type Browser, type Page, chromium } from "playwright";
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
    await page.route(isOutsideFeatherbase, (request) => request.abort());
    const response = await page.goto(path);
    return { page, status: response?.status() };
  }

  function isOutsideFeatherbase(url: URL) {
    return !url.href.startsWith(address);
  }

  async function give(fileName: string, lines: string[]) {
    const { page } = await openInNewTab("/import");
    const proposalShown = page.waitForEvent("load");
    await page.locator('input[type="file"]').setInputFiles(fileOf(fileName, lines));
    await proposalShown;
    return page;
  }

  async function make(fileName: string, lines: string[]) {
    return pressCreateTableOn(await give(fileName, lines));
  }

  async function closeBrowser() {
    await browser?.close();
  }

  async function stopFeatherbase() {
    await featherbase.stop();
  }

  return { openInNewTab, give, make };
}

export async function pressCreateTableOn(proposal: Page) {
  await proposal.getByRole("button", { name: "Create Table" }).click();
  await proposal.waitForURL("**/tables/*");
  return proposal;
}

function fileOf(name: string, lines: string[]) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) };
}

export async function tableOn(page: Page) {
  const rows = await page.locator("tr").all();
  return Promise.all(rows.map((row) => row.locator("th, td").allInnerTexts()));
}

export function tableWrittenIn(markdownFile: string) {
  return linesOf(markdownFile)
    .filter(isATableRow)
    .filter(isNotTheRuleUnderTheHeader)
    .map(cellsOfATableRow);
}

function linesOf(file: string) {
  return readFileSync(file, "utf8").split("\n");
}

function isATableRow(line: string) {
  return line.trim().startsWith("|");
}

function isNotTheRuleUnderTheHeader(line: string) {
  return !line.includes("---");
}

function cellsOfATableRow(line: string) {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}
