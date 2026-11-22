import { asText, bar } from "../../../page.ts";
import type { Column, Row, StoredTable } from "../../foundations/database/store.ts";
import { cellWriterFor, headingFor, indexOfTheName } from "./showing.ts";

export type ShownRow = { cells: string[]; address?: string; marked?: boolean };
export type OpenRecord = { form: string; rowId?: string };

export function listView(table: StoredTable, address: string, rows: Row[], open?: OpenRecord) {
  const count = `<span class="count">${table.rowCount} rows</span>`;
  const shown = rows.map((row) => ({
    cells: row.cells,
    address: `${address}/rows/${row.id}`,
    marked: row.id === open?.rowId,
  }));
  return {
    title: table.name,
    html: `
      <section class="view">
        ${bar(table.name, [], count)}
        <div class="work"${open ? ' data-open="panel"' : ""}>
          <div class="gridbox" tabindex="0" aria-label="${asText(table.name)}">
            ${tableOf(table.columns, shown)}
          </div>
          ${open?.form ?? ""}
        </div>
      </section>`,
  };
}

export function tableOf(columns: Column[], rows: ShownRow[]) {
  const theName = indexOfTheName(columns);
  const write = columns.map((column, index) => cellWriterFor(column, index === theName));
  const cellsOf = (row: ShownRow) =>
    row.cells.map((cell, index) => write[index](cell, index === theName ? row.address : undefined)).join("");
  return `
    <table>
      <thead><tr>${columns.map(headingFor).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr${row.marked ? ' aria-selected="true"' : ""}>${cellsOf(row)}</tr>`).join("")}</tbody>
    </table>`;
}
