import { expect, test } from "bun:test";
import type { Locator, Page } from "playwright";
import { featherbaseInABrowser } from "../../../testing.ts";

const { give, openInNewTab } = featherbaseInABrowser();

test("Every page has the sidebar: Featherbase, Home, and each Table with its number of rows.", async () => {
  await aTableIsMadeFrom("items.csv", ["Item", "Pen", "Ink", "Paper"]);
  for (const address of ["/", "/import", "/tables/items", "/no-such-page"]) {
    const { page } = await openInNewTab(address);
    expect(await linksInTheSidebarOf(page), address).toEqual(["Featherbase", "Home", "Items 3"]);
  }
});

test("The sidebar marks where the person is: the Table whose list is open, otherwise Home.", async () => {
  await aTableIsMadeFrom("pens.csv", ["Pen", "Blue", "Red"]);
  expect(await markedInTheSidebarAt("/tables/pens")).toEqual(["Pens 2"]);
  expect(await markedInTheSidebarAt("/")).toEqual(["Home"]);
  expect(await markedInTheSidebarAt("/import")).toEqual(["Home"]);
});

test("On a wide screen the sidebar sits to the left of the page.", async () => {
  const { page } = await openInNewTab("/");
  const sidebar = await placeOf(sidebarOf(page));
  const content = await placeOf(page.getByRole("main"));
  expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(content.x);
  expect(sidebar.y).toBe(content.y);
});

async function placeOf(part: Locator) {
  return (await part.boundingBox()) as { x: number; y: number; width: number; height: number };
}

async function markedInTheSidebarAt(address: string) {
  const { page } = await openInNewTab(address);
  const marked = await sidebarOf(page).locator("[aria-current]").evaluateAll(wordsOfEachWithoutItsPicture);
  return marked.map(onOneLine);
}

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
