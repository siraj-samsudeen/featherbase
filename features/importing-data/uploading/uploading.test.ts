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

async function recentUpload(fileName: string, page: Page) {
  const uploads = page.getByRole("region", { name: "Recent Uploads" });
  return (await uploads.getByRole("link", { name: fileName }).innerText()).replace(/\s+/g, " ").trim();
}

function today() {
  const [, month, day, year] = new Date().toDateString().split(" ");
  return `${day}-${month}-${year}`;
}
