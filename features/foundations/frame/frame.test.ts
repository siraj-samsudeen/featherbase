import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { give, openInNewTab } = featherbaseInABrowser();

test("Every page has the sidebar: Featherbase, Home, and each Table with its number of rows.", async () => {
  await aTableIsMadeFrom("items.csv", ["Item", "Pen", "Ink", "Paper"]);
  for (const address of ["/", "/import", "/tables/items", "/no-such-page"]) {
    const { page } = await openInNewTab(address);
    expect(await linksInTheSidebarOf(page), address).toEqual(["Featherbase", "Home", "Items 3"]);
  }
});

async function aTableIsMadeFrom(fileName: string, lines: string[]) {
  const page = await give(fileName, lines);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL("**/tables/*");
  return page;
}

async function linksInTheSidebarOf(page: Page) {
  const links = await sidebarOf(page).getByRole("link").evaluateAll(wordsOfEachWithoutItsPicture);
  return links.map(onOneLine);
}

function wordsOfEachWithoutItsPicture(links: Element[]) {
  return links.map((link) => {
    const copy = link.cloneNode(true) as Element;
    for (const picture of copy.querySelectorAll("[aria-hidden]")) picture.remove();
    return copy.textContent ?? "";
  });
}

function sidebarOf(page: Page) {
  return page.getByRole("navigation", { name: "Featherbase" });
}

function onOneLine(words: string) {
  return words.replace(/\s+/g, " ").trim();
}
