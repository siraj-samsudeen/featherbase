import { expect, test } from "bun:test";
import type { Locator, Page } from "playwright";
import { casesIn, cellsFrom, featherbaseInABrowser, tableOn } from "../../../testing.ts";

const { make } = featherbaseInABrowser();

const stock = [
  "Code,Item,Shelf,Counted On,In Stock,Quantity",
  "S1,Steel Bolt,A,2026-02-01,true,12",
  "S2,Brass Hinge,B,2026-02-03,false,7.5",
  "S3,Oak Dowel,A,,true,3",
  "S4,Felt Pad,B,2026-02-09,true,40",
];

test("Pressing a row's name opens that row beside the list, with every value in a field that suits its type, and marks the row in the list.", async () => {
  const page = await make("stock opened.csv", stock);
  const record = await openTheRecordOf("Brass Hinge", page);
  expect(await fieldsOf(record)).toEqual([
    ["Code · key", "text", "S2"],
    ["Item", "text", "Brass Hinge"],
    ["Shelf", "select-one", "B"],
    ["Quantity", "text", "7.5"],
    ["Counted On", "date", "2026-02-03"],
    ["In Stock", "checkbox", "not ticked"],
  ]);
  expect(await record.getByLabel("Shelf").locator("option").allInnerTexts()).toEqual(["", "A", "B"]);
  expect(await theMarkedRowOn(page)).toContain("Brass Hinge");
});

test('The record says where its row came from: "from stock.csv row 3".', async () => {
  const page = await make("stock.csv", stock);
  const record = await openTheRecordOf("Brass Hinge", page);
  expect(await wordsOf(record.locator(".from"))).toBe("from stock.csv row 3");
});

test('Save keeps the changed values, goes back to the list and says "Saved".', async () => {
  const page = await make("stock changed.csv", stock);
  const record = await openTheRecordOf("Brass Hinge", page);
  await record.getByLabel("Item").fill("Brass Hinge, Large");
  await record.getByLabel("Shelf").selectOption("A");
  await record.getByLabel("Quantity").fill("9");
  await record.getByLabel("Counted On").fill("2026-02-10");
  await record.getByLabel("In Stock").check();
  await record.getByRole("button", { name: "Save" }).click();
  await page.getByRole("status").getByText("Saved").waitFor();
  expect((await tableOn(page))[2]).toEqual(["S2", "Brass Hinge, Large", "A", "10-Feb-2026", "Yes", "9"]);
  expect(page.url()).toEndWith("/tables/stock%20changed");
});

test("A value that cannot be kept is refused: the record comes back with what was typed, says why under that field, and nothing is saved.", async () => {
  const page = await make("stock refused.csv", stock);
  const asItWas = await tableOn(page);
  for (const [label, typedAsWritten, refusal] of casesIn("features/managing-data/changing/changing.md", "Refused with")) {
    const [typed] = cellsFrom(typedAsWritten);
    const record = await openTheRecordOf("Brass Hinge", page);
    await record.getByLabel(label).fill(typed);
    await record.getByRole("button", { name: "Save" }).click();
    await page.getByText(refusal).waitFor();
    expect(await theRefusedFieldOn(page), refusal).toEqual([label, typed, refusal]);
    await page.getByRole("link", { name: "Cancel" }).click();
    expect(await tableOn(page), refusal).toEqual(asItWas);
  }
});

test("Cancel goes back to the list and keeps nothing.", async () => {
  const page = await make("stock left alone.csv", stock);
  const asItWas = await tableOn(page);
  const record = await openTheRecordOf("Brass Hinge", page);
  await record.getByLabel("Item").fill("Something Else");
  await record.getByRole("link", { name: "Cancel" }).click();
  await record.waitFor({ state: "detached" });
  expect(await tableOn(page)).toEqual(asItWas);
});

async function theRefusedFieldOn(page: Page) {
  const field = page.locator('.rec [aria-invalid="true"]');
  const label = await page.locator(`label[for="${await field.getAttribute("id")}"]`).innerText();
  return [label.replace(" · key", ""), await field.inputValue(), await page.getByRole("form").locator(".err").innerText()];
}

async function openTheRecordOf(name: string, page: Page) {
  await page.getByRole("link", { name }).click();
  const record = page.getByRole("form", { name });
  await record.waitFor();
  return record;
}

async function wordsOf(part: Locator) {
  return (await part.innerText()).replace(/\s+/g, " ").trim();
}

async function fieldsOf(record: Locator) {
  const fields = await record.locator("input, select").all();
  return Promise.all(fields.map(labelKindAndValueOf));
}

async function labelKindAndValueOf(field: Locator) {
  const label = await field.page().locator(`label[for="${await field.getAttribute("id")}"]`).innerText();
  const kind = await field.evaluate((element) => (element as HTMLInputElement).type);
  return [label.trim(), kind, kind === "checkbox" ? tickOf(await field.isChecked()) : await field.inputValue()];
}

function tickOf(ticked: boolean) {
  return ticked ? "ticked" : "not ticked";
}

function theMarkedRowOn(page: Page) {
  return page.locator('tr[aria-selected="true"]').innerText();
}
