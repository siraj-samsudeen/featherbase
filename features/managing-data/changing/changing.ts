import { asText } from "../../../page.ts";
import type { StoredColumn, StoredTable } from "../../foundations/database/store.ts";
import { isANumber } from "../../importing-data/proposing/proposing.ts";
import { indexOfTheName } from "../browsing/showing.ts";

type Record = { title: string; cells: string[]; uploadRow: number | null; refusals?: string[]; deleteAt?: string };
type Field = { column: StoredColumn; id: string; cell: string; refusal: string };

const placeInTheForm: { [type: string]: number } = { Date: 1, "Yes/No": 2 };

export function recordForm(table: StoredTable, listAddress: string, record: Record) {
  return `
    <form class="rec" method="post" novalidate aria-labelledby="record-title">
      <header>
        <div>
          <p class="kicker"><a href="${listAddress}">${asText(table.name)}</a></p>
          <h2 id="record-title">${asText(record.title)}</h2>
        </div>
        <a class="x" href="${listAddress}" aria-label="Close">×</a>
      </header>
      <div class="fields">
        ${fieldsInFormOrder(table, record).map(field).join("")}
        <p class="from wide">${whereItCameFrom(table, record)}</p>
      </div>
      <footer>${record.deleteAt ? buttonsToChange(listAddress) : buttonsToAdd(listAddress)}</footer>
    </form>
    ${record.deleteAt ? askingBeforeADelete(record.title, record.deleteAt) : ""}`;
}

function whereItCameFrom(table: StoredTable, { uploadRow }: Record) {
  if (uploadRow === null) return '<span class="tag">given by hand</span>';
  return `<span class="tag">from ${asText(table.fileName)}</span> row ${uploadRow}`;
}

function buttonsToChange(listAddress: string) {
  return `
    <button type="submit" class="btn primary">Save</button><a class="btn" href="${listAddress}">Cancel</a>
    <span class="grow"></span>
    <button type="button" class="btn danger" popovertarget="confirm-delete">Delete</button>`;
}

function buttonsToAdd(listAddress: string) {
  return `<button type="submit" class="btn primary">Create</button><a class="btn" href="${listAddress}">Cancel</a>`;
}

function askingBeforeADelete(title: string, deleteAt: string) {
  return `
    <div class="confirm" id="confirm-delete" popover>
      <p><b>Delete ${asText(title)}?</b>This can't be undone.</p>
      <form class="btns" method="post" action="${deleteAt}">
        <button type="button" class="btn" popovertarget="confirm-delete" popovertargetaction="hide">Keep</button>
        <button type="submit" class="btn danger sure">Delete</button>
      </form>
    </div>`;
}

export function aNewRecordFor(table: StoredTable) {
  const cells = table.columns.map((column) => (column.type === "Yes/No" && !column.key ? "true" : ""));
  return { title: addingTo(table), cells, uploadRow: null };
}

export function addingTo(table: { name: string }) {
  return `New ${oneOf(table.name)}`;
}

function oneOf(tableName: string) {
  return tableName.replace(/ies$/, "y").replace(/([^s])s$/, "$1");
}

export function nameOf(table: StoredTable, cells: string[]) {
  return cells[indexOfTheName(table.columns)];
}

export function cellsTypedInto(table: StoredTable, form: { [field: string]: string | undefined }) {
  return table.columns.map((column, index) => {
    const typed = form[`cell-${index}`];
    return column.type === "Yes/No" && !column.key ? String(typed !== undefined) : (typed ?? "").trim();
  });
}

export async function refusalsOf(table: StoredTable, cells: string[], isUsed: (key: string) => Promise<boolean>) {
  const theName = indexOfTheName(table.columns);
  const refusals = table.columns.map((column, index) => whyNot(column, cells[index], index === theName));
  const key = table.columns.findIndex((column) => column.key);
  if (key >= 0 && refusals[key] === "" && (await isUsed(cells[key]))) refusals[key] = `${cells[key]} is already used.`;
  return refusals;
}

function whyNot(column: StoredColumn, cell: string, isTheName: boolean) {
  if (cell === "") return column.key || isTheName ? `${column.name} is required.` : "";
  if (column.type === "Number" && !isANumber(cell)) return "Enter a number, such as 40 or 37.5.";
  return "";
}

function fieldsInFormOrder(table: StoredTable, { cells, refusals = [] }: Record) {
  const fields = table.columns.map((column, index) => ({
    column,
    id: `cell-${index}`,
    cell: cells[index],
    refusal: refusals[index] ?? "",
  }));
  return fields.sort((one, other) => placeOf(one) - placeOf(other));
}

function placeOf({ column }: Field) {
  return column.key ? 0 : (placeInTheForm[column.type] ?? 0);
}

function field(asked: Field) {
  const { column, id, refusal } = asked;
  const name = asText(column.name);
  if (column.type === "Yes/No" && !column.key) return tickBox(id, name, asked.cell);
  return `
    <div class="f">
      <label for="${id}">${name}${column.key ? " <em>· key</em>" : ""}</label>
      ${column.type === "Choice" && !column.key ? list(asked) : box(asked)}
      ${refusal ? `<p class="err" id="${id}-err">${asText(refusal)}</p>` : ""}
    </div>`;
}

function tickBox(id: string, name: string, cell: string) {
  const ticked = cell === "true" ? " checked" : "";
  return `
    <div class="f wide">
      <label class="check" for="${id}"><input type="checkbox" id="${id}" name="${id}"${ticked}> ${name}</label>
    </div>`;
}

function list({ id, column, cell }: Field) {
  const option = (choice: string) => `<option${choice === cell ? " selected" : ""}>${asText(choice)}</option>`;
  return `<select id="${id}" name="${id}"><option value=""></option>${column.choices.map(option).join("")}</select>`;
}

function box({ id, column, cell, refusal }: Field) {
  if (column.type === "Date" && !column.key) return `<input type="date" id="${id}" name="${id}" value="${cell}">`;
  const decimal = column.type === "Number" ? ' inputmode="decimal"' : "";
  const refused = refusal ? ` aria-invalid="true" aria-describedby="${id}-err"` : "";
  return `<input type="text" id="${id}" name="${id}" value="${asText(cell)}"${decimal}${refused} autocomplete="off">`;
}
