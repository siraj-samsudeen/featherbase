import type { Table } from "../../importing-data/proposing/proposing.ts";
import { page } from "../../../page.ts";

const rowsOnAPage = 10;

export function listPage(table: Table) {
  const last = Math.min(rowsOnAPage, table.rows.length);
  const shown = table.rows.slice(0, last);
  return page(
    table.name,
    `<h1>${table.name}</h1><p>1 to ${last} of ${table.rows.length}</p>` +
      `<table><thead>${rowOf("th", table.columns.map(nameOf))}</thead>` +
      `<tbody>${shown.map((row) => rowOf("td", row)).join("")}</tbody></table>`,
  );
}

function nameOf(column: { name: string }) {
  return column.name;
}

function rowOf(cellTag: string, cells: string[]) {
  return `<tr>${cells.map((cell) => `<${cellTag}>${cell}</${cellTag}>`).join("")}</tr>`;
}
