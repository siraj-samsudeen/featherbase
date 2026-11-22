import { expect, test } from "bun:test";
import type { Page } from "playwright";
import { featherbaseInABrowser, pressCreateTableOn, tableOn } from "../../../testing.ts";

const { give, openInNewTab } = featherbaseInABrowser();

test("Pressing Create Table makes the Table with every row and opens its list.", async () => {
  const page = await give("people.csv", ["Name,City", "Asha,Chennai", "Bala,Madurai"]);
  await pressCreateTableOn(page);
  expect(await tableOn(page)).toEqual([
    ["Name", "City"],
    ["Asha", "Chennai"],
    ["Bala", "Madurai"],
  ]);
});

test("The Table keeps the name it was shown with, whatever spaces and marks the file's name has.", async () => {
  const page = await give("staff list & <b>teams</b> 50%.csv", ["Name", "Asha"]);
  await pressCreateTableOn(page);
  expect(await page.innerText("h1")).toBe("Staff list & <b>teams</b> 50%");
});

test("The Table is made with the name the person typed.", async () => {
  const page = await give("sheet1.csv", ["Name", "Asha"]);
  await page.getByLabel("Table name").fill("Team Members");
  await pressCreateTableOn(page);
  expect(await page.innerText("h1")).toBe("Team Members");
  expect(page.url()).toEndWith("/tables/team%20members");
});

test("The Table is made with the type the person chose for each Column.", async () => {
  const page = await give("days.csv", ["Row,Day", "1,2026-01-01", "2,2026-01-02"]);
  await page.getByLabel("Type of Day").selectOption("Text");
  await pressCreateTableOn(page);
  expect(await page.locator("tbody td:nth-child(2)").allInnerTexts()).toEqual(["2026-01-01", "2026-01-02"]);
});

test("The Table is made with the key the person chose.", async () => {
  const page = await give("badges.csv", ["Badge,Email", "B1,asha@example.com", "B2,bala@example.com"]);
  await page.getByLabel("Email is the key").check();
  await pressCreateTableOn(page);
  expect(await homeSaysOf("Badges")).toContain("keyed by Email");
});

test("A name that a Table already has is refused: the proposal comes back saying so, and nothing is made.", async () => {
  await pressCreateTableOn(await give("stores.csv", ["Store", "North", "South"]));

  const second = await give("shops.csv", ["Shop", "East"]);
  await second.getByLabel("Table name").fill("Stores");
  await second.getByRole("button", { name: "Create Table" }).click();
  await second.getByText("Stores is already used.").waitFor();
  expect(await second.getByLabel("Table name").inputValue()).toBe("Stores");
  expect(await homeSaysOf("Stores")).toContain("2 rows");
});

async function homeSaysOf(tableName: string) {
  const { page }: { page: Page } = await openInNewTab("/");
  return page.getByRole("region", { name: "Your Tables" }).getByRole("link", { name: tableName }).innerText();
}
