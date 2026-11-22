import { expect, test } from "bun:test";
import type { Locator, Page } from "playwright";
import { casesIn, cellsFrom, featherbaseInABrowser, tableOn } from "../../../testing.ts";

const { make, openInNewTab } = featherbaseInABrowser();

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

test("The list has a button to add a row, named after one row of the Table.", async () => {
  for (const [table, button] of casesIn("features/managing-data/changing/changing.md", "Button")) {
    const page = await make(`${table}.csv`, ["Thing", "One"]);
    await page.getByRole("link", { name: button, exact: true }).waitFor();
  }
});

test('The button opens an empty record that says "given by hand". Create adds the row to the end of the list and says "Saved".', async () => {
  const page = await make("parts.csv", stock);
  const record = await openANewRecord("New Part", page);
  expect(await fieldsOf(record)).toEqual([
    ["Code · key", "text", ""],
    ["Item", "text", ""],
    ["Shelf", "select-one", ""],
    ["Quantity", "text", ""],
    ["Counted On", "date", ""],
    ["In Stock", "checkbox", "ticked"],
  ]);
  expect(await wordsOf(record.locator(".from"))).toBe("given by hand");

  await record.getByLabel("Code").fill("S5");
  await record.getByLabel("Item").fill("Cork Sheet");
  await record.getByRole("button", { name: "Create" }).click();
  await page.getByRole("status").getByText("Saved").waitFor();
  expect((await tableOn(page)).at(-1)).toEqual(["S5", "Cork Sheet", "—", "—", "Yes", "—"]);
  await page.getByText("5 rows").first().waitFor();

  const added = await openTheRecordOf("Cork Sheet", page);
  expect(await wordsOf(added.locator(".from"))).toBe("given by hand");
});

test("A new row is refused the same way as a changed one.", async () => {
  const page = await make("bins.csv", stock);
  const record = await openANewRecord("New Bin", page);
  await record.getByLabel("Code").fill("S1");
  await record.getByLabel("Item").fill("Cork Sheet");
  await record.getByRole("button", { name: "Create" }).click();
  await page.getByText("S1 is already used.").waitFor();
  expect(await theRefusedFieldOn(page)).toEqual(["Code", "S1", "S1 is already used."]);
  expect(await record.getByLabel("Item").inputValue()).toBe("Cork Sheet");
});

test('Delete asks first. Keep leaves the row. Delete removes it and says which row went: "Deleted Brass Hinge".', async () => {
  const page = await make("stock deleted.csv", stock);
  const record = await openTheRecordOf("Brass Hinge", page);
  const asking = page.locator(".confirm");

  await record.getByRole("button", { name: "Delete" }).click();
  expect(await wordsOf(asking.locator("p"))).toBe("Delete Brass Hinge? This can't be undone.");
  await asking.getByRole("button", { name: "Keep" }).click();
  await asking.waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "Brass Hinge" }).waitFor();

  await record.getByRole("button", { name: "Delete" }).click();
  await asking.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("status").getByText("Deleted Brass Hinge").waitFor();
  expect(await page.locator("tbody td:first-child").allInnerTexts()).toEqual(["S1", "S3", "S4"]);
});

test('Opening a row the Table does not have shows "Page not found".', async () => {
  await make("stock missing.csv", stock);
  for (const row of ["99", "two"]) {
    const visit = await openInNewTab(`/tables/stock%20missing/rows/${row}`);
    expect(visit.status).toBe(404);
    expect(await visit.page.innerText("body")).toContain("Page not found");
  }
});

async function openANewRecord(button: string, page: Page) {
  await page.getByRole("link", { name: button, exact: true }).click();
  const record = page.getByRole("form", { name: button });
  await record.waitFor();
  return record;
}

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
