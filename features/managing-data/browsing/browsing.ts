import { asText, bar } from "../../../page.ts";
import { linkButton } from "../../../parts.ts";
import type { Column, Row, StoredTable } from "../../foundations/database/store.ts";
import { addingTo } from "../changing/changing.ts";
import { cellWriterFor, headingFor, indexOfTheName } from "./showing.ts";

export type ShownRow = { cells: string[]; address?: string; marked?: boolean };
export type Layout = { density: "comfortable" | "compact"; record: "panel" | "page" };
export type OpenRecord = { form: string; rowId?: string };

export function listView(table: StoredTable, address: string, rows: Row[], layout: Layout, open?: OpenRecord) {
  const count = `<span class="count">${table.rowCount} rows</span>`;
  const shown = rows.map((row) => ({
    cells: row.cells,
    address: `${address}/rows/${row.id}`,
    marked: row.id === open?.rowId,
  }));
  const buttons = `
    <span class="grow"></span>
    ${linkButton("Import", "/import", " optional")}
    ${linkButton(addingTo(table), `${address}/new`, " primary")}`;
  return {
    title: table.name,
    html: `
      <section class="view">
        ${bar(table.name, [], count + buttons)}
        ${tools(layout)}
        <div class="work"${open ? ` data-open="${layout.record}"` : ""}>
          <div class="gridbox" tabindex="0" aria-label="${asText(table.name)}">
            ${tableOf(table.columns, shown)}
          </div>
          ${open?.form ?? ""}
        </div>
      </section>`,
  };
}

function tools(layout: Layout) {
  return `
    <form class="tools" method="post" action="/view" onchange="this.submit()">
      <span class="grow"></span>
      <fieldset class="seg" aria-label="Row height">
        ${choice("density", "comfortable", "Comfortable", layout)}
        ${choice("density", "compact", "Compact Rows", layout)}
      </fieldset>
      <details class="menu">
        <summary class="btn">View ▾</summary>
        <div class="menu-box">
          <fieldset>
            <legend>A record opens as</legend>
            ${choice("record", "panel", " Side panel", layout)}
            ${choice("record", "page", " Full page", layout)}
          </fieldset>
        </div>
      </details>
    </form>`;
}

function choice(name: "density" | "record", value: string, words: string, layout: Layout) {
  const chosen = layout[name] === value ? " checked" : "";
  return `<label><input type="radio" name="${name}" value="${value}"${chosen}>${words}</label>`;
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
