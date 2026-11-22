import type { Table } from "../../importing-data/proposing/proposing.ts";
import { asText, bar, tintNumbered } from "../../../page.ts";

type Column = Table["columns"][number];

const rowsOnAPage = 10;

export function listView(table: Table, pageNumber: number) {
  const first = (pageNumber - 1) * rowsOnAPage + 1;
  const last = Math.min(pageNumber * rowsOnAPage, table.rows.length);
  const shown = table.rows.slice(first - 1, last);
  const count = `<span class="count">${first} to ${last} of ${table.rows.length}</span>`;
  const next = last < table.rows.length ? `<a class="btn" href="?page=${pageNumber + 1}">Next</a>` : "";
  const dress = table.columns.map((column, index) => dresserFor(column, cellsUnder(index, table.rows)));
  return {
    title: table.name,
    html: `
      <section class="view">
        ${bar(table.name, [], `${count}<span class="grow"></span>${next}`)}
        <div class="work">
          <div class="gridbox" tabindex="0" aria-label="${asText(table.name)}">
            <table>
              <thead><tr>${table.columns.map(heading).join("")}</tr></thead>
              <tbody>${shown.map((row) => `<tr>${row.map((cell, index) => dress[index](cell)).join("")}</tr>`).join("")}</tbody>
            </table>
          </div>
        </div>
      </section>`,
  };
}

function heading(column: Column) {
  return `<th${column.type === "Number" ? ' class="num"' : ""}>${asText(column.name)}</th>`;
}

function dresserFor(column: Column, cells: string[]) {
  if (column.key) return (cell: string) => `<td class="code">${asText(cell)}</td>`;
  if (column.type === "Number") return (cell: string) => `<td class="num">${asText(cell)}</td>`;
  if (column.type === "Date") return (cell: string) => `<td class="date">${asText(cell)}</td>`;
  if (column.type === "Choice") return chipDresser([...new Set(cells)].sort());
  return (cell: string) => `<td>${asText(cell)}</td>`;
}

function chipDresser(values: string[]) {
  return (cell: string) => `<td>${cell === "" ? "" : chip(cell, values.indexOf(cell))}</td>`;
}

function chip(value: string, index: number) {
  return `<span class="chip ${tintNumbered(index)}">${asText(value)}</span>`;
}

function cellsUnder(columnIndex: number, rows: string[][]) {
  return rows.map((row) => row[columnIndex]);
}
