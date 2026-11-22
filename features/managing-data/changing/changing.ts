import { asText } from "../../../page.ts";
import type { StoredColumn, StoredTable } from "../../foundations/database/store.ts";
import { indexOfTheName } from "../browsing/showing.ts";

type Record = { cells: string[]; uploadRow: number | null };
type Field = { column: StoredColumn; index: number; cell: string };

const placeInTheForm: { [type: string]: number } = { Date: 1, "Yes/No": 2 };

export function recordForm(table: StoredTable, listAddress: string, record: Record) {
  const title = asText(record.cells[indexOfTheName(table.columns)]);
  return `
    <form class="rec" method="post" novalidate aria-labelledby="record-title">
      <header>
        <div>
          <p class="kicker"><a href="${listAddress}">${asText(table.name)}</a></p>
          <h2 id="record-title">${title}</h2>
        </div>
        <a class="x" href="${listAddress}" aria-label="Close">×</a>
      </header>
      <div class="fields">
        ${fieldsInFormOrder(table, record.cells).map(field).join("")}
        <p class="from wide"><span class="tag">from ${asText(table.fileName)}</span> row ${record.uploadRow}</p>
      </div>
      <footer>
        <button type="submit" class="btn primary">Save</button><a class="btn" href="${listAddress}">Cancel</a>
      </footer>
    </form>`;
}

export function cellsTypedInto(table: StoredTable, form: { [field: string]: string | undefined }) {
  return table.columns.map((column, index) => {
    const typed = form[`cell-${index}`];
    return column.type === "Yes/No" && !column.key ? String(typed !== undefined) : (typed ?? "").trim();
  });
}

function fieldsInFormOrder(table: StoredTable, cells: string[]) {
  const fields = table.columns.map((column, index) => ({ column, index, cell: cells[index] }));
  return fields.sort((one, other) => placeOf(one) - placeOf(other));
}

function placeOf({ column }: Field) {
  return column.key ? 0 : (placeInTheForm[column.type] ?? 0);
}

function field({ column, index, cell }: Field) {
  const id = `cell-${index}`;
  const name = asText(column.name);
  if (column.type === "Yes/No" && !column.key) return tickBox(id, name, cell);
  return `
    <div class="f">
      <label for="${id}">${name}${column.key ? " <em>· key</em>" : ""}</label>
      ${column.type === "Choice" && !column.key ? list(id, column.choices, cell) : box(id, column, cell)}
    </div>`;
}

function tickBox(id: string, name: string, cell: string) {
  const ticked = cell === "true" ? " checked" : "";
  return `
    <div class="f wide">
      <label class="check" for="${id}"><input type="checkbox" id="${id}" name="${id}"${ticked}> ${name}</label>
    </div>`;
}

function list(id: string, choices: string[], cell: string) {
  const option = (choice: string) => `<option${choice === cell ? " selected" : ""}>${asText(choice)}</option>`;
  return `<select id="${id}" name="${id}"><option value=""></option>${choices.map(option).join("")}</select>`;
}

function box(id: string, column: StoredColumn, cell: string) {
  if (column.type === "Date" && !column.key) return `<input type="date" id="${id}" name="${id}" value="${cell}">`;
  const decimal = column.type === "Number" ? ' inputmode="decimal"' : "";
  return `<input type="text" id="${id}" name="${id}" value="${asText(cell)}"${decimal} autocomplete="off">`;
}
