import { asText, bar } from "../../../page.ts";
import type { Column, Row, StoredTable } from "../../foundations/database/store.ts";
import { cellWriterFor, headingFor } from "./showing.ts";

export function listView(table: StoredTable, rows: Row[]) {
  const count = `<span class="count">${table.rowCount} rows</span>`;
  return {
    title: table.name,
    html: `
      <section class="view">
        ${bar(table.name, [], count)}
        <div class="work">
          <div class="gridbox" tabindex="0" aria-label="${asText(table.name)}">
            ${tableOf(table.columns, rows.map((row) => row.cells))}
          </div>
        </div>
      </section>`,
  };
}

export function tableOf(columns: Column[], rows: string[][]) {
  const write = columns.map(cellWriterFor);
  return `
    <table>
      <thead><tr>${columns.map(headingFor).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => write[index](cell)).join("")}</tr>`).join("")}</tbody>
    </table>`;
}
