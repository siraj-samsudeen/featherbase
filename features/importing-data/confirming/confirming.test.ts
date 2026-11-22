import { expect, test } from "bun:test";
import { featherbaseInABrowser, tableOn } from "../../../testing.ts";

const { give } = featherbaseInABrowser();

test("Pressing Create makes the Table with every row and opens its list.", async () => {
  const page = await give("people.csv", ["Name,City", "Asha,Chennai", "Bala,Madurai"]);
  await page.getByRole("button", { name: "Create" }).click();
  await page.locator("h1", { hasText: "People" }).waitFor();
  expect(await tableOn(page)).toEqual([
    ["Name", "City"],
    ["Asha", "Chennai"],
    ["Bala", "Madurai"],
  ]);
});
