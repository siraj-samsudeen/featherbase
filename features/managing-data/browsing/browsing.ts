import { asText, bar } from "../../../page.ts";
import type { Column, StoredTable } from "../../foundations/database/store.ts";
import { cellWriterFor, headingFor } from "./showing.ts";

export function listView(table: StoredTable, rows: string[][]) {
  const count = `<span class="count">${table.rowCount} rows</span>`;
  return {
    title: table.name,
    html: `
      <section class="view">
        ${bar(table.name, [], count)}
        <div class="work">
          <div class="gridbox" tabindex="0" aria-label="${asText(table.name)}">
            ${tableOf(table.columns, rows, rows)}
          </div>
        </div>
      </section>`,
  };
}

export function tableOf(columns: Column[], everyRow: string[][], rowsToShow: string[][]) {
  const write = columns.map((column, index) => cellWriterFor(column, cellsUnder(index, everyRow)));
  return `
    <table>
      <thead><tr>${columns.map(headingFor).join("")}</tr></thead>
      <tbody>${rowsToShow.map((row) => `<tr>${row.map((cell, index) => write[index](cell)).join("")}</tr>`).join("")}</tbody>
    </table>`;
}

function cellsUnder(columnIndex: number, rows: string[][]) {
  return rows.map((row) => row[columnIndex]);
}
