import type { Table } from "../../importing-data/proposing/proposing.ts";
import { asText, page } from "../../../page.ts";

const rowsOnAPage = 10;

export function listPage(table: Table, pageNumber: number) {
  const first = (pageNumber - 1) * rowsOnAPage + 1;
  const last = Math.min(pageNumber * rowsOnAPage, table.rows.length);
  const shown = table.rows.slice(first - 1, last);
  const next = last < table.rows.length ? `<a href="?page=${pageNumber + 1}">Next</a>` : "";
  return page(
    table.name,
    `<h1>${table.name}</h1><p>${first} to ${last} of ${table.rows.length}</p>` +
      `<table><thead>${rowOf("th", table.columns.map(nameOf))}</thead>` +
      `<tbody>${shown.map((row) => rowOf("td", row)).join("")}</tbody></table>${next}`,
  );
}

function nameOf(column: { name: string }) {
  return column.name;
}

function rowOf(cellTag: string, cells: string[]) {
  return `<tr>${cells.map((cell) => `<${cellTag}>${asText(cell)}</${cellTag}>`).join("")}</tr>`;
}
