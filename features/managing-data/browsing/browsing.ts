import type { Table } from "../../importing-data/proposing/proposing.ts";
import { page } from "../../../page.ts";

export function listPage(table: Table) {
  return page(
    table.name,
    `<h1>${table.name}</h1><table><thead>${rowOf("th", table.columns.map(nameOf))}</thead>` +
      `<tbody>${table.rows.map((row) => rowOf("td", row)).join("")}</tbody></table>`,
  );
}

function nameOf(column: { name: string }) {
  return column.name;
}

function rowOf(cellTag: string, cells: string[]) {
  return `<tr>${cells.map((cell) => `<${cellTag}>${cell}</${cellTag}>`).join("")}</tr>`;
}
