import type { Table } from "../../importing-data/proposing/proposing.ts";
import { asText, bar } from "../../../page.ts";
import { cellWriterFor, headingFor } from "./showing.ts";

export function listView(table: Table) {
  const count = `<span class="count">${table.rows.length} rows</span>`;
  return {
    title: table.name,
    html: `
      <section class="view">
        ${bar(table.name, [], count)}
        <div class="work">
          <div class="gridbox" tabindex="0" aria-label="${asText(table.name)}">
            ${tableOf(table, table.rows)}
          </div>
        </div>
      </section>`,
  };
}

export function tableOf(table: Table, rows: string[][]) {
  const write = table.columns.map((column, index) => cellWriterFor(column, cellsUnder(index, table.rows)));
  return `
    <table>
      <thead><tr>${table.columns.map(headingFor).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => write[index](cell)).join("")}</tr>`).join("")}</tbody>
    </table>`;
}

function cellsUnder(columnIndex: number, rows: string[][]) {
  return rows.map((row) => row[columnIndex]);
}
