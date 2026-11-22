import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { columnsProposedOn, featherbaseInABrowser } from "../../../testing.ts";

const { give, openInNewTab, restartFeatherbase } = featherbaseInABrowser();

test("A file given to Featherbase is kept: its proposal opens again from the sidebar, even after a restart.", async () => {
  const proposedAtFirst = await columnsProposedOn(await give("pens.csv", ["Code,Colour", "P1,Blue", "P2,Red"]));
  await restartFeatherbase();
  const { page } = await openInNewTab("/");
  await page.getByRole("navigation", { name: "Featherbase" }).getByRole("link", { name: "pens.csv" }).click();
  await page.getByRole("heading", { name: "pens.csv" }).waitFor();
  expect(await columnsProposedOn(page)).toEqual(proposedAtFirst);
});

test('Home lists each upload under "Recent Uploads" with its number of rows and the day it arrived.', async () => {
  await give("inks.csv", ["Ink", "Black", "Blue", "Green"]);
  const { page } = await openInNewTab("/");
  expect(await recentUpload("inks.csv", page)).toBe(`inks.csv 3 rows ${today()}`);
});

test('Opening an upload Featherbase does not have shows "Page not found".', async () => {
  for (const address of ["/uploads/999999", "/uploads/not-a-number"]) {
    const visit = await openInNewTab(address);
    expect(visit.status, address).toBe(404);
    expect(await visit.page.innerText("body")).toContain("Page not found");
  }
});

test("The Import Data page says what will happen, in three steps: the file is kept, Featherbase proposes a Table, you decide.", async () => {
  const { page } = await openInNewTab("/import");
  expect(await page.locator(".steps b").allInnerTexts()).toEqual([
    "The file is kept",
    "Featherbase proposes a Table",
    "You decide",
  ]);
  await page.getByText("Drop A CSV File Here").waitFor();
});

test("A file dropped on the page is given the same way as a chosen one.", async () => {
  const { page } = await openInNewTab("/import");
  await page.dispatchEvent(".drop", "drop", { dataTransfer: await aDraggedFile(page, "dropped.csv", "Code,Colour\nP1,Blue") });
  await page.getByRole("heading", { name: "dropped.csv" }).waitFor();
  expect(await columnsProposedOn(page)).toEqual([
    ["Code", "Text", "key"],
    ["Colour", "Text", ""],
  ]);
});

test('"Try the sample: employees.csv" gives Featherbase its own sample file, with 24 rows and 7 columns.', async () => {
  const { page } = await openInNewTab("/import");
  await page.getByRole("button", { name: "Try the sample: employees.csv" }).click();
  await page.getByRole("heading", { name: "employees.csv" }).waitFor();
  expect(await page.locator(".lead").innerText()).toContain("24 rows and 7 columns");
});

function aDraggedFile(page: Page, name: string, text: string) {
  return page.evaluateHandle(
    ([name, text]) => {
      const dragged = new DataTransfer();
      dragged.items.add(new File([text], name, { type: "text/csv" }));
      return dragged;
    },
    [name, text],
  );
}

async function recentUpload(fileName: string, page: Page) {
  const uploads = page.getByRole("region", { name: "Recent Uploads" });
  return (await uploads.getByRole("link", { name: fileName }).innerText()).replace(/\s+/g, " ").trim();
}

function today() {
  const [, month, day, year] = new Date().toDateString().split(" ");
  return `${day}-${month}-${year}`;
}
